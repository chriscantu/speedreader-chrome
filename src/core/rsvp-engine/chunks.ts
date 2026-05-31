/**
 * Multi-word chunk builder for RSVP.
 *
 * Port of `chriscantu/speed-reader`'s Safari `chunk-builder.js`. Groups
 * a word-only token stream into display chunks of size 1, 2, or 3 while
 * respecting sentence boundaries — a chunk NEVER spans a sentence start.
 *
 * Indices in the output (`startIndex` / `endIndex`) key to the RAW
 * token-axis — `WordToken.rawIndex`, the 0-based position of the word
 * in the source array passed to `markSentenceBoundaries` (which
 * INCLUDES paragraph + dash tokens). This keeps chunk indices on the
 * same axis as the engine's raw `nextIndex`, so `chunk.startIndex ===
 * N` and `engine.nextIndex === N` always point at the same token —
 * load-bearing for #47 scrubber + #48 cross-mode position persistence.
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
 * `startIndex` / `endIndex` are inclusive positions on the RAW token-axis
 * — the `rawIndex` of the chunk's first / last `WordToken`. The raw axis
 * is what the engine's `nextIndex` indexes against (and what
 * `markSentenceBoundaries` numbers from), so consumers can compare
 * chunk bounds against engine state directly. For a stream with no
 * paragraph / dash tokens this collapses to the filtered-word position
 * (back-compat with the pre-rawIndex shape); with structural tokens
 * interleaved, the two axes diverge and the raw axis wins.
 *
 * `words` holds references to the original `MarkedToken` objects (NOT
 * copies) so downstream consumers can compare by reference and inspect
 * boundary metadata (`sentenceStart` / `sentenceEnd` / `rawIndex`)
 * without re-walking the source array.
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
      // Raw-axis indices: take the rawIndex of the FIRST and LAST
      // words. For dense word streams this is identical to (i, j-1);
      // for streams with paragraph / dash tokens interleaved, the
      // raw indices skip over the structural slots so the chunk's
      // bounds align with the engine's nextIndex axis.
      startIndex: chunkWords[0].rawIndex,
      endIndex: chunkWords[chunkWords.length - 1].rawIndex,
      text: chunkWords.map((w) => w.text).join(' '),
    });
    i = j;
  }
  return chunks;
}
