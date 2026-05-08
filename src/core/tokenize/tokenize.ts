/**
 * Pure tokenizer for the RSVP word stream.
 *
 * Splits a normalized plain-text string into RSVP-ready tokens. Output is
 * consumed directly by `createRsvpEngine({ words })`. Punctuation is kept
 * attached to the preceding word so #15 punctuation pacing can detect
 * sentence boundaries from the token stream.
 *
 * The output array is a mix of:
 *   - Word tokens — `"hello"`, `"world,"`, `"don't"`, `"3.14"`.
 *   - Structural tokens — emitted as standalone entries:
 *       - `"\n\n"` — paragraph break sentinel (run of ≥ 2 newlines in input).
 *       - `"—"`   — em-dash (U+2014).
 *       - `"–"`   — en-dash (U+2013).
 *
 * Downstream consumers (RSVP engine + #15 pacing + future #20 / #23) handle
 * structural tokens via equality check. The engine can render them as no-op
 * ticks or skip them; that is a future PR's call.
 *
 * No DOM, no chrome.* / browser.* — safe for src/core/.
 */

// Invisible characters stripped before splitting. None of these should ever
// influence word boundaries:
//   U+200B zero-width space, U+200C ZWNJ, U+200D ZWJ,
//   U+FEFF BOM, U+00AD soft hyphen.
// Written as Unicode escapes (not literals) so eslint's no-irregular-whitespace
// rule passes; also avoids the misleading-character-class rule firing on the
// ZWJ + BOM adjacency that would occur in a class form.
const INVISIBLE_CHARS_RE = /\u200B|\u200C|\u200D|\uFEFF|\u00AD/gu;

// Em-dash (U+2014) and en-dash (U+2013) are promoted to their own tokens.
// We surround each with spaces so the subsequent whitespace split naturally
// extracts them as standalone tokens. Handles both 'said—run' and 'said — run'
// with one rule, and date ranges like '2024–2026' split for consistency.
const DASH_RE = /[\u2014\u2013]/gu;

// Paragraph break sentinel: any run of 2+ newlines (with optional inline
// whitespace between them) collapses to a single "\n\n" token in the output.
// Replaced inline with a placeholder string surrounded by spaces, so the
// subsequent whitespace split preserves it as a single token; the placeholder
// is mapped back to the literal "\n\n" string after splitting.
const PARAGRAPH_RUN_RE = /[ \t]*\n[ \t]*(?:\n[ \t]*)+/gu;
const PARAGRAPH_SENTINEL = 'PB';

// Unicode whitespace split. Matches space, tab, newlines, line/paragraph
// separators, and other \p{White_Space} characters.
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

  // Strip leading / trailing paragraph-break sentinels (input had a paragraph
  // break at start or end with no content beyond it).
  let start = 0;
  let end = tokens.length;
  while (start < end && tokens[start] === '\n\n') start++;
  while (end > start && tokens[end - 1] === '\n\n') end--;
  return start === 0 && end === tokens.length ? tokens : tokens.slice(start, end);
}
