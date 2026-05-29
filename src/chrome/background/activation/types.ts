/**
 * Activation-intent types — the normalized shape produced by the dispatch
 * funnel for every activation source (commands hotkey, context menu, popup).
 *
 * Discriminated union: switch on `intent.source` ONLY for payload
 * normalization (e.g., extracting `selectionText` from the context-menu
 * variant). The core dispatch flow (restricted-URL guard → inject CS →
 * handoff to `rsvp-session` Port) is one branchless path.
 *
 * See:
 * - `docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 *   §"Unified Activation Dispatch"
 * - `docs/superpowers/specs/2026-05-08-messaging-contract.md`
 *   §"Envelope Shape" — `Result<T, E>` is the canonical wire envelope.
 *
 * The messaging-contract spec defines `Result<T>` with a string `reason`;
 * this file widens it to `Result<T, E>` so the activation layer can carry
 * a typed `ActivationError` discriminated union without losing the spec's
 * envelope shape (a string `reason` still satisfies the wider parameter).
 */

import type { Overrides } from '../../../core/messaging/validate';
import type { CtxMenuItemId } from '../context-menu/factory';

/**
 * Source of an activation attempt.
 *
 * Uses `'command'` (singular) per the SW-lifecycle ADR pseudocode. The
 * string is internal — not on the wire — so any future bridge to the
 * `chrome.commands` API surface lives at the listener layer, not here.
 */
export type ActivationSource = 'command' | 'contextMenu' | 'popup';

/** Activation triggered by a `chrome.commands` hotkey. */
export interface CommandsActivationIntent {
  source: 'command';
  tabId: number;
}

/** Activation triggered by a `chrome.contextMenus` click. */
export interface ContextMenuActivationIntent {
  source: 'contextMenu';
  tabId: number;
  /**
   * Selection text from `info.selectionText`, if any. This is
   * page-controlled and untrusted; the dispatch funnel passes the boolean
   * intent ("was a selection present?") downstream, but the CS re-reads
   * `window.getSelection().toString()` for the authoritative value. See
   * the SW-lifecycle spec §"Context-Menu Selection Trust".
   */
  selectionText?: string;
  /**
   * Clicked menu item ID — narrowed from `string` so the listener's
   * dispatch switch is exhaustive at compile time. See the context-menu
   * integration spec §"Submenu Structure" → "Item IDs".
   */
  menuItemId: CtxMenuItemId;
  /**
   * Per-activation overrides supplied by the context-menu source (e.g.,
   * `{ wpm: 300 }` for a preset click). Forwarded by the funnel into the
   * `activate-reader` payload's `overrides` slot. Absent for activations
   * that don't carry presets. See the context-menu integration spec
   * §"Activation Payload Extension".
   */
  overrides?: Overrides;
}

/** Activation triggered by the popup. */
export interface PopupActivationIntent {
  source: 'popup';
  tabId: number;
  /**
   * Issue #18 — popup-driven scope selection.
   *
   * The popup surfaces both "Read article" (full extraction) and "Read
   * selection" (fallback when auto-extraction fails on SPAs / paywalls /
   * odd DOM). Forwarded to `intentToActivatePayload` so the CS receives
   * `scope: 'selection'` instead of defaulting to `'full'`.
   *
   * Required — every popup producer in this PR sets it explicitly, and
   * the type system catches a future caller that forgets. The CS already
   * handles empty-selection fallback when `scope === 'selection'` and
   * `window.getSelection()` is empty (see `activate-handler-scope.test.ts`).
   */
  scope: 'selection' | 'full';
}

/** Normalized activation intent — discriminated union over `source`. */
export type ActivationIntent =
  | CommandsActivationIntent
  | ContextMenuActivationIntent
  | PopupActivationIntent;

/**
 * Result envelope. Mirrors the messaging-contract spec's `Result<T>` with
 * a typed error parameter so activation can carry an `ActivationError`
 * discriminated union without an `as` cast.
 */
export type Result<T, E = { reason: string; details?: unknown }> =
  | { ok: true; data: T }
  | { ok: false; error: E };

/** Errors that the activation funnel can surface. */
export type ActivationError =
  | { kind: 'restricted-page'; url: string }
  | { kind: 'tab-unavailable'; tabId: number; details?: unknown }
  | { kind: 'inject-failed'; tabId: number; details?: unknown }
  | { kind: 'handoff-failed'; tabId: number; details?: unknown };
