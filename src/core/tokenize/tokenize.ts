/**
 * Pure tokenizer for the RSVP word stream.
 *
 * Splits a normalized plain-text string into RSVP-ready tokens. Output is
 * consumed directly by `createRsvpEngine({ words })`. Punctuation stays
 * attached to the preceding word so downstream pacing can detect sentence
 * boundaries.
 *
 * The output array is a mix of:
 *   - Word tokens — `"hello"`, `"world,"`, `"don't"`, `"3.14"`.
 *   - Structural tokens — emitted as standalone entries:
 *       - `"\n\n"` — paragraph break sentinel (run of ≥ 2 newlines in input).
 *       - `"—"`   — em-dash (U+2014).
 *       - `"–"`   — en-dash (U+2013).
 *
 * Consumers detect structural tokens via equality check ("\n\n", "—", "–").
 *
 * No DOM, no chrome.* / browser.* — safe for src/core/.
 */

// Invisible characters stripped before splitting. None of these should ever
// influence word boundaries:
//   U+0000 NUL, U+200B zero-width space, U+200C ZWNJ, U+200D ZWJ,
//   U+FEFF BOM, U+00AD soft hyphen.
// eslint-disable-next-line no-control-regex -- NUL stripped from input before serving as PARAGRAPH_SENTINEL.
const INVISIBLE_CHARS_RE = /\u0000|\u200B|\u200C|\u200D|\uFEFF|\u00AD/gu;

// Em/en-dash promoted to standalone tokens — dashes are pause markers, and
// date ranges (2024–2026) split for consistency with prose dashes.
const DASH_RE = /[—–]/gu;

const PARAGRAPH_RUN_RE = /[ \t]*\n[ \t]*(?:\n[ \t]*)+/gu;
// NUL sentinel: cannot collide with input because INVISIBLE_CHARS_RE strips
// any user-supplied NUL before this substitution runs.
const PARAGRAPH_SENTINEL = '\u0000';

const WHITESPACE_RE = /\s+/u;

export function tokenize(text: string): string[] {
  if (!text) return [];

  const cleaned = text
    .replace(INVISIBLE_CHARS_RE, '')
    .replace(PARAGRAPH_RUN_RE, ` ${PARAGRAPH_SENTINEL} `)
    .replace(DASH_RE, (m) => ` ${m} `);

  const trimmed = cleaned.trim();
  if (trimmed === '') return [];

  const tokens = trimmed.split(WHITESPACE_RE).map((t) => (t === PARAGRAPH_SENTINEL ? '\n\n' : t));

  // Spec rule: no leading/trailing sentinel.
  let start = 0;
  let end = tokens.length;
  while (start < end && tokens[start] === '\n\n') start++;
  while (end > start && tokens[end - 1] === '\n\n') end--;
  return tokens.slice(start, end);
}
