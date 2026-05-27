/**
 * Content-script `activate-reader` handler — pure function.
 *
 * Issue #134 (CS-side recheck) — the SW-side post-injection
 * `isRestricted` recheck (PR #133) cannot close the microtask window
 * between the SW's recheck and `chrome.tabs.sendMessage`. A tab that
 * navigates to a restricted origin inside that window would have the
 * CS land `activate-reader` against the new (potentially restricted)
 * document. The CS has authoritative knowledge of its own
 * `location.href` and re-runs the same `isRestricted` predicate the
 * SW uses before invoking the overlay.
 *
 * This module is intentionally pure — it takes `url` and
 * `ownExtensionId` as inputs rather than reading `location.href` /
 * `chrome.runtime.id` directly. The listener wiring in `index.ts`
 * supplies those. Keeping the predicate pure makes it unit-testable in
 * node, mirrors the `src/core/restricted.ts` contract, and decouples
 * the gate from the future overlay implementation.
 *
 * Today the handler returns `{ ok: true }` without mounting an overlay
 * (overlay implementation tracked under #19/#20). The security
 * primitive lands ahead of the overlay so the gate is already in place
 * when the overlay arrives.
 */

import { isRestricted } from '../../core/restricted';

export type ActivateReaderResponse = { ok: true } | { ok: false; reason: 'restricted-cs' };

/**
 * Decide whether the CS should honor an `activate-reader` message
 * given the current document URL and the extension's own runtime id.
 *
 * Refuses (`restricted-cs`) when `isRestricted(url, ownExtensionId)`
 * is true OR when the URL is empty / malformed. The malformed-URL
 * branch is defense-in-depth — a content script normally always has a
 * valid `location.href`, but an attacker context that can spoof the
 * message envelope shouldn't bypass the gate by passing a bogus URL.
 */
export function handleActivateReader(url: string, ownExtensionId: string): ActivateReaderResponse {
  if (isRestricted(url, ownExtensionId)) {
    return { ok: false, reason: 'restricted-cs' };
  }
  return { ok: true };
}
