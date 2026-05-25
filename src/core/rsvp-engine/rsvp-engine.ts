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

export interface SeekOptions {
  /**
   * If `true`, snap the target index BACKWARD to the nearest sentence-start
   * word (the word immediately following the closest preceding word that ends
   * with `.`, `!`, or `?`). If no such boundary exists, snap to `0`.
   */
  snapToSentence?: boolean;
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
   */
  seekTo(index: number, options?: SeekOptions): void;
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
    seekTo(index: number, options?: SeekOptions): void {
      if (state === RSVP_STATE.DONE) return;

      const total = words.length;
      let target = index < 0 ? 0 : index;
      if (options?.snapToSentence === true && target < total) {
        target = snapToSentenceStart(words, target);
      }

      if (target >= total) {
        nextIndex = total;
        state = RSVP_STATE.DONE;
        clearPending();
        emit({ type: 'done' });
        return;
      }

      nextIndex = target;

      if (state === RSVP_STATE.PLAYING) {
        // Rescheduled emission at current cadence; tick emits word + advances.
        clearPending();
        tick();
      } else if (state === RSVP_STATE.PAUSED) {
        // Emit replacement so subscriber redraws; align nextIndex with the
        // engine's post-emit invariant ("next word to emit").
        emit({ type: 'word', index: target, word: words[target] });
        nextIndex = target + 1;
      }
      // idle: silent reposition; first start() will tick from new nextIndex.
    },
  };
}
