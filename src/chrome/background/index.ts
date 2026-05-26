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
import { handleOnMessage, type OnMessageError } from './messaging/on-message';
import type { ActivationIntent } from './activation/types';

// Re-export so follow-up issues (#34, #72) can wire their source-specific
// listeners against the funnel without reaching into the activation
// subdirectory.
export { dispatchActivation };
export type { ActivationIntent };

/**
 * Route a validated message to its handler. The sender-provenance gate
 * in `handleOnMessage` has already rejected foreign senders and shape
 * mismatches before we reach here.
 *
 * Today only `activate-reader` is routed. The Port-based read-session
 * messages travel over `chrome.runtime.connect` per the messaging-contract
 * spec — they do NOT pass through `onMessage`.
 */
function route(
  msg: { type: string } & Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (resp: { ok: false; error: OnMessageError } | { ok: true; data: unknown }) => void,
): void {
  if (msg.type === 'activate-reader') {
    const tabId = sender.tab?.id;
    // The popup is the only legitimate sender of `activate-reader` over
    // `onMessage`; it has no `sender.tab.id`, and the popup payload must
    // carry the resolved tab id explicitly. The provenance gate has
    // already enforced popup-shape for this type.
    const intentTabId = typeof msg.tabId === 'number' ? msg.tabId : tabId;
    if (typeof intentTabId !== 'number') {
      sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
      return;
    }
    const intent: ActivationIntent = { source: 'popup', tabId: intentTabId };
    void dispatchActivation(intent).then((result) => {
      if (result.ok) {
        sendResponse({ ok: true, data: result.data });
      } else {
        // Map ActivationError → OnMessageError envelope. The popup will
        // re-render based on this; downstream surfaces (restricted page
        // banner, retry) are owned by the popup UI.
        sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
      }
    });
    return;
  }

  // Unknown message types fall through with an invalid-payload error.
  sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
}

// Top-level synchronous listener registration. MUST run on every wake.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  return handleOnMessage(msg, sender, sendResponse, { route });
});
