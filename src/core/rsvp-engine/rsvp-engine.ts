/**
 * Pure RSVP word-emission engine.
 *
 * Single responsibility: emit words from a fixed array at a cadence derived
 * from a WPM (words-per-minute) setting. Tokenization, ORP highlighting,
 * punctuation pacing, and UI mounting all live elsewhere.
 *
 * No DOM, no chrome.* / browser.* — safe for src/core/.
 */

import { calculatePunctuationDelay } from './punctuation-pacing';
import { buildChunks, type Chunk, type ChunkSize, type WordToken } from './chunks';
import { markSentenceBoundaries, endsSentence } from '../tokenize/sentence-boundary';

export const RSVP_STATE = {
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  DONE: 'done',
} as const;

export type RsvpState = (typeof RSVP_STATE)[keyof typeof RSVP_STATE];

/**
 * `chunk` events fire ONLY when the engine was constructed with
 * `chunkSize >= 2` (issue #51). `chunkSize === 1` (or undefined) keeps
 * the legacy `word` emission path for back-compat — existing consumers
 * read `word` events unchanged.
 *
 * `startIndex` / `endIndex` index into the engine's RAW word axis —
 * `MarkedToken.rawIndex` for the chunk's first and last words. This is
 * the same axis the engine's `nextIndex` indexes against in word mode,
 * so a `chunk.startIndex === N` event and a `word` event with
 * `index === N` refer to the same source token (cross-mode position
 * stability — load-bearing for #47 scrubber + #48 cross-mode
 * persistence). Non-word tokens (`'\n\n'`, dashes) are still skipped
 * during chunk EMISSION because they carry no sentence flags and would
 * corrupt boundary detection; their raw-axis slots are simply absent
 * from any chunk's word list. Documented for consumers under
 * `progress()`.
 */
export type RsvpEvent =
  | { type: 'word'; index: number; word: string }
  | { type: 'chunk'; startIndex: number; endIndex: number; text: string; words: string[] }
  | { type: 'done' };

export type RsvpListener = (event: RsvpEvent) => void;

export interface RsvpEngineOptions {
  words: string[];
  wpm: number;
  /**
   * Apply Safari-style 1.2× / 1.5× pacing after punctuation. Default `false`
   * to preserve cadence semantics for call sites that haven't opted in.
   * See `./punctuation-pacing.ts` for the multiplier rules.
   */
  punctuationPacing?: boolean;
  /**
   * Multi-word chunk display (#51). When `>= 2`, the engine groups words
   * into chunks of up to N (respecting sentence boundaries — a chunk
   * never spans a sentence start) and emits `chunk` events instead of
   * `word`. When undefined OR `=== 1`, the engine emits `word` events as
   * before (full back-compat).
   *
   * Chunk mode internally runs `markSentenceBoundaries(words)` and
   * filters non-word tokens (`'\n\n'`, dashes) out of the iteration —
   * those tokens carry no sentence flags and would corrupt the
   * boundary-respecting chunk builder. Word mode keeps the raw stream
   * (today's behavior).
   *
   * Punctuation pacing in chunk mode keys off the LAST word of the
   * just-emitted chunk (e.g., a chunk ending in `.` gets the
   * sentence-end multiplier). Sum-of-multipliers was rejected because
   * the pause comes AFTER the displayed text — only the tail's
   * punctuation governs perception.
   */
  chunkSize?: ChunkSize;
}

/**
 * Snapshot of where the engine is in the word stream. `index` is the count of
 * words already emitted (== `nextIndex`), so `index === 0` means "not started",
 * `index === total` means "done". `ratio = index / total`; when `total === 0`
 * the ratio is `0` by convention.
 */
export interface RsvpProgress {
  index: number;
  total: number;
  ratio: number;
}

export interface RsvpEngine {
  readonly state: RsvpState;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setWpm(wpm: number): void;
  /**
   * Toggle Safari-style punctuation pacing at runtime. Mirrors the `setWpm`
   * shape: if currently `PLAYING` with a pending tick, the pending tick is
   * rescheduled at the new cadence (so the change applies to the next gap,
   * not after one stale interval).
   */
  setPunctuationPacing(enabled: boolean): void;
  /**
   * Live update to the multi-word chunk display size (#51 architect MED #2).
   * Allows the overlay to switch chunkSize mid-session without re-mounting
   * the engine (the prior wiring only applied chunkSize on next overlay
   * mount).
   *
   * Mirrors the `setWpm` shape: validates input, normalizes to the
   * internal representation, and applies state-dependent re-emission
   * so subscribers see a consistent stream.
   *
   * Input validation:
   *   - Only `1`, `2`, or `3` are accepted; any other value (`0`, `4`,
   *     non-integer, non-numeric) is a no-op — protects against a
   *     miswired call-site corrupting engine state.
   *   - `chunkSize === 1` ↔ `undefined` normalization: both map to
   *     internal "word mode" (the engine emits `word` events, not
   *     `chunk`). Switching between `1` and `undefined` is a no-op;
   *     switching between `1` and `>=2` flips the engine between
   *     word-emission and chunk-emission paths and subscribers see
   *     the matching event type from then on.
   *   - Same effective value → no-op (no rebuild, no re-emit, no
   *     state churn). This is what the `same chunkSize value is a
   *     no-op` test in `chunk-mode.test.ts` pins.
   *
   * State-machine semantics (mirrors `setWpm` re-schedule shape):
   *   - `DONE` → pin `nextIndex` to past-end (`chunks.length` or
   *     `words.length` depending on the new mode) so a later
   *     `progress()` reads consistent. NO emission. Verified by
   *     `done state: setChunkSize pins past-end and emits no events`.
   *   - `IDLE` → reset `nextIndex` to `0` and clear `lastEmittedWord`
   *     so the next `start()` ticks chunk 0 / word 0 cleanly under
   *     the new mode. NO emission. Verified by `idle 1 → 2 enables
   *     chunk emission for the next start()`.
   *   - `PAUSED` → rebuild chunks; snap to the chunk containing the
   *     current raw position (Q1: snap-to-chunk-start); emit a
   *     replacement event for that chunk so subscribers redraw
   *     without resuming playback; `nextIndex` lands at
   *     chunk-after-emit (mirrors `seekTo` PAUSED branch). Verified
   *     by `paused 2 → 3 rebuilds chunks and emits replacement at
   *     new chunk`.
   *   - `PLAYING` → rebuild chunks; snap to chunk containing current
   *     raw position; `clearPending()` + `tick()` immediately at the
   *     new cadence (mirrors `seekTo` PLAYING semantics + `setWpm`
   *     pending-tick reschedule). Verified by `playing 2 → 1 flips
   *     engine to word emission mid-session`.
   *
   * See the `setChunkSize (live update)` describe block in
   * `chunk-mode.test.ts` for the full behavior matrix.
   */
  setChunkSize(next: 1 | 2 | 3): void;
  subscribe(listener: RsvpListener): () => void;
  /**
   * Reposition the engine to `index`. State semantics:
   *
   *   - `playing` → stays playing; emits replacement `word` event for the new
   *     index and reschedules the next tick at the current cadence.
   *   - `paused` → stays paused; emits replacement `word` event so subscribers
   *     redraw, but does NOT schedule a tick.
   *   - `idle` → silent reposition; the next `start()` will emit from the new
   *     index. (Idle = nothing displayed yet, so no replacement to emit.)
   *   - past-end (`index >= total`) → state becomes `done`, emits `done`.
   *   - negative `index` → clamped to `0`.
   *   - non-finite or non-integer `index` (NaN, Infinity, 2.7) → no-op.
   *   - `done` → no-op.
   */
  seekTo(index: number, options?: { snapToSentence?: boolean }): void;
  /**
   * Step one sentence backward (`'prev'`) or forward (`'next'`) from the
   * current position. State transitions match `seekTo` (paused/playing
   * still emit a replacement `word` event for the new position; idle is
   * silent).
   *
   * Sentence model matches `seekTo({ snapToSentence: true })`: sentences end
   * at `[.!?]`, sentence-start = the word after the boundary.
   *
   * - `'prev'`: jump to the start of the current sentence. If already at a
   *   sentence start, jump to the start of the prior sentence. At index 0
   *   the position does not change, but a replacement `word` event still
   *   fires in paused/playing (idle remains silent) — see `seekTo`.
   * - `'next'`: jump to the start of the next sentence. If no further
   *   sentence boundary exists from the current position, this is a no-op
   *   (does NOT transition to `done`) — a navigation key should not
   *   accidentally end the session on punctuation-free text. Natural
   *   playback will reach the end on its own.
   *
   * `done` → no-op (matches `seekTo`).
   */
  seekToSentence(direction: 'prev' | 'next'): void;
  /**
   * Replace the engine's word stream in place. Resets `nextIndex` to 0 and
   * transitions to `idle` regardless of prior state. Emits no events — the
   * next `start()` or `seekTo()` is responsible for the first emission on
   * the new stream. Any pending scheduled tick is cleared. Validates the
   * argument via the same boundary check used at construction.
   *
   * Use case: scope-swap in the scoped mini-modal — selection tokens swap
   * out for full-article tokens without recreating the engine instance, so
   * existing subscribers remain wired.
   */
  setWords(words: string[]): void;
  /**
   * Snapshot of word-stream progress at the current call site. Live getter —
   * each call reflects the engine's current state.
   */
  progress(): RsvpProgress;
  /**
   * Milliseconds equivalent to `index * msPerWord` at the CURRENT wpm. Live
   * getter; changes in `setWpm` are reflected on the next read.
   */
  timeElapsed(): number;
  /**
   * Milliseconds equivalent to `(total - index) * msPerWord` at the CURRENT
   * wpm. Live getter. NOTE: post-`stop()` mid-stream this returns the
   * milliseconds for the unread tail; the engine does not special-case
   * `stop` here.
   */
  timeRemaining(): number;
}

// wpm must be a positive finite number; 0, negative, NaN, Infinity all invalid.
function assertValidWpm(wpm: number): void {
  if (!Number.isFinite(wpm) || wpm <= 0) {
    throw new RangeError(`Invalid wpm: ${wpm}. Expected a positive finite number.`);
  }
}

/**
 * Convert a words-per-minute rate to the per-word display delay in milliseconds.
 *
 * Pure helper extracted so callers (and tests) can reason about cadence without
 * instantiating the engine. Mirrors the Safari reference helper of the same
 * name (see the `wpmToDelay` describe block in chriscantu/speed-reader's
 * tests/js/word-processor.test.js).
 */
export function wpmToDelay(wpm: number): number {
  assertValidWpm(wpm);
  return 60000 / wpm;
}

// words must be an array of strings. Guards against null/undefined and
// non-string elements at the engine's API boundary so callers from JS
// or corrupt-data paths get a clear TypeError rather than a downstream
// "Cannot read properties of null" surprise.
// Walk backward from `target - 1` to find the nearest preceding word ending in
// sentence-final punctuation. Sentence-start = the word immediately after that
// boundary. If no such boundary exists, snap to 0. Uses the shared
// `endsSentence` predicate (#208) so seek, the pause-state preview, and
// chunk-mode `sentenceStart` flags all agree on what a sentence is —
// honorifics (Dr./Mr./…), ellipsis, CJK terminators, trailing quotes.
function snapToSentenceStart(words: string[], target: number): number {
  for (let i = target - 1; i >= 0; i--) {
    if (endsSentence(words[i])) return i + 1;
  }
  return 0;
}

// Walk forward from `from` to find the FIRST word ending in sentence-final
// punctuation; the next-sentence start is the index immediately after it.
// Returns `-1` if no further boundary exists OR if the resulting next-start
// would be past-end — `seekToSentence('next')` treats that as no-op so a
// navigation key cannot accidentally end the session (footgun on
// punctuation-free text AND on a terminator at the last word).
function findNextSentenceStart(words: string[], from: number): number {
  for (let i = from; i < words.length; i++) {
    if (endsSentence(words[i])) {
      const next = i + 1;
      return next < words.length ? next : -1;
    }
  }
  return -1;
}

function assertValidWords(words: unknown): asserts words is string[] {
  if (!Array.isArray(words)) {
    throw new TypeError(`Invalid words: expected an array, got ${typeof words}.`);
  }
  for (let i = 0; i < words.length; i++) {
    if (typeof words[i] !== 'string') {
      throw new TypeError(`Invalid words[${i}]: expected string, got ${typeof words[i]}.`);
    }
  }
}

export function createRsvpEngine(options: RsvpEngineOptions): RsvpEngine {
  assertValidWpm(options.wpm);
  assertValidWords(options.words);

  // Chunk-mode flag — pinned at construction AND mutated by
  // `setChunkSize` for live updates. `chunkSize === 1` and `undefined`
  // are both treated as word mode — the engine should not pay the
  // chunk-building cost for a degenerate "1 word per chunk" case, and
  // word mode preserves bit-for-bit back-compat for every existing
  // consumer / test (Q4 in the design doc).
  let chunkSize: ChunkSize | undefined =
    options.chunkSize && options.chunkSize >= 2 ? options.chunkSize : undefined;

  let words = options.words.slice();
  // Filtered word-only stream + pre-computed chunks. Built lazily on
  // construction (and on `setWords` / `setChunkSize`) so the per-tick
  // path is index arithmetic only. Empty in word mode; populated in
  // chunk mode.
  let chunkWords: WordToken[] = [];
  let chunks: Chunk[] = [];
  if (chunkSize !== undefined) {
    chunkWords = markSentenceBoundaries(words).filter((t): t is WordToken => t.kind === 'word');
    chunks = buildChunks(chunkWords, chunkSize);
  }

  let wpm = options.wpm;
  let punctuationPacing = options.punctuationPacing ?? false;
  let state: RsvpState = RSVP_STATE.IDLE;
  // `nextIndex` axis:
  //   - word mode: index into raw `words` (today's behavior).
  //   - chunk mode: index into `chunks` (per-chunk advance per tick).
  // Documented on `progress()` so consumers know the axis change.
  let nextIndex = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  // Issue #118 — the wall-clock time the current word's gap began and the
  // full gap it was scheduled for. Together they let `setWpm` reschedule the
  // REMAINING slice of the in-flight gap (preserving the fraction already
  // displayed) instead of restarting a full beat at the new cadence — the
  // old behavior cost up to a full msPerWord of jitter, dominant at low WPM.
  // Both are (re)set on every emit via `scheduleNext`; the baseline is NOT
  // updated by `rescheduleRemaining`, so repeated `setWpm` calls measure
  // elapsed against the word's true display start, not the last reschedule.
  let wordStartedAt: number | null = null;
  let wordFullDelay = 0;
  let seekInFlight = false;
  // Word just emitted to subscribers — drives Safari-style pacing for the
  // gap BEFORE the next word. In chunk mode this is the chunk's LAST
  // word (the trailing token governs pause perception). `null` when no
  // word has been emitted yet (engine idle pre-start, post-reposition
  // before first tick).
  let lastEmittedWord: string | null = null;
  const listeners = new Set<RsvpListener>();

  const emit = (event: RsvpEvent): void => {
    // Snapshot to tolerate unsubscribe during dispatch.
    for (const listener of [...listeners]) {
      listener(event);
    }
  };

  const msPerWord = (): number => wpmToDelay(wpm);

  const clearPending = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  // Per-gap delay = base cadence (`msPerWord`) optionally scaled by the
  // multiplier for the just-emitted word. When pacing is off OR no word
  // has been emitted yet, falls through to the base cadence — preserves
  // the legacy timing path bit-for-bit.
  const nextDelay = (): number => {
    const base = msPerWord();
    if (!punctuationPacing) return base;
    return calculatePunctuationDelay(lastEmittedWord, base);
  };

  const armTimer = (delay: number): void => {
    timerId = setTimeout(() => {
      timerId = null;
      if (state !== RSVP_STATE.PLAYING) return;
      tick();
    }, delay);
  };

  const scheduleNext = (): void => {
    const delay = nextDelay();
    // Record the gap baseline at emit time so a mid-gap `setWpm` can
    // preserve the elapsed fraction (issue #118).
    wordStartedAt = Date.now();
    wordFullDelay = delay;
    armTimer(delay);
  };

  // Issue #118 — reschedule the in-flight gap at the CURRENT cadence,
  // preserving the fraction of the current word already displayed. Replaces
  // the prior `clearPending()` + full `scheduleNext()`, which discarded the
  // elapsed time and restarted a whole beat. `wordStartedAt` / `wordFullDelay`
  // are left at the word's original emit baseline so repeated reschedules
  // accumulate correctly rather than resetting the clock each call.
  //
  // Clock assumption: elapsed is measured against `Date.now()` (wall clock),
  // while the gap is armed via `setTimeout` (the runtime's macrotask clock).
  // These are coherent in the foreground. In a backgrounded/suspended tab —
  // where `setTimeout` is throttled but the wall clock keeps advancing — the
  // fraction can read high and is clamped to `[0,1]`, so the worst case is a
  // word firing on the next (already-throttled) tick. That is strictly no
  // worse than the old full-beat-restart and is invisible to a reader who
  // isn't looking at a background tab; the engine lives in `src/core` and
  // cannot read `document.visibilityState` to gate on foreground. Accepted.
  const rescheduleRemaining = (): void => {
    if (timerId === null || wordStartedAt === null) {
      scheduleNext();
      return;
    }
    const elapsed = Date.now() - wordStartedAt;
    const fraction = wordFullDelay > 0 ? Math.min(1, Math.max(0, elapsed / wordFullDelay)) : 0;
    const remaining = Math.max(0, nextDelay() * (1 - fraction));
    clearPending();
    armTimer(remaining);
  };

  // Total ticks remaining: in word mode, `words.length`; in chunk mode,
  // `chunks.length`. Centralised so done-check / progress are consistent.
  const totalTicks = (): number => (chunkSize !== undefined ? chunks.length : words.length);

  const tick = (): void => {
    if (nextIndex >= totalTicks()) {
      state = RSVP_STATE.DONE;
      emit({ type: 'done' });
      return;
    }
    if (chunkSize !== undefined) {
      const idx = nextIndex++;
      const chunk = chunks[idx];
      // Pacing uses the chunk's LAST word so trailing punctuation
      // (sentence-end / clause-break) governs the next gap. Q2 in
      // the design doc.
      lastEmittedWord = chunk.words[chunk.words.length - 1].text;
      emit({
        type: 'chunk',
        startIndex: chunk.startIndex,
        endIndex: chunk.endIndex,
        text: chunk.text,
        words: chunk.words.map((w) => w.text),
      });
    } else {
      const index = nextIndex++;
      const word = words[index];
      lastEmittedWord = word;
      emit({ type: 'word', index, word });
    }
    scheduleNext();
  };

  // Snap a RAW word-axis index to the chunk index that contains it.
  // Chunks are contiguous and non-overlapping on the raw axis by
  // construction (`buildChunks` emits chunks sequentially over a
  // filtered-but-rawIndex-tagged stream), so a binary search would
  // work but linear is fine for the chunk count produced by typical
  // articles (~3-5k words → ~1-2k chunks at chunkSize=2). Returns
  // `chunks.length` for any target past the final chunk's endIndex —
  // caller maps that to the `done` branch. A raw index that falls in
  // a structural-token gap between two chunks (paragraph / dash slot
  // between sentences) snaps FORWARD to the next chunk — matches the
  // intuition that the user-visible "next thing" is the chunk after
  // the gap.
  const wordIndexToChunkIndex = (rawIdx: number): number => {
    if (chunks.length === 0) return 0;
    if (rawIdx <= chunks[0].startIndex) return 0;
    for (let c = 0; c < chunks.length; c++) {
      if (rawIdx <= chunks[c].endIndex) return c;
    }
    return chunks.length;
  };

  // Snap a RAW word-axis index to the nearest preceding sentence-start
  // chunk-word. Used by `seekToChunk` when `snapToSentence` is requested.
  // Walks `chunkWords` (which carry rawIndex tags + sentenceStart flags)
  // backward from the largest chunk-word whose rawIndex ≤ target.
  const snapRawIndexToSentenceStart = (rawTarget: number): number => {
    // Find the largest chunk-word index `i` with rawIndex ≤ rawTarget.
    let cwIdx = -1;
    for (let i = 0; i < chunkWords.length; i++) {
      if (chunkWords[i].rawIndex <= rawTarget) cwIdx = i;
      else break;
    }
    if (cwIdx < 0) return 0;
    for (let i = cwIdx; i >= 0; i--) {
      if (chunkWords[i].sentenceStart) return chunkWords[i].rawIndex;
    }
    return chunkWords.length > 0 ? chunkWords[0].rawIndex : 0;
  };

  // Chunk-mode seekTo. The external API takes a RAW word-axis index
  // (same axis as word-mode's `seekTo`), so callers don't need to know
  // about the internal chunk axis (Q1 in the design doc — always snap
  // to chunk start; mid-chunk seeks resolve to the chunk containing
  // the requested raw word).
  const seekToChunk = (index: number, snapToSentence: boolean): void => {
    let rawTarget = index < 0 ? 0 : index;
    const totalRawWords = words.length;
    if (snapToSentence && rawTarget < totalRawWords) {
      rawTarget = snapRawIndexToSentenceStart(rawTarget);
    }

    if (rawTarget >= totalRawWords) {
      nextIndex = chunks.length;
      state = RSVP_STATE.DONE;
      clearPending();
      seekInFlight = true;
      try {
        emit({ type: 'done' });
      } finally {
        seekInFlight = false;
      }
      return;
    }

    const targetChunkIdx = wordIndexToChunkIndex(rawTarget);
    if (targetChunkIdx >= chunks.length) {
      nextIndex = chunks.length;
      state = RSVP_STATE.DONE;
      clearPending();
      seekInFlight = true;
      try {
        emit({ type: 'done' });
      } finally {
        seekInFlight = false;
      }
      return;
    }

    nextIndex = targetChunkIdx;
    seekInFlight = true;
    try {
      if (state === RSVP_STATE.PLAYING) {
        clearPending();
        tick();
      } else if (state === RSVP_STATE.PAUSED) {
        const chunk = chunks[targetChunkIdx];
        emit({
          type: 'chunk',
          startIndex: chunk.startIndex,
          endIndex: chunk.endIndex,
          text: chunk.text,
          words: chunk.words.map((w) => w.text),
        });
        lastEmittedWord = chunk.words[chunk.words.length - 1].text;
        nextIndex = targetChunkIdx + 1;
      }
      // idle: silent reposition.
    } finally {
      seekInFlight = false;
    }
  };

  const engine: RsvpEngine = {
    get state() {
      return state;
    },
    start(): void {
      if (state !== RSVP_STATE.IDLE) return;
      // Chunk-mode empty check uses the chunk axis (0 chunks = nothing
      // to emit even if `words.length > 0` somehow contained only
      // non-word tokens). Word mode keeps the legacy raw-array check.
      if (totalTicks() === 0) {
        state = RSVP_STATE.DONE;
        emit({ type: 'done' });
        return;
      }
      state = RSVP_STATE.PLAYING;
      tick();
    },
    pause(): void {
      if (state !== RSVP_STATE.PLAYING) return;
      state = RSVP_STATE.PAUSED;
      clearPending();
    },
    resume(): void {
      if (state !== RSVP_STATE.PAUSED) return;
      state = RSVP_STATE.PLAYING;
      // Schedule the next word at the current cadence; tick handles done.
      if (nextIndex >= totalTicks()) {
        tick();
      } else {
        scheduleNext();
      }
    },
    stop(): void {
      if (state === RSVP_STATE.DONE) return;
      state = RSVP_STATE.DONE;
      clearPending();
    },
    setWpm(next: number): void {
      assertValidWpm(next);
      wpm = next;
      // Reschedule any pending tick at the new cadence so the next emission
      // reflects the change, preserving the fraction of the current word
      // already displayed (issue #118) rather than restarting a full beat.
      if (state === RSVP_STATE.PLAYING && timerId !== null) {
        rescheduleRemaining();
      }
    },
    setPunctuationPacing(enabled: boolean): void {
      if (punctuationPacing === enabled) return;
      punctuationPacing = enabled;
      // Mirror `setWpm`: a pending tick is reset so the new pacing rule
      // applies to the very next gap rather than after one stale interval.
      if (state === RSVP_STATE.PLAYING && timerId !== null) {
        clearPending();
        scheduleNext();
      }
    },
    setChunkSize(next: 1 | 2 | 3): void {
      // Input validation — non-integer / out-of-range = no-op so a
      // miswired callsite cannot corrupt the engine.
      if (next !== 1 && next !== 2 && next !== 3) return;
      // Normalize the incoming setting to the same "chunk mode |
      // undefined" representation used at construction so the
      // comparison below treats `chunkSize=1 ↔ undefined` as a no-op
      // (both mean word mode).
      const nextChunkSize: ChunkSize | undefined = next >= 2 ? next : undefined;
      if (nextChunkSize === chunkSize) return;

      // Capture the current raw-axis position BEFORE rebuild so we
      // can map back into the new chunk layout (snap-to-chunk-start
      // semantics, consistent with Q1).
      const currentRawPos = (() => {
        if (chunkSize === undefined) return nextIndex;
        // Chunk mode: nextIndex is chunk-axis. Translate to raw via
        // the just-emitted chunk's endIndex (+1 for the "next raw
        // token to read" position). Pre-start (nextIndex === 0) → 0.
        if (nextIndex === 0) return 0;
        if (nextIndex >= chunks.length) return words.length;
        return chunks[nextIndex - 1].endIndex + 1;
      })();

      // Apply the new mode + rebuild structures.
      chunkSize = nextChunkSize;
      if (chunkSize !== undefined) {
        chunkWords = markSentenceBoundaries(words).filter((t): t is WordToken => t.kind === 'word');
        chunks = buildChunks(chunkWords, chunkSize);
      } else {
        chunkWords = [];
        chunks = [];
      }

      // Cancel any pending tick — cadence + structures both changed.
      clearPending();

      if (state === RSVP_STATE.DONE) {
        // Pin nextIndex to the appropriate end-of-stream position so a
        // later `progress()` reads consistent. Do not emit.
        nextIndex = chunkSize !== undefined ? chunks.length : words.length;
        return;
      }

      // Map current raw position back into the new layout.
      if (chunkSize !== undefined) {
        if (chunks.length === 0) {
          nextIndex = 0;
        } else if (currentRawPos >= words.length) {
          nextIndex = chunks.length;
        } else {
          nextIndex = wordIndexToChunkIndex(currentRawPos);
        }
      } else {
        nextIndex = Math.min(currentRawPos, words.length);
      }

      // State-dependent re-emit. Mirror `seekToChunk` / `seekTo` shape.
      // IDLE → silent; PAUSED → emit replacement so overlay redraws;
      // PLAYING → clearPending+tick at new cadence.
      if (state === RSVP_STATE.IDLE) {
        // Idle: reset nextIndex to 0 per the JSDoc contract.
        nextIndex = 0;
        lastEmittedWord = null;
        return;
      }
      if (state === RSVP_STATE.PAUSED) {
        // Emit a replacement event for the chunk / word at nextIndex
        // so subscribers redraw without resuming playback. Mirrors
        // the paused-state branch in `seekTo` / `seekToChunk`.
        seekInFlight = true;
        try {
          if (chunkSize !== undefined) {
            if (nextIndex >= chunks.length) {
              // Past-end after rebuild — transition to done.
              state = RSVP_STATE.DONE;
              emit({ type: 'done' });
              return;
            }
            const chunk = chunks[nextIndex];
            emit({
              type: 'chunk',
              startIndex: chunk.startIndex,
              endIndex: chunk.endIndex,
              text: chunk.text,
              words: chunk.words.map((w) => w.text),
            });
            lastEmittedWord = chunk.words[chunk.words.length - 1].text;
            nextIndex = nextIndex + 1;
          } else {
            if (nextIndex >= words.length) {
              state = RSVP_STATE.DONE;
              emit({ type: 'done' });
              return;
            }
            const w = words[nextIndex];
            emit({ type: 'word', index: nextIndex, word: w });
            lastEmittedWord = w;
            nextIndex = nextIndex + 1;
          }
        } finally {
          seekInFlight = false;
        }
        return;
      }
      // PLAYING: re-tick immediately at the new cadence + structures.
      tick();
    },
    setWords(next: string[]): void {
      assertValidWords(next);
      clearPending();
      words = next.slice();
      // Rebuild chunks on word-stream swap so the next start/seek
      // operates against the new chunks. No-op in word mode.
      if (chunkSize !== undefined) {
        chunkWords = markSentenceBoundaries(words).filter((t): t is WordToken => t.kind === 'word');
        chunks = buildChunks(chunkWords, chunkSize);
      }
      nextIndex = 0;
      lastEmittedWord = null;
      state = RSVP_STATE.IDLE;
    },
    subscribe(listener: RsvpListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    seekTo(index: number, options?: { snapToSentence?: boolean }): void {
      if (state === RSVP_STATE.DONE) return;
      // Finite-integer guard: NaN, Infinity, fractional inputs would corrupt
      // nextIndex and emit `words[NaN] === undefined` downstream.
      if (!Number.isInteger(index)) return;
      // Re-entrancy guard: prevent recursive seekTo invocations from inside a
      // subscriber's word-event handler. Inner call would clearPending() + tick()
      // and the outer would then schedule a stale setTimeout.
      if (seekInFlight) return;

      // Word-mode path: legacy implementation, unchanged. Chunk-mode
      // forks below into its own implementation so the legacy code
      // path stays bit-for-bit identical for back-compat.
      if (chunkSize !== undefined) {
        seekToChunk(index, options?.snapToSentence === true);
        return;
      }

      const total = words.length;
      let target = index < 0 ? 0 : index;
      if (options?.snapToSentence === true && target < total) {
        target = snapToSentenceStart(words, target);
      }

      if (target >= total) {
        nextIndex = total;
        state = RSVP_STATE.DONE;
        clearPending();
        seekInFlight = true;
        try {
          emit({ type: 'done' });
        } finally {
          seekInFlight = false;
        }
        return;
      }

      // Word currently on screen while playing (the last-emitted word).
      // Captured before `nextIndex` is overwritten so the #118 preserve
      // check below can compare the seek target against it.
      const displayedIndex = nextIndex - 1;
      nextIndex = target;
      seekInFlight = true;
      try {
        if (state === RSVP_STATE.PLAYING) {
          if (target === displayedIndex && timerId !== null) {
            // Issue #118 — seeking onto the word already displayed: leave the
            // in-flight beat running (no re-emit, no reschedule) instead of
            // restarting a full beat. Restore `nextIndex` to the post-emit
            // invariant (next word to emit = target + 1).
            nextIndex = target + 1;
          } else {
            clearPending();
            tick();
          }
        } else if (state === RSVP_STATE.PAUSED) {
          emit({ type: 'word', index: target, word: words[target] });
          // Keep `lastEmittedWord` in sync with the just-emitted word so that
          // a subsequent `resume()` schedules its first tick against the
          // correct punctuation multiplier — without this, the gap after a
          // paused-seek onto a sentence-final word silently used the stale
          // pre-seek word's punctuation.
          lastEmittedWord = words[target];
          nextIndex = target + 1;
        }
        // idle: silent reposition; first start() will tick from new nextIndex.
      } finally {
        seekInFlight = false;
      }
    },
    seekToSentence(direction: 'prev' | 'next'): void {
      if (state === RSVP_STATE.DONE) return;
      if (seekInFlight) return;

      if (chunkSize !== undefined) {
        // Chunk mode: walk the filtered-word stream (`chunkWords`) using
        // the marker flags (no regex re-detection), then translate the
        // resolved chunk-word index back to the RAW word axis via
        // `rawIndex` for the `engine.seekTo` call. Mirror word-mode
        // semantics exactly — walk from `cwCur` looking for
        // sentenceStart. `cwCur` is the chunk-word index immediately
        // AFTER the chunk just emitted, so the walk skips past the
        // current sentence (the one containing what the user just
        // saw). Delegate to `engine.seekTo` so the chunk-aware path
        // handles `done` transitions + the re-entrancy flag uniformly.
        //
        // - Pre-start (nextIndex === 0): cwCur = 0; prev → chunkWords[0]'s
        //   sentenceStart, next → first sentenceStart strictly after 0.
        // - Post-emit (nextIndex >= 1): cwCur = chunk-word index of
        //   the slot right after the last-emitted chunk's last word.
        // - Past-end (nextIndex >= chunks.length): cwCur = chunkWords.length.
        //
        // Translating the chunk-axis position back to the chunk-word
        // axis uses the chunk's last word's local index. `buildChunks`
        // emits chunks over a contiguous slice of `chunkWords`, so
        // `chunks[k]`'s last word in `chunkWords` is at
        // `(sum of chunks[0..k-1].words.length) + chunks[k].words.length - 1`.
        // Pre-compute a per-chunk cumulative end index.
        let cwCur: number;
        if (nextIndex === 0) {
          cwCur = 0;
        } else if (nextIndex >= chunks.length) {
          cwCur = chunkWords.length;
        } else {
          let consumed = 0;
          for (let c = 0; c < nextIndex; c++) consumed += chunks[c].words.length;
          // `consumed` is now the chunk-word index of the first
          // chunk-word in the NEXT (unemitted) chunk — exactly the
          // "position immediately after the chunk just emitted" the
          // walk wants.
          cwCur = consumed;
        }
        let targetCw: number;
        if (direction === 'prev') {
          // Find the sentenceStart at or before `cwCur - 1` (back-up
          // one sentence when already at a sentence start), else the
          // sentenceStart at or before `cwCur`.
          const startAt = (from: number): number => {
            for (let i = from; i >= 0; i--) {
              if (chunkWords[i]?.sentenceStart) return i;
            }
            return 0;
          };
          const here = startAt(cwCur);
          if (here === cwCur && cwCur > 0) {
            targetCw = startAt(cwCur - 1);
          } else {
            targetCw = here;
          }
        } else {
          // Find the first sentenceStart strictly AFTER the chunk-word
          // boundary `cwCur`. When pre-start (cwCur === 0), walk from
          // 1 to skip the synthetic "first word starts a sentence"
          // flag. If no further sentence-start exists, no-op
          // (matches word-mode semantics — nav key cannot navigate
          // past the last sentence).
          const startWalkFrom = cwCur === 0 ? 1 : cwCur;
          let next = -1;
          for (let i = startWalkFrom; i < chunkWords.length; i++) {
            if (chunkWords[i].sentenceStart) {
              next = i;
              break;
            }
          }
          if (next === -1) return;
          targetCw = next;
        }
        // Translate chunk-word index → raw index before delegating.
        const rawTarget =
          chunkWords.length === 0
            ? 0
            : targetCw >= chunkWords.length
              ? words.length
              : chunkWords[targetCw].rawIndex;
        engine.seekTo(rawTarget);
        return;
      }

      const cur = nextIndex;
      let target: number;
      if (direction === 'prev') {
        const sentenceStart = snapToSentenceStart(words, cur);
        if (sentenceStart === cur && cur > 0) {
          // Already at a sentence start — back up one more sentence.
          target = snapToSentenceStart(words, cur - 1);
        } else {
          target = sentenceStart;
        }
      } else {
        target = findNextSentenceStart(words, cur);
        if (target === -1) return; // no further boundary → no-op (see JSDoc)
      }
      // Re-entrancy invariant: this method does NOT set `seekInFlight`; the
      // delegate `engine.seekTo` does. If a future change adds side effects
      // here outside that delegate, set the flag locally to preserve the
      // guard semantics.
      engine.seekTo(target);
    },
    progress(): RsvpProgress {
      if (chunkSize !== undefined) {
        // Chunk mode: report progress on the RAW token-axis so
        // consumers (#47 scrubber, #48 position store) see a stable
        // axis IDENTICAL to word mode. A position at raw index N
        // means the same thing in either mode, so mode-switch is
        // monotonic and scrubber consumers can map position
        // bidirectionally. `index` = raw-axis position of the next
        // unread token (== `endIndex + 1` of last-emitted chunk, or
        // 0 pre-start, or `words.length` at done); `total` = raw
        // token count.
        const total = words.length;
        if (total === 0) return { index: 0, total: 0, ratio: 0 };
        const index =
          nextIndex === 0
            ? 0
            : nextIndex >= chunks.length
              ? total
              : chunks[nextIndex - 1].endIndex + 1;
        return { index, total, ratio: index / total };
      }
      const total = words.length;
      if (total === 0) {
        return { index: 0, total: 0, ratio: 0 };
      }
      return { index: nextIndex, total, ratio: nextIndex / total };
    },
    timeElapsed(): number {
      if (chunkSize !== undefined) {
        if (chunks.length === 0) return 0;
        // One tick = msPerWord per chunk (chunk is the cadence unit).
        return nextIndex * msPerWord();
      }
      if (words.length === 0) return 0;
      return nextIndex * msPerWord();
    },
    timeRemaining(): number {
      if (chunkSize !== undefined) {
        if (chunks.length === 0) return 0;
        const remaining = chunks.length - nextIndex;
        if (remaining <= 0) return 0;
        return remaining * msPerWord();
      }
      if (words.length === 0) return 0;
      const remaining = words.length - nextIndex;
      if (remaining <= 0) return 0;
      return remaining * msPerWord();
    },
  };
  return engine;
}
