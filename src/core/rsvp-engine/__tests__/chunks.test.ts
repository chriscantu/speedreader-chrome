/**
 * Port of Safari `buildChunks` test suite — chriscantu/speed-reader's
 * `tests/js/chunk-builder.test.js` adapted to the Chrome `MarkedToken`
 * model.
 *
 * Safari's helper `words([...])` returned `{ text, index }`-shaped tokens.
 * Chrome's word tokens carry `{ kind: 'word', text, sentenceStart,
 * sentenceEnd }` (no `index` — derived from filtered-word position).
 * The test helper below builds a sentence-marked stream via the canonical
 * `tokenize` + `markSentenceBoundaries` pipeline so the boundary semantics
 * tested here match what the engine actually sees in production.
 *
 * 11 cases mirror the Safari source verbatim:
 *  - chunkSize=1 (1)  - chunkSize=2 (2)  - chunkSize=3 (1)
 *  - sentence boundaries (3)  - edge cases (3)  - identity reference (1)
 */

import { describe, it, expect } from 'vitest';
import { buildChunks } from '../chunks';
import { markSentenceBoundaries } from '../../tokenize/sentence-boundary';
import { tokenize } from '../../tokenize/tokenize';
import type { MarkedToken } from '../../tokenize/sentence-boundary';

/**
 * Build a word-only `MarkedToken[]` stream from a Safari-style word list.
 *
 * Joining with space and running through `tokenize` + `markSentenceBoundaries`
 * keeps the test honest — `sentenceStart` / `sentenceEnd` flags come from
 * the same code path the engine uses. Filters out non-word tokens
 * (paragraph sentinels, dashes) because `buildChunks` consumes a
 * word-only stream per its signature.
 */
function words(texts: string[]): Array<Extract<MarkedToken, { kind: 'word' }>> {
  const marked = markSentenceBoundaries(tokenize(texts.join(' ')));
  return marked.filter((t): t is Extract<MarkedToken, { kind: 'word' }> => t.kind === 'word');
}

describe('buildChunks', () => {
  describe('chunkSize = 1', () => {
    it('produces one chunk per word', () => {
      const w = words(['Hello', 'world.']);
      const chunks = buildChunks(w, 1);
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toBe('Hello');
      expect(chunks[0].startIndex).toBe(0);
      expect(chunks[0].endIndex).toBe(0);
      expect(chunks[1].text).toBe('world.');
      expect(chunks[1].startIndex).toBe(1);
      expect(chunks[1].endIndex).toBe(1);
    });
  });

  describe('chunkSize = 2', () => {
    it('groups words into pairs', () => {
      const w = words(['The', 'quick', 'brown', 'fox.']);
      const chunks = buildChunks(w, 2);
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toBe('The quick');
      expect(chunks[0].startIndex).toBe(0);
      expect(chunks[0].endIndex).toBe(1);
      expect(chunks[1].text).toBe('brown fox.');
      expect(chunks[1].startIndex).toBe(2);
      expect(chunks[1].endIndex).toBe(3);
    });

    it('handles odd word count with shorter final chunk', () => {
      const w = words(['One', 'two', 'three.']);
      const chunks = buildChunks(w, 2);
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toBe('One two');
      expect(chunks[1].text).toBe('three.');
      expect(chunks[1].words.length).toBe(1);
    });
  });

  describe('chunkSize = 3', () => {
    it('groups words into triples', () => {
      const w = words(['The', 'quick', 'brown', 'fox', 'jumps', 'over.']);
      const chunks = buildChunks(w, 3);
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toBe('The quick brown');
      expect(chunks[1].text).toBe('fox jumps over.');
    });
  });

  describe('sentence boundaries', () => {
    it('breaks chunk at sentence boundary', () => {
      const w = words(['Hello', 'world.', 'Goodbye', 'world.']);
      const chunks = buildChunks(w, 3);
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toBe('Hello world.');
      expect(chunks[0].words.length).toBe(2);
      expect(chunks[1].text).toBe('Goodbye world.');
      expect(chunks[1].words.length).toBe(2);
    });

    it('produces single-word chunk when sentence is one word', () => {
      const w = words(['Stop.', 'Go.']);
      const chunks = buildChunks(w, 3);
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toBe('Stop.');
      expect(chunks[1].text).toBe('Go.');
    });

    it('handles sentence boundary at position 2 of a 3-word chunk', () => {
      const w = words(['A', 'B.', 'C', 'D', 'E.']);
      const chunks = buildChunks(w, 3);
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toBe('A B.');
      expect(chunks[1].text).toBe('C D E.');
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      expect(buildChunks([], 2)).toEqual([]);
    });

    it('handles single word', () => {
      const w = words(['Hello.']);
      const chunks = buildChunks(w, 3);
      expect(chunks.length).toBe(1);
      expect(chunks[0].text).toBe('Hello.');
    });

    it('chunk words array contains references to original word objects', () => {
      const w = words(['The', 'cat.']);
      const chunks = buildChunks(w, 2);
      // Reference equality — the chunk's `words` array MUST point at the
      // same MarkedToken objects, not copies (Safari source asserts the
      // same via `assert.strictEqual`). Reference identity matters for
      // downstream consumers that mutate or compare by reference.
      expect(chunks[0].words[0]).toBe(w[0]);
      expect(chunks[0].words[1]).toBe(w[1]);
    });
  });
});
