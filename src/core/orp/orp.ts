/**
 * Computes the Optimal Recognition Point (ORP) — the character index within
 * a word that the eye anchors to during RSVP reading. Used by the overlay
 * to render that character in a contrasting color so successive words align
 * visually under the reader's fixation point.
 *
 * Heuristic: Spritz-style length-bucketed table. Bounded at 4 so very long
 * words don't push the anchor off-center.
 *
 * Operates on UTF-16 code-unit length (String#length); ASCII / Latin-1
 * bias is accepted for MVP. Surrogate pairs and grapheme clusters are
 * out of scope.
 *
 * Empty-string input returns 0 (degenerate — caller should typically
 * filter empty tokens before reaching here).
 */
export function orp(word: string): number {
  const len = word.length;
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}
