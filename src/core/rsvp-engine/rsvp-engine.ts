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
 * `index === total` means "done". `ratio` is `index / total` clamped to
 * `[0, 1]`; when `total === 0` the ratio is `0` by convention.
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
   * `stop` here (see SELF_WEAKNESSES.md, weakness 2).
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

  const words = options.words.slice();
  let wpm = options.wpm;
  let state: RsvpState = RSVP_STATE.IDLE;
  let nextIndex = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
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

  return {
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
    subscribe(listener: RsvpListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    progress(): RsvpProgress {
      const total = words.length;
      if (total === 0) {
        return { index: 0, total: 0, ratio: 0 };
      }
      const raw = nextIndex / total;
      // Clamp defensively even though nextIndex is engine-controlled.
      const ratio = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      return { index: nextIndex, total, ratio };
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
}
