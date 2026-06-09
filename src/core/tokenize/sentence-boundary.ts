/**
 * Sentence-boundary detection over the `tokenize` output stream.
 *
 * Layered helper — does not modify `tokenize` itself. Single linear pass.
 * Designed against `docs/superpowers/specs/2026-05-14-sentence-boundary.md`;
 * see that spec for the algorithm rationale, the 21 worked test cases,
 * and the three documented Chrome divergences from Safari (ellipsis as
 * terminator, CJK terminators, honorific exemption).
 *
 * No DOM, no `chrome.*` / `browser.*` — safe for `src/core/`.
 */

/**
 * A token from `tokenize` with sentence-boundary metadata overlaid.
 *
 * Structural invariants (encoded in the discriminant):
 * - `sentenceStart` and `sentenceEnd` live ONLY on `kind: 'word'` tokens.
 * - `paragraph.text` is always the literal `'\n\n'`.
 * - `dash.text` is always `'—'` (em) or `'–'` (en).
 * - `rawIndex` (on `kind: 'word'`) is the 0-based position of the token in
 *   the SOURCE token array passed to `markSentenceBoundaries` — INCLUDING
 *   paragraph + dash tokens. Lets downstream consumers (chunk builder,
 *   engine seek logic) keep a single canonical "raw word axis" so that
 *   `word.rawIndex === engine.nextIndex` and `chunk.startIndex ===
 *   word.rawIndex` for the chunk's first word. Without this field
 *   chunk-mode indices key to local filtered-word positions, which
 *   diverge from the raw axis for any article with non-word tokens
 *   (issue #51 architect HIGH — would break #47 scrubber + #48 cross-mode
 *   position persistence).
 *
 * Sequential invariants (NOT encoded in the type; held by
 * `markSentenceBoundaries` and verified by tests):
 * - The first `kind: 'word'` token in non-empty input has `sentenceStart: true`.
 * - The first `kind: 'word'` token after a `kind: 'paragraph'` has `sentenceStart: true`.
 * - The next `kind: 'word'` after a word with `sentenceEnd: true` has `sentenceStart: true`.
 * - `markSentenceBoundaries(tokens).length === tokens.length` — the helper is a 1:1 mapping.
 * - `out[i].rawIndex === i` for every `kind: 'word'` token (1:1 mapping
 *   preserves source positions).
 *
 * Encoding the sequential invariants in the type would require dependent-type
 * shapes (non-empty-list witnesses, etc.) that burden every consumer with
 * destructuring. The producer + tests carry those invariants instead.
 */
export type MarkedToken =
  | {
      kind: 'word';
      text: string;
      sentenceStart: boolean;
      sentenceEnd: boolean;
      rawIndex: number;
    }
  | { kind: 'paragraph'; text: '\n\n' }
  | { kind: 'dash'; text: '—' | '–' };

const PARAGRAPH_SENTINEL = '\n\n';
const EM_DASH = '—';
const EN_DASH = '–';

// Matches sentence-terminating punctuation (Latin + ellipsis + CJK) optionally
// followed by trailing closing artifacts in any order:
//   - complete bracket group `[...]`
//   - complete paren group `(...)`
//   - single closing quote / bracket / paren / square-bracket
// Anchored at `$` so it only fires when the trailing artifacts are at the
// very end of the word. Three alternation branches start with distinct
// leading characters — no catastrophic-backtracking surface.
const SENTENCE_END_RE = /[.!?…。！？](?:\[[^\]]*\]|\([^)]*\)|["'”’)\]])*$/u;

// Honorific exemption — small bounded set of English titles that end in `.`
// but should NOT close a sentence even when matched by SENTENCE_END_RE.
// Same trailing-artifact tail so `Dr.[Smith]` matches the exemption (not
// just bare `Dr.`).
//
// Set is deliberately small. Expanding to `No.`/`e.g.`/`i.e.`/`Inc.`/`Ph.D.`/etc.
// trades correct exemptions for false negatives (e.g., `No.` at end of a
// sentence). Read spec §"Looks like an abbreviation" before adding to this set.
const ABBREVIATION_RE = /\b(?:Dr|Mr|Mrs|Ms|St|Prof|Sr|Jr)\.(?:\[[^\]]*\]|\([^)]*\)|["'”’)\]])*$/u;

/**
 * Single source of truth for "does this word end a sentence?" (#208).
 *
 * Shared by `markSentenceBoundaries` (chunk-mode `sentenceStart` flags),
 * the engine's `snapToSentenceStart` / `findNextSentenceStart`
 * (`seekToSentence` navigation), and the pause-state preview
 * (`overlay/sentence-context.ts`). All three consumers MUST agree —
 * divergent predicates surface as the preview showing one sentence
 * shape while seek/chunks use another (issue #208's defect).
 */
export function endsSentence(word: string): boolean {
  return SENTENCE_END_RE.test(word) && !ABBREVIATION_RE.test(word);
}

export function markSentenceBoundaries(tokens: string[]): MarkedToken[] {
  const out: MarkedToken[] = [];
  let nextWordStartsSentence = true;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === PARAGRAPH_SENTINEL) {
      out.push({ kind: 'paragraph', text: PARAGRAPH_SENTINEL });
      nextWordStartsSentence = true;
      continue;
    }
    if (token === EM_DASH || token === EN_DASH) {
      out.push({ kind: 'dash', text: token });
      continue;
    }
    const wordEnds = endsSentence(token);
    out.push({
      kind: 'word',
      text: token,
      sentenceStart: nextWordStartsSentence,
      sentenceEnd: wordEnds,
      // rawIndex pins each word token to its position in the source
      // array (includes paragraph + dash tokens) so consumers that
      // need to map a word token back to the engine's raw-word axis
      // (chunk builder, seek logic) can do so without re-walking.
      rawIndex: i,
    });
    nextWordStartsSentence = wordEnds;
  }

  return out;
}
