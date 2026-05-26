/**
 * Top-level synchronous wiring for `chrome.contextMenus` listeners.
 * Mirrors `commands/register.ts` — importing this module is the install
 * step. MUST be imported synchronously from
 * `src/chrome/background/index.ts` before any `await`.
 *
 * MV3 invariant: a listener registered inside an async callback after
 * the first `await` is invisible to Chrome on subsequent SW wakes
 * (per the SW-lifecycle spec §"Listener Registration Discipline"). All
 * three `addListener` calls below run at module top-level.
 *
 * Wiring:
 * - `chrome.contextMenus.onClicked` → `handleContextMenuClick`
 * - `chrome.runtime.onInstalled` → `ensureContextMenu` (first install /
 *   updated extension version recreate path)
 * - `chrome.runtime.onStartup` → `ensureContextMenu` (browser start
 *   recreate path — menu items don't persist across browser sessions
 *   per spec §"Menu Update Discipline")
 * - `subscribeSettings` → `ensureContextMenu` (Menu Update Discipline
 *   path #1 — settings change, e.g. `lastUsedWpm` after a preset click)
 *
 * See:
 * - `docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 *   AC #19, §"Menu Update Discipline".
 * - `docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 *   §"Listener Registration Discipline".
 */

import { handleContextMenuClick } from './listener';
import { ensureContextMenu } from './install';
import { subscribeSettings } from '../../settings/storage';

const LOG_PREFIX = '[SpeedReader]';

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch((err) => {
    console.error(`${LOG_PREFIX} contextMenu: click handler failed`, err);
  });
});

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu().catch((err) => {
    console.error(`${LOG_PREFIX} contextMenu: onInstalled install failed`, err);
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu().catch((err) => {
    console.error(`${LOG_PREFIX} contextMenu: onStartup install failed`, err);
  });
});

// Subscribe-broadcast → menu update path (Menu Update Discipline
// path #1). Fires for any settings mutation; `ensureContextMenu`'s
// per-item diff filters to actual title / checked changes.
subscribeSettings(() => {
  ensureContextMenu().catch((err) => {
    console.error(`${LOG_PREFIX} contextMenu: subscribe-driven update failed`, err);
  });
});
