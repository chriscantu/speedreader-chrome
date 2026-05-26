/**
 * SpeedReader — Background Service Worker (Manifest V3)
 *
 * This module is the SW entry point. It registers `chrome.*` listeners
 * synchronously at top-level — the load-bearing MV3 invariant. A listener
 * registered inside an async callback after the first `await` is invisible
 * to Chrome on subsequent wakes.
 *
 * Listener-registration discipline:
 * - All `addListener` calls happen at module top-level, before any `await`.
 * - No `init()` wrapper. No top-level `await`.
 * - Conditional behaviour lives inside the listener body, never gating
 *   the `addListener` call itself.
 *
 * Scope of this file (issue #122):
 * - Install the unified `chrome.runtime.onMessage` listener with sender-
 *   provenance validation.
 * - Export `dispatchActivation` so commands / contextMenu / popup paths
 *   (issues #34, #72, #75) can wire their listeners in follow-up PRs
 *   WITHOUT touching the funnel.
 *
 * Scope of this file (issue #34):
 * - Side-effect import of `./commands/register` to install the
 *   `chrome.commands.onCommand` listener for `_toggle_reader`.
 *
 * Out of scope (deliberately):
 * - `chrome.contextMenus` registration + `onClicked` listener (issue #72).
 * - The `rsvp-session` Port `onConnect` handler — owned by the messaging-
 *   contract spec; lands with the read-session implementation.
 *
 * See:
 * - `docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 * - `docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md`
 * - `docs/superpowers/specs/2026-05-08-messaging-contract.md`
 */

import { dispatchActivation } from './activation/dispatch';
import { handleOnMessage } from './messaging/on-message';
import { route } from './route';
import type { ActivationIntent } from './activation/types';

// Side-effect import: top-level `chrome.commands.onCommand.addListener`
// for `_toggle_reader`. Dispatches directly via the funnel — does NOT
// route through `onMessage`, so it cannot collide with the
// `activate-reader` path below. See issue #34.
import './commands/register';

// Side-effect import: top-level `chrome.contextMenus.onClicked` +
// `chrome.runtime.onInstalled` / `onStartup` + `subscribeSettings`
// wiring for the right-click submenu. Same MV3 invariant — listener
// registration runs synchronously on every SW wake. See issue #72.
import './context-menu/register';

// Re-export so follow-up issues (#34, #72) can wire their source-specific
// listeners against the funnel without reaching into the activation
// subdirectory.
export { dispatchActivation };
export type { ActivationIntent };

// Top-level synchronous listener registration. MUST run on every wake.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  return handleOnMessage(msg, sender, sendResponse, { route });
});
