/**
 * Session-scoped reading-position memory for the SpeedReader content script.
 *
 * Issue #25 — when the user closes the overlay (Esc or ✕) and re-activates
 * the reader on the SAME document during the SAME content-script lifetime,
 * the overlay resumes at the word index where they left off. Bounded by:
 *
 * - **In-memory only.** Persistence across page reloads / navigations is
 *   tracked under #48; this module deliberately does NOT touch
 *   `chrome.storage`.
 * - **Per-scope.** Selection and full-article streams are different word
 *   sequences, so they're keyed separately. Resuming from a selection
 *   index against the full stream would land on the wrong word.
 * - **Stream-length guarded.** If the host page mutates between close and
 *   reopen (dynamic content, ad insertion) and the recomputed word count
 *   differs, the stored index is treated as stale and ignored — a false
 *   resume on a shifted stream is worse than starting from the top.
 *
 * Lifetime: the `Map` is module-scoped, so it dies with the content
 * script. A fresh navigation re-injects the CS and starts with an empty
 * map, matching the "session = current document" bound the issue calls
 * out.
 *
 * Pure logic, no `chrome.*` — kept testable as a unit.
 */

import type { OverlayCloseSnapshot, OverlayScope } from '../../core/overlay';

interface StoredPosition {
  readonly index: number;
  readonly wordCount: number;
}

const sessionPositions = new Map<OverlayScope, StoredPosition>();

/**
 * Record the close-time engine state under the active scope. Snapshots
 * from never-started overlays (`undefined`) and from empty streams
 * (`total === 0`) are ignored — they carry no useful position. An
 * `index === 0` snapshot IS recorded; the user closing immediately on
 * mount is still a "they read zero words" signal, and resumeIndex below
 * treats 0 as no-op anyway.
 */
export function recordClose(snapshot: OverlayCloseSnapshot | undefined): void {
  if (!snapshot) return;
  if (snapshot.total <= 0) return;
  sessionPositions.set(snapshot.scope, {
    index: snapshot.index,
    wordCount: snapshot.total,
  });
}

/**
 * Look up a resume index for `scope` against the freshly-recomputed
 * `wordCount`. Returns `undefined` when nothing is stored for the scope,
 * when the stored index is at or past the new word count (page shifted
 * shorter or the user finished), OR when the stored stream length
 * disagrees with the new one (page mutated; stale). Callers should pass
 * the result straight into `OverlayOptions.initialIndex`.
 */
export function resumeIndex(scope: OverlayScope, wordCount: number): number | undefined {
  const entry = sessionPositions.get(scope);
  if (!entry) return undefined;
  if (entry.wordCount !== wordCount) return undefined;
  if (entry.index <= 0) return undefined;
  if (entry.index >= wordCount) return undefined;
  return entry.index;
}

/**
 * Test-only escape hatch — wipes the session map. Production code never
 * calls this; production resets happen by content-script re-injection.
 */
export function __resetSessionPositionsForTests(): void {
  sessionPositions.clear();
}
