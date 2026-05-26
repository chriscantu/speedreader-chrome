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

/**
 * Source of an activation attempt.
 *
 * NOTE: this uses `'commands'` (plural) to match the `chrome.commands` API
 * surface. The SW-lifecycle spec uses `'command'` (singular) in its
 * pseudocode; we follow the issue #122 task contract verbatim. The string
 * is internal — not on the wire — so the rename is a local choice.
 */
export type ActivationSource = 'commands' | 'contextMenu' | 'popup';

/** Activation triggered by a `chrome.commands` hotkey. */
export interface CommandsActivationIntent {
  source: 'commands';
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
}

/** Activation triggered by the popup. */
export interface PopupActivationIntent {
  source: 'popup';
  tabId: number;
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
