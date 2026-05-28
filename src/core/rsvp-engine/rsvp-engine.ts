/**
 * Pure RSVP word-emission engine.
 *
 * Single responsibility: emit words from a fixed array at a cadence derived
 * from a WPM (words-per-minute) setting. Tokenization, ORP highlighting,
 * punctuation pacing, and UI mounting all live elsewhere.
 *
 * No DOM, no chrome.* / browser.* — safe for src/core/.
 */

export const RSVP_STATE = {
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  DONE: 'done',
} as const;

export type RsvpState = (typeof RSVP_STATE)[keyof typeof RSVP_STATE];

export type RsvpEvent = { type: 'word'; index: number; word: string } | { type: 'done' };

export type RsvpListener = (event: RsvpEvent) => void;

export interface RsvpEngineOptions {
  words: string[];
  wpm: number;
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
   * current position. State transitions match `seekTo`.
   *
   * Sentence model matches `seekTo({ snapToSentence: true })`: sentences end
   * at `[.!?]`, sentence-start = the word after the boundary.
   *
   * - `'prev'`: jump to the start of the current sentence. If already at a
   *   sentence start, jump to the start of the prior sentence. At index 0
   *   this is a no-op.
   * - `'next'`: jump to the start of the next sentence. If no further
   *   sentence start exists, transition to `done`.
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
// boundary. If no such boundary exists, snap to 0. Naive — does not handle
// abbreviations like "Dr." or "U.S.A."; documented in PR self-weakness #1.
const SENTENCE_END = /[.!?]$/;
function snapToSentenceStart(words: string[], target: number): number {
  for (let i = target - 1; i >= 0; i--) {
    if (SENTENCE_END.test(words[i])) return i + 1;
  }
  return 0;
}

// Walk forward from `from` to find the FIRST word ending in sentence-final
// punctuation; the next-sentence start is the index immediately after it.
// Returns `words.length` if no further boundary exists — `seekTo` treats
// that as past-end and transitions to `done`.
function findNextSentenceStart(words: string[], from: number): number {
  for (let i = from; i < words.length; i++) {
    if (SENTENCE_END.test(words[i])) return i + 1;
  }
  return words.length;
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

  let words = options.words.slice();
  let wpm = options.wpm;
  let state: RsvpState = RSVP_STATE.IDLE;
  let nextIndex = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let seekInFlight = false;
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

  const scheduleNext = (): void => {
    timerId = setTimeout(() => {
      timerId = null;
      if (state !== RSVP_STATE.PLAYING) return;
      tick();
    }, msPerWord());
  };

  const tick = (): void => {
    if (nextIndex >= words.length) {
      state = RSVP_STATE.DONE;
      emit({ type: 'done' });
      return;
    }
    const index = nextIndex++;
    emit({ type: 'word', index, word: words[index] });
    scheduleNext();
  };

  const engine: RsvpEngine = {
    get state() {
      return state;
    },
    start(): void {
      if (state !== RSVP_STATE.IDLE) return;
      if (words.length === 0) {
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
      if (nextIndex >= words.length) {
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
      // reflects the change. The currently displayed word's remaining time
      // is reset — acceptable for a control-surface live update.
      if (state === RSVP_STATE.PLAYING && timerId !== null) {
        clearPending();
        scheduleNext();
      }
    },
    setWords(next: string[]): void {
      assertValidWords(next);
      clearPending();
      words = next.slice();
      nextIndex = 0;
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

      nextIndex = target;
      seekInFlight = true;
      try {
        if (state === RSVP_STATE.PLAYING) {
          clearPending();
          tick();
        } else if (state === RSVP_STATE.PAUSED) {
          emit({ type: 'word', index: target, word: words[target] });
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
      }
      engine.seekTo(target);
    },
    progress(): RsvpProgress {
      const total = words.length;
      if (total === 0) {
        return { index: 0, total: 0, ratio: 0 };
      }
      return { index: nextIndex, total, ratio: nextIndex / total };
    },
    timeElapsed(): number {
      if (words.length === 0) return 0;
      return nextIndex * msPerWord();
    },
    timeRemaining(): number {
      if (words.length === 0) return 0;
      const remaining = words.length - nextIndex;
      if (remaining <= 0) return 0;
      return remaining * msPerWord();
    },
  };
  return engine;
}
