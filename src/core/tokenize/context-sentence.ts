/**
 * Returns the sentence containing the word at the engine's current word index,
 * plus the position of that word within the sentence.
 *
 * Designed for the overlay's context-preview line. Ported from the Safari
 * reference (`chriscantu/speed-reader/tests/js/state-machine.test.js` —
 * `contextSentence` describe block, non-chunk only).
 *
 * Chrome's engine owns a flat `string[]` of words; sentence-boundary metadata
 * lives on `MarkedToken[]` produced by `markSentenceBoundaries`. The helper
 * bridges the two: caller passes the engine's current word index, helper
 * walks the marked-token stream skipping paragraph/dash tokens and returns
 * the enclosing sentence's word texts + the highlight offset.
 *
 * Chunk-mode (chunkSize > 1) variants are deferred — tracked in issue #51.
 *
 * No DOM, no `chrome.*` / `browser.*` — safe for `src/core/`.
 */

import type { MarkedToken } from './sentence-boundary';

/**
 * `words` is the in-sentence word texts (preserves attached punctuation).
 * `highlightIndex` is the offset within `words` of the engine's current word,
 * or `-1` when the current word is out of range / input is empty.
 *
 * Matches the Safari API shape so the overlay can render highlight directly
 * against the returned word list.
 */
export interface ContextSentence {
  words: string[];
  highlightIndex: number;
}

const EMPTY: ContextSentence = Object.freeze({ words: [] as string[], highlightIndex: -1 });

export function contextSentence(
  marks: readonly MarkedToken[],
  currentWordIndex: number,
): ContextSentence {
  // Reject non-integer / negative / NaN early — these map to "no current word"
  // (matches Safari behavior of returning empty when index is past end).
  if (!Number.isInteger(currentWordIndex) || currentWordIndex < 0) {
    return EMPTY;
  }

  // Single linear pass. Track sentence boundaries on the fly so we can
  // slice the enclosing sentence without backtracking. Word tokens carry
  // sentenceStart/sentenceEnd; paragraph/dash tokens do not contribute to
  // the engine's word index. Once we've passed the target word, we keep
  // appending until the sentence ends (or a new one starts).
  let wordCounter = 0;
  let sentenceWords: string[] = [];
  let sentenceStartWordIndex = 0;
  let foundHighlight = -1;

  for (const mark of marks) {
    if (mark.kind !== 'word') {
      continue;
    }

    if (mark.sentenceStart) {
      // New sentence begins. If we already locked in a highlight, the
      // previous sentence is complete — return it.
      if (foundHighlight !== -1) {
        return { words: sentenceWords, highlightIndex: foundHighlight };
      }
      sentenceWords = [];
      sentenceStartWordIndex = wordCounter;
    }

    sentenceWords.push(mark.text);

    if (wordCounter === currentWordIndex) {
      foundHighlight = currentWordIndex - sentenceStartWordIndex;
    }

    if (mark.sentenceEnd && foundHighlight !== -1) {
      return { words: sentenceWords, highlightIndex: foundHighlight };
    }

    wordCounter++;
  }

  // Walked to end of stream. If we found the target along the way, the
  // tail sentence (no terminal punctuation) is the answer; otherwise the
  // index was past the end.
  if (foundHighlight !== -1) {
    return { words: sentenceWords, highlightIndex: foundHighlight };
  }
  return EMPTY;
}
