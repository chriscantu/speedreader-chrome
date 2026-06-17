/**
 * Unified `chrome.runtime.onMessage` handler — single front door for all
 * extension-internal RPCs.
 *
 * Sender-provenance discipline per the SW-lifecycle spec
 * (`docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 * §"Sender-Provenance Validation"):
 *
 * 1. Reject `sender.id !== chrome.runtime.id` (other extensions, no
 *    further processing).
 * 2. Per-message-type sender-shape assertions: popup messages must
 *    arrive with `sender.tab === undefined`; content-script messages
 *    must have `sender.tab.id` defined AND `sender.frameId === 0`
 *    (top frame only).
 * 3. The manifest MUST NOT declare `externally_connectable` — web
 *    origins MUST NOT reach `onMessage` / `onConnect`. (Default MV3
 *    behavior is to deny; the comment in `manifest.ts` guards future
 *    churn.)
 *
 * Payload validation here is minimal — exhaustive `validateMsg`
 * narrowing lives in `src/core/messaging/validate.ts` per the spec.
 * This file owns the sender-shape gate; payload validation is forwarded
 * to the router via the `route` callback.
 */

/**
 * Message types that may only arrive from the popup (extension page).
 *
 * `activate-reader`, `extract-summary`, and `restricted-url-probe` are
 * popup-originated per the messaging-contract spec; the SW-lifecycle
 * spec adds `activate-reader` to this set.
 */
const POPUP_ONLY_TYPES = new Set<string>([
  'activate-reader',
  'extract-summary',
  'restricted-url-probe',
  // #196 — popup-only position RPCs (history management). SSOT in
  // `core/messaging/types.ts` so gate membership and handler wiring cannot
  // drift apart (spec §"Gate is allowlist, registered atomically").
  ...POPUP_POSITION_TYPES,
]);

/**
 * Message types that may only arrive from a content script (post-MVP
 * CS→SW signals). Listed here so the gate refuses popup-shaped senders
 * for these types.
 */
const CS_ONLY_TYPES = new Set<string>([
  'cs-progress',
  'overlay-state',
  // #196 — content-script-only position RPCs (sender-bound; no `url` in wire
  // shape). SSOT in `core/messaging/types.ts`.
  ...CS_POSITION_TYPES,
]);

import type { ActivationError } from '../activation/types';
import { CS_POSITION_TYPES, POPUP_POSITION_TYPES } from '../../../core/messaging/types';

export type OnMessageError =
  | { kind: 'sender-rejected' }
  | {
      kind: 'sender-shape-mismatch';
      expected: 'popup' | 'content-script';
      got: 'popup' | 'content-script';
    }
  | { kind: 'invalid-payload' }
  | { kind: 'activation-failed'; error: ActivationError };

export interface OnMessageDeps {
  /**
   * Forward a validated message to the router. Implementations dispatch
   * by `msg.type` to the appropriate handler (dispatchActivation for
   * `activate-reader`, etc.).
   */
  route: (
    msg: { type: string } & Record<string, unknown>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (
      resp: { ok: false; error: OnMessageError } | { ok: true; data: unknown },
    ) => void,
  ) => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A trusted extension page (popup / options / welcome). #196 — the trust
 * signal is the Chrome-populated `sender.url` ORIGIN, not tab-absence: the
 * browser-action popup has no `sender.tab`, but the OPTIONS page opens in a
 * real tab (so `sender.tab.id` is defined), and classifying it by tab-presence
 * alone mis-labels it as a content script — which would reject its popup-only
 * `position/clear-all` RPC at the gate (ring security finding #2). A content
 * script injected into a web page always has an `http(s)` `sender.url`; a CS
 * cannot forge a `chrome-extension://` origin (`sender.url` is set by Chrome,
 * not the sender — spec §Sender-URL Binding), so this is a safe trust signal.
 */
function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  return typeof sender.url === 'string' && sender.url.startsWith('chrome-extension://');
}

function isPopupShape(sender: chrome.runtime.MessageSender): boolean {
  // Trusted extension page: no `sender.tab` (browser-action popup) OR an
  // extension-origin sender (options page in a tab).
  return sender.tab === undefined || isExtensionPageSender(sender);
}

function isContentScriptShape(sender: chrome.runtime.MessageSender): boolean {
  // Content-script messages have a tab id AND must be from the top frame AND
  // must NOT be an extension page (an extension page in a tab is trusted, not
  // a CS — exclude it so its popup-only RPCs aren't mis-gated as CS-only).
  return !isExtensionPageSender(sender) && sender.tab?.id !== undefined && sender.frameId === 0;
}

/**
 * Handle a single `chrome.runtime.onMessage` event. Returns a boolean
 * intended for use as the listener return value: `true` indicates the
 * message was accepted for async processing (matches Chrome's contract
 * for keeping `sendResponse` alive). `false` means the message was
 * rejected at the provenance gate.
 *
 * The `deps.route` callback receives validated messages — implementations
 * are responsible for per-type payload validation and response delivery.
 */
export function handleOnMessage(
  rawMsg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (resp: { ok: false; error: OnMessageError } | { ok: true; data: unknown }) => void,
  deps: OnMessageDeps,
): boolean {
  // 1. Sender ID gate. Foreign extensions and missing IDs hit the floor.
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: { kind: 'sender-rejected' } });
    return false;
  }

  // 2. Payload shape gate (just enough to read the discriminator).
  if (!isObject(rawMsg) || typeof rawMsg.type !== 'string') {
    sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
    return false;
  }

  const msg = rawMsg as { type: string } & Record<string, unknown>;

  // 3. Per-type sender-shape assertion.
  const senderIsPopup = isPopupShape(sender);
  const senderIsCs = isContentScriptShape(sender);
  // `got` describes what the sender LOOKS like by tab presence; the actual
  // gate uses the stricter `senderIsCs` (top-frame only). A subframe
  // content-script reports `got: 'content-script'` even though it fails
  // the gate.
  const got: 'popup' | 'content-script' = sender.tab === undefined ? 'popup' : 'content-script';

  if (POPUP_ONLY_TYPES.has(msg.type) && !senderIsPopup) {
    sendResponse({
      ok: false,
      error: { kind: 'sender-shape-mismatch', expected: 'popup', got },
    });
    return false;
  }
  if (CS_ONLY_TYPES.has(msg.type) && !senderIsCs) {
    sendResponse({
      ok: false,
      error: { kind: 'sender-shape-mismatch', expected: 'content-script', got },
    });
    return false;
  }

  // 3b. Fail-closed default (#196, spec §"Gate is allowlist, registered
  //     atomically"). A type in NEITHER provenance set previously reached the
  //     router by sender shape alone — so an accidentally-omitted position
  //     type would route ungated. Reject unknown types here so an omitted
  //     gate-registration fails closed (invalid-payload) instead of leaking.
  if (!POPUP_ONLY_TYPES.has(msg.type) && !CS_ONLY_TYPES.has(msg.type)) {
    sendResponse({ ok: false, error: { kind: 'invalid-payload' } });
    return false;
  }

  // 4. Hand off to the router. Async response is the router's contract;
  //    returning true tells Chrome to keep `sendResponse` alive.
  deps.route(msg, sender, sendResponse);
  return true;
}
