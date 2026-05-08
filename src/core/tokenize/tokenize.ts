/**
 * Pure tokenizer for the RSVP word stream.
 *
 * Splits a normalized plain-text string into RSVP-ready word tokens. Output
 * is consumed directly by `createRsvpEngine({ words })`. Punctuation is kept
 * attached to the preceding word so #15 punctuation pacing can detect
 * sentence boundaries from the token stream.
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

// Em-dash (U+2014) gets promoted to its own token. We surround it with spaces
// so the subsequent whitespace split naturally extracts it as a standalone
// token. Handles both 'said—run' and 'said — run' with one rule.
const EM_DASH_RE = /\u2014/gu;

// Unicode whitespace split. Matches space, tab, newlines, line/paragraph
// separators, and other \p{White_Space} characters.
const WHITESPACE_RE = /\s+/u;

export function tokenize(text: string): string[] {
  if (!text) return [];

  const cleaned = text.replace(INVISIBLE_CHARS_RE, '').replace(EM_DASH_RE, ' \u2014 ');
  const trimmed = cleaned.trim();
  if (trimmed === '') return [];

  return trimmed.split(WHITESPACE_RE);
}
