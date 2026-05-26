/**
 * `chrome.contextMenus` adapter — the Chrome-API side of the
 * factory/adapter split. Translates the pure `CtxItemSpec[]` from
 * `factory.ts` into `chrome.contextMenus.create` / `update` calls.
 *
 * Menu Update Discipline (spec §"Menu Update Discipline"):
 *
 * - First call per SW wake: `removeAll` + `create` per item. This is the
 *   `onInstalled` / `onStartup` recreate path.
 * - Subsequent calls (via `subscribeSettings` rebroadcast): diff-based
 *   `chrome.contextMenus.update(id, partial)` per changed item. NEVER
 *   `removeAll` on the subscribe path — `removeAll` collapses a menu
 *   the user may have open mid-update; `update` does not.
 *
 * Per-tab installed state is process-scoped (`installed` module-level
 * boolean) because the SW is the only owner of the chrome context-menu
 * registry. The flag survives within one SW wake; a fresh SW wake
 * re-enters via `onStartup` / `onInstalled` which reset by calling
 * `removeAll` again.
 *
 * See:
 * - `docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 *   §"Menu Update Discipline", §"Failure Modes" → stale-label race.
 */

import type { CtxItemSpec } from './factory';
import { buildMenuItems } from './factory';
import { loadSettings } from '../../settings/storage';

let installed = false;
let installedItems: CtxItemSpec[] = [];

/**
 * Build the menu items from current settings and either install them
 * (first call this wake) or diff-update them (subsequent calls).
 *
 * Called from:
 * - `register.ts`: `chrome.runtime.onInstalled` and `chrome.runtime.onStartup`
 * - `register.ts`: `subscribeSettings` rebroadcast
 *
 * Side-effectful only — no return value. Errors from `chrome.*` are
 * surfaced via Chrome's own logging; we do not throw across the seam.
 */
export async function ensureContextMenu(): Promise<void> {
  const settings = await loadSettings();
  const items = buildMenuItems(settings);

  if (!installed) {
    // First-install path: removeAll then create. Wrapped in a Promise
    // because the callback form is the only API shape Chrome guarantees
    // before MV3's promise-API completion (the test stubs all use this
    // shape too).
    await new Promise<void>((resolve) => chrome.contextMenus.removeAll(() => resolve()));
    for (const item of items) {
      chrome.contextMenus.create({
        id: item.id,
        title: item.title,
        type: item.type ?? 'normal',
        parentId: item.parentId,
        contexts: item.contexts as chrome.contextMenus.ContextType[],
        documentUrlPatterns: [...item.documentUrlPatterns],
        checked: item.checked,
      });
    }
    installed = true;
  } else {
    // Diff path: per-item `update`. We only emit an update call when
    // a field actually changed — title or checked are the only fields
    // that mutate post-install (IDs, types, contexts, parentId,
    // documentUrlPatterns are structural and pinned at create time).
    for (const item of items) {
      const prev = installedItems.find((p) => p.id === item.id);
      if (!prev) continue;
      const partial: chrome.contextMenus.UpdateProperties = {};
      if (prev.title !== item.title) partial.title = item.title;
      if (prev.checked !== item.checked) partial.checked = item.checked;
      if (Object.keys(partial).length > 0) {
        chrome.contextMenus.update(item.id, partial);
      }
    }
  }
  installedItems = items;
}

/**
 * Test-only reset for the module-scoped `installed` / `installedItems`
 * state. Never called in production. Lets each Vitest case start from
 * the "fresh SW wake" baseline without a `vi.resetModules()` per
 * test (which is heavier and breaks the `loadSettings` stub).
 */
export function __resetForTests(): void {
  installed = false;
  installedItems = [];
}
