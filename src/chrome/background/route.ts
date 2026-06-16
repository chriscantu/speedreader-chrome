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
import { handlePosition } from './position/handlers';

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
  /**
   * Returns the id of the currently active tab in the last-focused
   * window, or `null` when none can be resolved. Used as a
   * defense-in-depth cross-check: the popup-supplied `msg.tabId` must
   * match the actually-active tab.
   */
  getActiveTabId: () => Promise<number | null>;
}

const defaultDeps: RouteDeps = {
  dispatchActivation: (intent) => dispatchActivation(intent),
  getActiveTabId: async () => {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return typeof active?.id === 'number' ? active.id : null;
  },
};

export function route(
  msg: { type: string } & Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (resp: RouteResponse) => void,
  deps: RouteDeps = defaultDeps,
): void {
  // #196 — position RPCs. `handlePosition` returns true when it owns the type
  // (and has taken responsibility for `sendResponse`); fall through otherwise.
  // The sender-shape provenance gate in `handleOnMessage` has already enforced
  // CS-only / popup-only membership for every position type before we get here.
  if (handlePosition(msg, sender, sendResponse)) return;

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

    void (async () => {
      // Defense-in-depth: the popup-supplied tabId must match the
      // actually-active tab. The provenance gate already enforced
      // popup-shape, but a buggy / compromised popup could still
      // hand us a stale tabId from a previous focus window.
      const activeTabId = await deps.getActiveTabId();
      if (activeTabId === null || activeTabId !== intentTabId) {
        sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
        return;
      }

      // Issue #18 — popup carries scope ('full' for Read article,
      // 'selection' for Read selection). The runtime guard validates the
      // wire shape because the provenance gate above only enforced
      // popup-shape, not field values; a buggy/compromised popup could
      // still send a bogus scope. Reject the message rather than silently
      // coerce — silent coercion loses the audit trail (security
      // adversary F2). Matches the invalid-tabId branch above.
      if (msg.scope !== 'selection' && msg.scope !== 'full') {
        sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
        return;
      }
      const intent: ActivationIntent = {
        source: 'popup',
        tabId: intentTabId,
        scope: msg.scope,
      };
      const result = await deps.dispatchActivation(intent);
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
    })();
    return;
  }

  // Unknown message types fall through with an invalid-payload error.
  sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
}
