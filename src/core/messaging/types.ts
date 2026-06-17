/**
 * Position-store RPC message registry (#196).
 *
 * Additive to the messaging-contract spec (`2026-05-08-messaging-contract.md`).
 * These are the six one-shot `sendMessage` RPCs the SW-owned reading-position
 * store exposes. The split into content-script-only and popup-only types is the
 * security invariant made syntactic: **no content-script message type carries a
 * `url`** — the SW derives the URL from `sender.url` for CS senders. See
 * `docs/superpowers/specs/2026-06-11-position-store-service-worker.md`
 * §"Sender-URL Binding".
 *
 * `src/core/` boundary: pure type/data, no `chrome.*`. The provenance sets
 * (`CS_POSITION_TYPES` / `POPUP_POSITION_TYPES`) are the single source of truth
 * consumed by `background/messaging/on-message.ts` so handler wiring and gate
 * membership cannot drift apart (the spec's "atomic registration" rule).
 */

import type { ReadingPosition } from '../storage/reading-position';

/**
 * Content-script-originated position types. Each is sender-bound: the SW reads
 * the page URL from `sender.url`, never from the payload. None carries a `url`.
 */
export const CS_POSITION_TYPES = ['position/get', 'position/set', 'position/clear'] as const;

/**
 * Popup-originated position types. These manage the full history surface and
 * MAY carry a `url` (trusted) or address all entries.
 */
export const POPUP_POSITION_TYPES = [
  'position/list',
  'position/delete',
  'position/clear-all',
] as const;

export type CsPositionType = (typeof CS_POSITION_TYPES)[number];
export type PopupPositionType = (typeof POPUP_POSITION_TYPES)[number];
export type PositionMessageType = CsPositionType | PopupPositionType;

// --- CS-side wire shapes (no `url`) ---------------------------------------

/** `position/get` — read the sender's own page position. URL from `sender.url`. */
export interface PositionGetMessage {
  readonly type: 'position/get';
}

/** `position/set` — persist the sender's own page position. URL from `sender.url`. */
export interface PositionSetMessage {
  readonly type: 'position/set';
  readonly wordIndex: number;
  readonly totalWords: number;
}

/** `position/clear` — delete the sender's own page position. URL from `sender.url`. */
export interface PositionClearMessage {
  readonly type: 'position/clear';
}

// --- Popup-side wire shapes ----------------------------------------------

/** `position/list` — full history, popup-only. */
export interface PositionListMessage {
  readonly type: 'position/list';
}

/** `position/delete` — delete one entry by URL, popup-only (trusted url). */
export interface PositionDeleteMessage {
  readonly type: 'position/delete';
  readonly url: string;
}

/** `position/clear-all` — wipe all entries, popup-only. */
export interface PositionClearAllMessage {
  readonly type: 'position/clear-all';
}

export type CsPositionMessage = PositionGetMessage | PositionSetMessage | PositionClearMessage;
export type PopupPositionMessage =
  | PositionListMessage
  | PositionDeleteMessage
  | PositionClearAllMessage;
export type PositionMessage = CsPositionMessage | PopupPositionMessage;

/** Response payload for `position/list`. */
export interface PositionListEntry {
  readonly url: string;
  readonly position: ReadingPosition;
}
