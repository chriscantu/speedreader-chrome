/**
 * Computes the Optimal Recognition Point (ORP) — the character index within
 * a word that the eye anchors to during RSVP reading. Used by the overlay
 * to render that character in a contrasting color so successive words align
 * visually under the reader's fixation point.
 *
 * Ported for parity from the Safari reference implementation:
 *   chriscantu/speed-reader →
 *   SpeedReader/SpeedReaderExtension/Resources/rsvp/focus-point.js
 *   (calculateFocusPoint, lines 10-14).
 *
 * Heuristic:
 *   - Strip trailing punctuation [.,!?;:]+ from the word.
 *   - If the stripped length is <= 3, return 0 (anchor on the first char).
 *   - Otherwise, return floor(strippedLength * 0.3).
 *
 * This diverges from canonical Spritz length-bucket tables: Safari uses a
 * single 30%-of-length formula with a short-word floor instead of a stepped
 * table, and explicitly accounts for trailing sentence punctuation so that
 * "hello," anchors the same character as "hello".
 *
 * Operates on UTF-16 code-unit length (String#length); ASCII / Latin-1
 * bias is accepted for MVP, matching Safari's behavior. Surrogate pairs
 * and grapheme clusters are out of scope.
 *
 * Empty-string input returns 0 (degenerate — caller should typically
 * filter empty tokens before reaching here). The Safari reference does
 * not test empty input directly; this is an explicit Chrome-side
 * extension of the contract for engine safety.
 */
export function orp(word: string): number {
  const stripped = word.replace(/[.,!?;:]+$/, '');
  if (stripped.length <= 3) return 0;
  return Math.floor(stripped.length * 0.3);
}

/**
 * Splits a word at its ORP into three parts so the overlay can render the
 * focus character in a contrasting color while preserving the rest of the
 * word around it.
 *
 * Ported for parity from the Safari reference implementation:
 *   chriscantu/speed-reader →
 *   SpeedReader/SpeedReaderExtension/Resources/rsvp/focus-point.js
 *   (splitWordAtFocus).
 *
 * The split uses the ORP index from {@link orp} against the ORIGINAL word
 * (not the punctuation-stripped form), so trailing punctuation remains in
 * the `after` part. Empty input is treated as a degenerate case and all
 * three parts are empty strings.
 */
export function splitWordAtFocus(word: string): {
  before: string;
  focus: string;
  after: string;
} {
  if (word === '') return { before: '', focus: '', after: '' };
  const idx = orp(word);
  return {
    before: word.slice(0, idx),
    focus: word.charAt(idx),
    after: word.slice(idx + 1),
  };
}
