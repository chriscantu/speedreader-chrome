/**
 * Multi-word chunk builder for RSVP.
 *
 * Port of `chriscantu/speed-reader`'s Safari `chunk-builder.js`. Groups
 * a word-only token stream into display chunks of size 1, 2, or 3 while
 * respecting sentence boundaries — a chunk NEVER spans a sentence start.
 *
 * Indices in the output (`startIndex` / `endIndex`) index into the
 * filtered word stream — the position of each `kind: 'word'` token in
 * the array passed in. Consumers responsible for the engine word axis
 * receive that same array, so the indices are directly addressable.
 *
 * No DOM, no chrome.* / browser.* — safe for src/core/.
 */

import type { MarkedToken } from '../tokenize/sentence-boundary';

/** A word-only MarkedToken — the subset `buildChunks` operates on. */
export type WordToken = Extract<MarkedToken, { kind: 'word' }>;

/** Supported chunk sizes. Bounded by the V6 schema (`1 | 2 | 3`). */
export type ChunkSize = 1 | 2 | 3;

/**
 * A display chunk — one or more words shown together at a single RSVP tick.
 *
 * `startIndex` / `endIndex` are inclusive positions into the input word
 * stream (the array passed to `buildChunks`). For the engine, the input
 * is the filtered word stream, so consumers can map directly back to
 * the word axis without further bookkeeping.
 *
 * `words` holds references to the original `MarkedToken` objects (NOT
 * copies) so downstream consumers can compare by reference and inspect
 * boundary metadata (`sentenceStart` / `sentenceEnd`) without re-walking
 * the source array.
 */
export interface Chunk {
  words: WordToken[];
  startIndex: number;
  endIndex: number;
  text: string;
}

/**
 * Group `words` into chunks of up to `chunkSize`, breaking before any
 * word that starts a sentence. A chunk-of-1 case (`chunkSize === 1`)
 * trivially produces one chunk per word; sentence-boundary handling
 * is a no-op there because the inner while loop never adds extras.
 *
 * Empty input returns `[]` (matches Safari's early return). Single-word
 * sentences (e.g. `Stop.`) produce single-word chunks even when
 * `chunkSize > 1` — the next word's `sentenceStart: true` flag halts
 * the accumulator.
 */
export function buildChunks(words: WordToken[], chunkSize: ChunkSize): Chunk[] {
  if (words.length === 0) return [];

  const chunks: Chunk[] = [];
  let i = 0;
  while (i < words.length) {
    const chunkWords: WordToken[] = [words[i]];
    let j = i + 1;
    // Extend the chunk until we hit chunkSize OR a sentence-start
    // boundary on the next candidate word. Matches Safari semantics:
    // the FIRST word of a chunk is taken unconditionally (the sentence
    // it starts is the chunk's sentence); subsequent words bail if
    // they would cross into a new sentence.
    while (chunkWords.length < chunkSize && j < words.length) {
      if (words[j].sentenceStart) break;
      chunkWords.push(words[j]);
      j++;
    }
    chunks.push({
      words: chunkWords,
      startIndex: i,
      endIndex: j - 1,
      text: chunkWords.map((w) => w.text).join(' '),
    });
    i = j;
  }
  return chunks;
}
