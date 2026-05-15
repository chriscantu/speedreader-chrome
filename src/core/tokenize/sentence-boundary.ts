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

export type MarkedToken =
  | { kind: 'word'; text: string; sentenceStart: boolean; sentenceEnd: boolean }
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
const ABBREVIATION_RE = /\b(?:Dr|Mr|Mrs|Ms|St|Prof|Sr|Jr)\.(?:\[[^\]]*\]|\([^)]*\)|["'”’)\]])*$/u;

function endsSentence(word: string): boolean {
  return SENTENCE_END_RE.test(word) && !ABBREVIATION_RE.test(word);
}

export function markSentenceBoundaries(tokens: string[]): MarkedToken[] {
  const out: MarkedToken[] = [];
  let nextWordStartsSentence = true;

  for (const token of tokens) {
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
    });
    nextWordStartsSentence = wordEnds;
  }

  return out;
}
