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
 * Out of scope (deliberately):
 * - `chrome.commands.onCommand` listener (issue #34).
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

// Re-export so follow-up issues (#34, #72) can wire their source-specific
// listeners against the funnel without reaching into the activation
// subdirectory.
export { dispatchActivation };
export type { ActivationIntent };

// Top-level synchronous listener registration. MUST run on every wake.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  return handleOnMessage(msg, sender, sendResponse, { route });
});
