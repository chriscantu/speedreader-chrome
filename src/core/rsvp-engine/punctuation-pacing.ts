/**
 * Safari-style punctuation pacing.
 *
 * Mirrors the cadence multipliers from chriscantu/speed-reader's
 * `Resources/rsvp/word-processor.js#calculateDelay`:
 *
 *   - Sentence-final punctuation (`.`, `!`, `?`) → 1.5× base delay
 *   - Clause break (`,`, `;`, `:`) → 1.2× base delay
 *   - Otherwise → 1.0× base delay
 *
 * Trailing closing brackets (`)`, `]`) and the common quote glyphs (`"`,
 * `'`, smart quotes `‘ ’ “ ”`) are tolerated — `(Hello.)` and `"Hi!"`
 * still count as sentence-final. The decision is governed by the FINAL
 * non-bracket character only, so abbreviations like `e.g.,` end on `,`
 * (clause break) and `etc.` ends on `.` (sentence-final).
 *
 * No DOM, no chrome.* / browser.* — safe for src/core/.
 */

export const PUNCTUATION_MULTIPLIER = {
  SENTENCE_END: 1.5,
  CLAUSE_BREAK: 1.2,
  DEFAULT: 1.0,
} as const;

// Trailing closing brackets and quote glyphs to strip before inspecting the
// final punctuation char. Matches Safari's tolerated set: ) ] " ' ‘ ’ “ ”
const TRAILING_BRACKETS_AND_QUOTES = /[)\]"'‘’“”]+$/u;

/**
 * Returns the delay (in ms) for `word` given a base per-word delay.
 *
 * Null / undefined / empty input returns `baseDelayMs` unchanged — the
 * engine MUST never schedule a NaN timeout.
 */
export function calculatePunctuationDelay(
  word: string | null | undefined,
  baseDelayMs: number,
): number {
  if (!word) return baseDelayMs;
  const stripped = word.replace(TRAILING_BRACKETS_AND_QUOTES, '');
  const last = stripped.charAt(stripped.length - 1);
  if (last === '.' || last === '!' || last === '?') {
    return baseDelayMs * PUNCTUATION_MULTIPLIER.SENTENCE_END;
  }
  if (last === ',' || last === ';' || last === ':') {
    return baseDelayMs * PUNCTUATION_MULTIPLIER.CLAUSE_BREAK;
  }
  return baseDelayMs * PUNCTUATION_MULTIPLIER.DEFAULT;
}
