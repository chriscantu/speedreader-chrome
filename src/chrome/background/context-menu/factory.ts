/**
 * Pure builder for the `chrome.contextMenus` item list.
 *
 * No `chrome.*` calls — `install.ts` owns the adapter side. Keeping this
 * file pure means every shape decision (titles, checkbox state, separator
 * placement) is exercised by `factory.test.ts` against a plain
 * `SettingsV5` input without any chrome-stub scaffolding.
 *
 * See:
 * - `docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 *   §"Submenu Structure" — IDs, generation logic, "Custom…" behavior.
 * - `docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 *   §"File Layout" — the factory / adapter / listener split.
 */

import type { SettingsV5 } from '../../../core/settings';

/**
 * Stable, versioned menu-item IDs. The `v1` suffix lets a future shape
 * revision co-exist with persisted state, and lets the listener's switch
 * be exhaustive at compile time (typo in a `case` becomes a TS error,
 * not a silent dead branch).
 */
export type CtxMenuItemId =
  | 'speedreader.ctx.parent.v1'
  | 'speedreader.ctx.lastUsed.v1'
  | 'speedreader.ctx.preset.300.v1'
  | 'speedreader.ctx.preset.500.v1'
  | 'speedreader.ctx.preset.custom.v1'
  | 'speedreader.ctx.separator.v1'
  | 'speedreader.ctx.toggle.showContext.v1'
  | 'speedreader.ctx.toggle.startFromWord1.v1';

/**
 * Local literal-union mirror of the subset of
 * `chrome.contextMenus.ContextType` the factory uses. Keeps the pure
 * builder free of any `chrome.*` type imports per the §File Layout
 * boundary discipline. Widen only when a new item actually needs another
 * context.
 */
type CtxContext = 'selection';

export interface CtxItemSpec {
  id: CtxMenuItemId;
  title: string;
  type?: 'normal' | 'separator' | 'checkbox';
  parentId?: CtxMenuItemId;
  contexts: readonly CtxContext[];
  documentUrlPatterns: readonly string[];
  checked?: boolean;
}

/**
 * Top-frame `documentUrlPatterns` — restricts the menu to http(s) so it
 * never appears on `chrome://`, `chrome-extension://`, `file://`, or the
 * Web Store. The restricted-URL guard at dispatch is the second layer;
 * this is the first (per spec §"Restricted-URL Guard" call site #2).
 */
const HTTP_PATTERNS = ['http://*/*', 'https://*/*'] as const;

/**
 * Build the eight-item spec list (parent + seven children). Pure — no
 * `chrome.*` references. Items are emitted in the order they should
 * appear in the submenu; the adapter preserves order on `create`.
 */
export function buildMenuItems(settings: SettingsV5): CtxItemSpec[] {
  const PARENT_ID: CtxMenuItemId = 'speedreader.ctx.parent.v1';

  const parent: CtxItemSpec = {
    id: PARENT_ID,
    title: 'SpeedReader',
    contexts: ['selection'],
    documentUrlPatterns: HTTP_PATTERNS,
  };

  const lastUsed: CtxItemSpec = {
    id: 'speedreader.ctx.lastUsed.v1',
    title: `${settings.lastUsedWpm} wpm · last used`,
    parentId: PARENT_ID,
    contexts: ['selection'],
    documentUrlPatterns: HTTP_PATTERNS,
  };

  const preset300: CtxItemSpec = {
    id: 'speedreader.ctx.preset.300.v1',
    title: '300 wpm',
    parentId: PARENT_ID,
    contexts: ['selection'],
    documentUrlPatterns: HTTP_PATTERNS,
  };

  const preset500: CtxItemSpec = {
    id: 'speedreader.ctx.preset.500.v1',
    title: '500 wpm',
    parentId: PARENT_ID,
    contexts: ['selection'],
    documentUrlPatterns: HTTP_PATTERNS,
  };

  const presetCustom: CtxItemSpec = {
    id: 'speedreader.ctx.preset.custom.v1',
    title: 'Custom…',
    parentId: PARENT_ID,
    contexts: ['selection'],
    documentUrlPatterns: HTTP_PATTERNS,
  };

  const separator: CtxItemSpec = {
    id: 'speedreader.ctx.separator.v1',
    title: '', // ignored for separator; some types require a string slot
    type: 'separator',
    parentId: PARENT_ID,
    contexts: ['selection'],
    documentUrlPatterns: HTTP_PATTERNS,
  };

  const toggleShowContext: CtxItemSpec = {
    id: 'speedreader.ctx.toggle.showContext.v1',
    title: 'Show context line',
    type: 'checkbox',
    parentId: PARENT_ID,
    contexts: ['selection'],
    documentUrlPatterns: HTTP_PATTERNS,
    checked: settings.contextLine,
  };

  const toggleStartFromWord1: CtxItemSpec = {
    id: 'speedreader.ctx.toggle.startFromWord1.v1',
    title: 'Start from word 1',
    type: 'checkbox',
    parentId: PARENT_ID,
    contexts: ['selection'],
    documentUrlPatterns: HTTP_PATTERNS,
    checked: settings.startFromWordOne,
  };

  return [
    parent,
    lastUsed,
    preset300,
    preset500,
    presetCustom,
    separator,
    toggleShowContext,
    toggleStartFromWord1,
  ];
}
