/**
 * Router for validated `onMessage` requests. Separated from `index.ts`
 * so it can be unit-tested without touching the top-level listener
 * registration.
 *
 * The sender-provenance gate in `handleOnMessage` has already rejected
 * foreign senders and shape mismatches before `route` is called. This
 * module dispatches by `msg.type` to the appropriate handler.
 *
 * Today only `activate-reader` is routed. The Port-based read-session
 * messages travel over `chrome.runtime.connect` per the messaging-contract
 * spec — they do NOT pass through `onMessage`.
 */

import { dispatchActivation } from './activation/dispatch';
import type { ActivationError, ActivationIntent } from './activation/types';
import type { OnMessageError } from './messaging/on-message';

export type RouteResponse = { ok: false; error: OnMessageError } | { ok: true; data: unknown };

/**
 * Injection hooks. `index.ts` wires the real chrome bindings; tests
 * supply stubs. The shape is intentionally minimal — only the bits the
 * router actually touches.
 */
export interface RouteDeps {
  dispatchActivation: (
    intent: ActivationIntent,
  ) => Promise<{ ok: true; data: void } | { ok: false; error: ActivationError }>;
}

const defaultDeps: RouteDeps = {
  dispatchActivation: (intent) => dispatchActivation(intent),
};

export function route(
  msg: { type: string } & Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (resp: RouteResponse) => void,
  deps: RouteDeps = defaultDeps,
): void {
  if (msg.type === 'activate-reader') {
    const tabId = sender.tab?.id;
    // The popup is the only legitimate sender of `activate-reader` over
    // `onMessage`; it has no `sender.tab.id`, so the popup payload must
    // carry the resolved tab id explicitly. The provenance gate has
    // already enforced popup-shape for this type.
    const intentTabId = typeof msg.tabId === 'number' ? msg.tabId : tabId;
    if (typeof intentTabId !== 'number') {
      sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
      return;
    }
    const intent: ActivationIntent = { source: 'popup', tabId: intentTabId };
    void deps.dispatchActivation(intent).then((result) => {
      if (result.ok) {
        sendResponse({ ok: true, data: result.data });
      } else {
        // Forward the typed ActivationError verbatim. The popup
        // distinguishes `restricted-page` (render banner) from
        // `inject-failed` / `handoff-failed` / `tab-unavailable`
        // (retry surfaces) — collapsing to `invalid-payload` would
        // lose that distinction.
        sendResponse({
          ok: false,
          error: { kind: 'activation-failed', error: result.error },
        });
      }
    });
    return;
  }

  // Unknown message types fall through with an invalid-payload error.
  sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
}
