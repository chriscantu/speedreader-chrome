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
 * Re-entrancy: `ensureContextMenu` is serialized via a module-level
 * in-flight promise so two near-simultaneous calls (e.g., `onInstalled`
 * + a `subscribeSettings` rebroadcast from `loadSettings`'
 * canonicalization write-back) cannot interleave between the
 * `installed = true` flip and the `installedItems` snapshot update.
 * Mirrors the same pattern used by the activation in-flight injection
 * lock in `dispatch.ts`.
 *
 * `chrome.contextMenus.create` / `update` are callback-style APIs;
 * errors surface via `chrome.runtime.lastError` inside the callback,
 * NOT via thrown exceptions. We pass a callback to each call and log
 * any `lastError` rather than letting it vanish.
 *
 * See:
 * - `docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 *   §"Menu Update Discipline", §"Failure Modes" → stale-label race.
 */

import type { CtxItemSpec } from './factory';
import { buildMenuItems } from './factory';
import { loadSettings } from '../../settings/storage';

const LOG_PREFIX = '[SpeedReader]';

let installed = false;
let installedItems: CtxItemSpec[] = [];
let inFlight: Promise<void> | null = null;

function checkLastError(op: string, id: string): void {
  // `chrome.runtime` may be undefined in test stubs that focus on the
  // contextMenus surface only — treat absence as "no error".
  const err = chrome.runtime?.lastError;
  if (err) {
    console.warn(`${LOG_PREFIX} contextMenu: ${op}(${id}) failed: ${err.message}`);
  }
}

async function doEnsure(): Promise<void> {
  const settings = await loadSettings();
  const items = buildMenuItems(settings);

  if (!installed) {
    // First-install path: removeAll then create. Wrapped in a Promise
    // because the callback form is the only API shape Chrome guarantees
    // before MV3's promise-API completion (the test stubs all use this
    // shape too).
    await new Promise<void>((resolve) =>
      chrome.contextMenus.removeAll(() => {
        checkLastError('removeAll', '*');
        resolve();
      }),
    );
    for (const item of items) {
      const props: chrome.contextMenus.CreateProperties = {
        id: item.id,
        type: item.type ?? 'normal',
        parentId: item.parentId,
        contexts: item.contexts as chrome.contextMenus.ContextType[],
        documentUrlPatterns: [...item.documentUrlPatterns],
      };
      // Omit `title` on separators — Chrome ignores it but some stub
      // adapters reject the field on `type: 'separator'`. Omit `checked`
      // unless it's a checkbox.
      if (item.type !== 'separator') {
        props.title = item.title;
      }
      if (item.type === 'checkbox' && item.checked !== undefined) {
        props.checked = item.checked;
      }
      chrome.contextMenus.create(props, () => checkLastError('create', item.id));
    }
    installed = true;
  } else {
    // Diff path: per-item `update`. Title / checked are the only fields
    // that mutate post-install (IDs, types, contexts, parentId,
    // documentUrlPatterns are structural and pinned at create time).
    // A new ID appearing in `items` but absent from `installedItems`
    // indicates a factory shape change that did not pass through a
    // fresh SW wake — log so the omission surfaces rather than
    // silently dropping the new entry.
    for (const item of items) {
      const prev = installedItems.find((p) => p.id === item.id);
      if (!prev) {
        console.warn(
          `${LOG_PREFIX} contextMenu: new item ${item.id} appeared on diff path; ` +
            `skipping (requires SW wake to install). Factory shape changed without restart?`,
        );
        continue;
      }
      const partial: chrome.contextMenus.UpdateProperties = {};
      if (prev.title !== item.title) partial.title = item.title;
      if (prev.checked !== item.checked) partial.checked = item.checked;
      if (Object.keys(partial).length > 0) {
        chrome.contextMenus.update(item.id, partial, () => checkLastError('update', item.id));
      }
    }
  }
  installedItems = items;
}

/**
 * Build the menu items from current settings and either install them
 * (first call this wake) or diff-update them (subsequent calls).
 *
 * Called from:
 * - `register.ts`: `chrome.runtime.onInstalled` and `chrome.runtime.onStartup`
 * - `register.ts`: `subscribeSettings` rebroadcast
 *
 * Concurrent calls share one in-flight promise so the first-call /
 * diff-path branch cannot race.
 */
export async function ensureContextMenu(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = doEnsure().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Test-only reset for the module-scoped `installed` / `installedItems`
 * / `inFlight` state. Never called in production. Lets each Vitest case
 * start from the "fresh SW wake" baseline without a `vi.resetModules()`
 * per test (which is heavier and breaks the `loadSettings` stub).
 */
export function __resetForTests(): void {
  installed = false;
  installedItems = [];
  inFlight = null;
}
