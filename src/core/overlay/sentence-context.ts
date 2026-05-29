/**
 * Surrounding-sentence context helper for the pause-state preview (#20).
 *
 * Pure data — no DOM, no chrome.*; safe for `src/core/`. The overlay
 * builds the preview region from the slices returned here; rendering and
 * visibility toggling live in `overlay.ts`.
 *
 * Sentence model intentionally mirrors the engine's `[.!?]$` predicate
 * (see `rsvp-engine.ts` `SENTENCE_END`, `snapToSentenceStart`,
 * `findNextSentenceStart`). Keeping the predicate identical means the
 * preview's "before / current / after" slices agree with
 * `seekToSentence('prev' | 'next')` navigation — the user sees the same
 * sentence shape the engine will jump within. Drift here would surface
 * as a subtle UX mismatch where ←/→ would skip past words the preview
 * had just shown as part of the current sentence.
 */

/** Match the engine's sentence terminator. Do NOT introduce a divergent regex. */
const SENTENCE_END = /[.!?]$/;

export interface SentenceContext {
  /** Words preceding the current word in the same sentence. May be empty. */
  readonly before: readonly string[];
  /** The current word (the one displayed when paused). */
  readonly current: string;
  /**
   * Words following the current word, up to `nextLimit` words after the
   * current sentence's terminator. The terminator itself stays in `after`.
   */
  readonly after: readonly string[];
}

export interface BuildSentenceContextOptions {
  /**
   * How many words past the current sentence's terminator to include in
   * `after`. Defaults to 3 (matches the issue body's "next few words").
   * Clipped at the end of `words`.
   */
  readonly nextLimit?: number;
}

const DEFAULT_NEXT_LIMIT = 3;

/**
 * Upper bound on how many words to walk backward for `before`. Defends
 * against pathological input (a 5000-word "sentence" with no `.!?`,
 * e.g. code blocks, URLs, transcripts) that would otherwise dump the
 * entire document into the preview and spike layout cost. 40 words is
 * a generous re-orientation window; longer sentences truncate to "…
 * <last 40 words of the sentence-so-far> <current> …". Surfaced by
 * perf-adversary F3.
 */
const BEFORE_MAX_WORDS = 40;

/**
 * Build the surrounding-sentence context for the word at `currentIndex`
 * in `words`. `currentIndex` is the index of the word CURRENTLY displayed
 * (not `engine.progress().index`, which is the count of emitted words —
 * the caller does the `- 1` conversion before calling).
 *
 * Returns `null` when the inputs cannot describe a current word:
 *   - `words.length === 0`
 *   - `currentIndex < 0`
 *   - `currentIndex >= words.length`
 *   - `currentIndex` is non-finite or non-integer
 *
 * The caller treats `null` as "don't render the preview".
 */
export function buildSentenceContext(
  words: readonly string[],
  currentIndex: number,
  options?: BuildSentenceContextOptions,
): SentenceContext | null {
  if (!Number.isInteger(currentIndex)) return null;
  if (words.length === 0) return null;
  if (currentIndex < 0 || currentIndex >= words.length) return null;

  const nextLimit = options?.nextLimit ?? DEFAULT_NEXT_LIMIT;
  const safeNextLimit =
    Number.isInteger(nextLimit) && nextLimit >= 0 ? nextLimit : DEFAULT_NEXT_LIMIT;

  // `before`: walk backward from currentIndex - 1 until we hit a
  // sentence terminator (exclusive), the start of the stream, OR the
  // BEFORE_MAX_WORDS bound. The bound caps render cost on pathological
  // input without changing prose behavior.
  const beforeFloor = Math.max(0, currentIndex - BEFORE_MAX_WORDS);
  let sentenceStart = beforeFloor;
  for (let i = currentIndex - 1; i >= beforeFloor; i--) {
    if (SENTENCE_END.test(words[i])) {
      sentenceStart = i + 1;
      break;
    }
  }
  const before = words.slice(sentenceStart, currentIndex);

  // `after`: walk forward from currentIndex until (and including) the
  // first sentence terminator, then continue for up to `nextLimit`
  // additional words. If the current word itself is a terminator,
  // `terminatorIndex` equals `currentIndex` and `after` starts past it.
  let terminatorIndex = -1;
  for (let i = currentIndex; i < words.length; i++) {
    if (SENTENCE_END.test(words[i])) {
      terminatorIndex = i;
      break;
    }
  }

  let afterEnd: number;
  if (terminatorIndex === -1) {
    // No terminator from currentIndex onward — last sentence runs to
    // end of stream. nextLimit doesn't apply because there's no
    // post-terminator region to bound.
    afterEnd = words.length;
  } else {
    afterEnd = Math.min(words.length, terminatorIndex + 1 + safeNextLimit);
  }
  const after = words.slice(currentIndex + 1, afterEnd);

  return {
    before,
    current: words[currentIndex],
    after,
  };
}
