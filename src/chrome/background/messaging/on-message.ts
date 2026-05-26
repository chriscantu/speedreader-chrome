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
]);

/**
 * Message types that may only arrive from a content script (post-MVP
 * CS→SW signals). Listed here so the gate refuses popup-shaped senders
 * for these types.
 */
const CS_ONLY_TYPES = new Set<string>(['cs-progress', 'overlay-state']);

import type { ActivationError } from '../activation/types';

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

function isPopupShape(sender: chrome.runtime.MessageSender): boolean {
  // Popup messages come from an extension page; no `sender.tab`.
  return sender.tab === undefined;
}

function isContentScriptShape(sender: chrome.runtime.MessageSender): boolean {
  // Content-script messages have a tab id AND must be from the top frame.
  return sender.tab?.id !== undefined && sender.frameId === 0;
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

  // 4. Hand off to the router. Async response is the router's contract;
  //    returning true tells Chrome to keep `sendResponse` alive.
  deps.route(msg, sender, sendResponse);
  return true;
}
