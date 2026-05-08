/**
 * Pure RSVP word-emission engine.
 *
 * Single responsibility: emit words from a fixed array at a cadence derived
 * from a WPM (words-per-minute) setting. Tokenization, ORP highlighting,
 * punctuation pacing, and UI mounting all live elsewhere.
 *
 * No DOM, no chrome.* / browser.* — safe for src/core/.
 */

export type RsvpState = 'idle' | 'playing' | 'paused' | 'done';

export type RsvpEvent = { type: 'word'; index: number; word: string } | { type: 'done' };

export type RsvpListener = (event: RsvpEvent) => void;

export interface RsvpEngineOptions {
  words: string[];
  wpm: number;
}

export interface RsvpEngine {
  readonly state: RsvpState;
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setWpm(wpm: number): void;
  subscribe(listener: RsvpListener): () => void;
}

// wpm must be a positive finite number; 0, negative, NaN, Infinity all invalid.
function assertValidWpm(wpm: number): void {
  if (!Number.isFinite(wpm) || wpm <= 0) {
    throw new RangeError(`Invalid wpm: ${wpm}. Expected a positive finite number.`);
  }
}

export function createRsvpEngine(options: RsvpEngineOptions): RsvpEngine {
  assertValidWpm(options.wpm);

  const words = options.words.slice();
  let wpm = options.wpm;
  let state: RsvpState = 'idle';
  let nextIndex = 0;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<RsvpListener>();

  const emit = (event: RsvpEvent): void => {
    // Snapshot to tolerate unsubscribe during dispatch.
    for (const listener of [...listeners]) {
      listener(event);
    }
  };

  const msPerWord = (): number => 60000 / wpm;

  const clearPending = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const scheduleNext = (): void => {
    timerId = setTimeout(() => {
      timerId = null;
      if (state !== 'playing') return;
      tick();
    }, msPerWord());
  };

  const tick = (): void => {
    if (nextIndex >= words.length) {
      state = 'done';
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
      if (state !== 'idle') return;
      if (words.length === 0) {
        state = 'done';
        emit({ type: 'done' });
        return;
      }
      state = 'playing';
      tick();
    },
    pause(): void {
      if (state !== 'playing') return;
      state = 'paused';
      clearPending();
    },
    resume(): void {
      if (state !== 'paused') return;
      state = 'playing';
      // Schedule the next word at the current cadence; tick handles done.
      if (nextIndex >= words.length) {
        tick();
      } else {
        scheduleNext();
      }
    },
    stop(): void {
      if (state === 'done') return;
      state = 'done';
      clearPending();
    },
    setWpm(next: number): void {
      assertValidWpm(next);
      wpm = next;
      // Reschedule any pending tick at the new cadence so the next emission
      // reflects the change. The currently displayed word's remaining time
      // is reset — acceptable for a control-surface live update.
      if (state === 'playing' && timerId !== null) {
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
  };
}
