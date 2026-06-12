import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRsvpEngine } from '../rsvp-engine';
import type { RsvpEvent } from '../rsvp-engine';

describe('createRsvpEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts in idle with empty words', () => {
      const engine = createRsvpEngine({ words: [], wpm: 300 });
      expect(engine.state).toBe('idle');
    });

    it('starts in idle with non-empty words', () => {
      const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 300 });
      expect(engine.state).toBe('idle');
    });
  });

  describe('empty words array', () => {
    it('emits done immediately on start and reaches done state', () => {
      const engine = createRsvpEngine({ words: [], wpm: 300 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events).toEqual([{ type: 'done' }]);
      expect(engine.state).toBe('done');
    });
  });

  describe('single word', () => {
    it('emits one word event then done', () => {
      const engine = createRsvpEngine({ words: ['foo'], wpm: 300 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // First word emits immediately on start.
      expect(events).toEqual([{ type: 'word', index: 0, word: 'foo' }]);
      // Advance one word's worth of time → done.
      vi.advanceTimersByTime(60000 / 300);
      expect(events).toEqual([{ type: 'word', index: 0, word: 'foo' }, { type: 'done' }]);
      expect(engine.state).toBe('done');
    });
  });

  describe('multi-word stream at fixed WPM', () => {
    it('emits n word events plus one done event in order', () => {
      const words = ['the', 'quick', 'brown', 'fox'];
      const wpm = 300;
      const msPerWord = 60000 / wpm; // 200ms
      const engine = createRsvpEngine({ words, wpm });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();

      // First word emits synchronously on start.
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'word', index: 0, word: 'the' });

      // Advance one tick at a time.
      vi.advanceTimersByTime(msPerWord);
      vi.advanceTimersByTime(msPerWord);
      vi.advanceTimersByTime(msPerWord);
      // After 3 more ticks, all 4 words emitted.
      expect(events).toHaveLength(4);
      expect(events.map((e) => (e.type === 'word' ? e.word : '_'))).toEqual([
        'the',
        'quick',
        'brown',
        'fox',
      ]);

      // One more tick fires done.
      vi.advanceTimersByTime(msPerWord);
      expect(events).toHaveLength(5);
      expect(events[4]).toEqual({ type: 'done' });
      expect(engine.state).toBe('done');
    });
  });

  describe('pause / resume', () => {
    it('pause stops further events until resume', () => {
      const words = ['a', 'b', 'c', 'd'];
      const engine = createRsvpEngine({ words, wpm: 300 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // 'a' emitted synchronously.
      expect(events).toHaveLength(1);

      engine.pause();
      expect(engine.state).toBe('paused');
      vi.advanceTimersByTime(10000);
      expect(events).toHaveLength(1);

      engine.resume();
      expect(engine.state).toBe('playing');
      vi.advanceTimersByTime(200); // one word at 300 wpm
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'b' });
    });
  });

  describe('setWpm mid-stream', () => {
    it('next scheduled tick uses the new cadence', () => {
      const words = ['a', 'b', 'c'];
      const engine = createRsvpEngine({ words, wpm: 300 }); // 200ms/word
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start(); // 'a' immediate
      expect(events).toHaveLength(1);

      // Halve the cadence: 600 wpm → 100ms/word.
      engine.setWpm(600);

      // After 100ms, 'b' should have emitted.
      vi.advanceTimersByTime(99);
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'b' });
    });

    it('throws RangeError on invalid wpm', () => {
      const engine = createRsvpEngine({ words: ['a'], wpm: 300 });
      expect(() => engine.setWpm(0)).toThrow(RangeError);
      expect(() => engine.setWpm(-1)).toThrow(RangeError);
      expect(() => engine.setWpm(NaN)).toThrow(RangeError);
      expect(() => engine.setWpm(Infinity)).toThrow(RangeError);
    });
  });

  // Issue #118 — a mid-tick setWpm must preserve the FRACTION of the
  // current word already displayed, not discard it and restart a full
  // beat at the new cadence. The old behavior (clearPending + full
  // scheduleNext) cost up to a full msPerWord of jitter — at low WPM
  // (the accessibility floor) that is the dominant perceived latency.
  describe('setWpm mid-tick preserves elapsed fraction (#118)', () => {
    it('AC#3: 100 wpm, 300 ms elapsed, setWpm(600) → next emission at ~50 ms not 100 ms', () => {
      const engine = createRsvpEngine({ words: ['a', 'b', 'c'], wpm: 100 }); // 600 ms/word
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start(); // 'a' at t=0, 600 ms beat
      expect(events).toHaveLength(1);

      vi.advanceTimersByTime(300); // 50% through 'a'
      engine.setWpm(600); // 100 ms/word → remaining = 100 * (1 - 0.5) = 50 ms

      vi.advanceTimersByTime(49);
      expect(events).toHaveLength(1); // not yet
      vi.advanceTimersByTime(1); // 50 ms after setWpm
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'b' });
    });

    it('setWpm near the end of a slow beat fires almost immediately, not a fresh full beat', () => {
      const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 100 }); // 600 ms/word
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();

      vi.advanceTimersByTime(599); // 599/600 through 'a'
      engine.setWpm(600); // remaining ≈ 100 * (1/600) ≈ 0.17 ms
      vi.advanceTimersByTime(1); // next macrotask
      expect(events).toHaveLength(2); // 'b' fired ~immediately; old code waited a full 100 ms
    });

    it('setWpm to the SAME wpm still preserves the in-flight beat (no reset)', () => {
      const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 300 }); // 200 ms/word
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();

      vi.advanceTimersByTime(150); // 75% through 'a'
      engine.setWpm(300); // same cadence → remaining = 200 * 0.25 = 50 ms
      vi.advanceTimersByTime(49);
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1); // t = 200 total → 'b'
      expect(events).toHaveLength(2);
    });

    it('repeated setWpm measures elapsed from the original emit, not the last reschedule', () => {
      const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 300 }); // 200 ms/word
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start(); // 'a' at t=0

      vi.advanceTimersByTime(100); // 50% through 'a'
      engine.setWpm(600); // 100 ms → remaining 50 ms (would fire t=150)
      vi.advanceTimersByTime(20); // t=120 → fraction now 120/200 = 0.6
      engine.setWpm(300); // 200 ms → remaining 200 * 0.4 = 80 ms (fires t=200)
      vi.advanceTimersByTime(79);
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1); // t=200 → 'b' at the word's true original deadline
      expect(events).toHaveLength(2);
    });

    it('setWpm after resume measures elapsed from the RESUME baseline, not the original emit', () => {
      const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 300 }); // 200 ms/word
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start(); // 'a' at t=0
      vi.advanceTimersByTime(100); // 50% through 'a'
      engine.pause(); // beat cancelled mid-tick
      engine.resume(); // fresh full beat: baseline resets to resume time
      vi.advanceTimersByTime(100); // 50% through the RESUMED 200 ms beat
      engine.setWpm(600); // 100 ms → remaining = 100 * (1 - 0.5) = 50 ms
      // If the baseline had NOT reset on resume, elapsed would read 200 ms
      // against the original t=0 emit → fraction clamps to 1 → 'b' immediately.
      vi.advanceTimersByTime(49);
      expect(events).toHaveLength(1); // discriminates: stale baseline would already be 2
      vi.advanceTimersByTime(1);
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'b' });
    });

    it('setWpm mid-tick with punctuation pacing preserves the fraction on the multiplied gap', () => {
      // 'Hi.' is sentence-final → 1.5× gap. The multiplier must survive the
      // reschedule on BOTH the fraction denominator and the remaining slice.
      const engine = createRsvpEngine({
        words: ['Hi.', 'there'],
        wpm: 100, // 600 ms base → 'Hi.' gap = 600 * 1.5 = 900 ms
        punctuationPacing: true,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start(); // 'Hi.' at t=0
      expect(events).toHaveLength(1);

      vi.advanceTimersByTime(450); // 50% through the 900 ms paced gap
      engine.setWpm(600); // base 100 ms → new paced gap 150 ms → remaining 150 * 0.5 = 75 ms

      vi.advanceTimersByTime(74);
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1); // 75 ms after setWpm
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'there' });
    });
  });

  describe('stop', () => {
    it('moves to done and prevents further events', () => {
      const engine = createRsvpEngine({ words: ['a', 'b', 'c'], wpm: 300 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events).toHaveLength(1);

      engine.stop();
      expect(engine.state).toBe('done');
      vi.advanceTimersByTime(10000);
      expect(events).toHaveLength(1);
    });

    it('start after stop is a no-op', () => {
      const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 300 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.stop();
      const before = events.length;
      engine.start();
      vi.advanceTimersByTime(10000);
      expect(events).toHaveLength(before);
      expect(engine.state).toBe('done');
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe fn that stops delivery', () => {
      const engine = createRsvpEngine({ words: ['a', 'b', 'c'], wpm: 300 });
      const events: RsvpEvent[] = [];
      const unsubscribe = engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events).toHaveLength(1);
      unsubscribe();
      vi.advanceTimersByTime(10000);
      expect(events).toHaveLength(1);
    });

    it('supports multiple subscribers', () => {
      const engine = createRsvpEngine({ words: ['a'], wpm: 300 });
      const a: RsvpEvent[] = [];
      const b: RsvpEvent[] = [];
      engine.subscribe((e) => a.push(e));
      engine.subscribe((e) => b.push(e));
      engine.start();
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });
  });

  describe('invalid wpm at construction', () => {
    it('throws RangeError', () => {
      expect(() => createRsvpEngine({ words: [], wpm: 0 })).toThrow(RangeError);
      expect(() => createRsvpEngine({ words: [], wpm: -1 })).toThrow(RangeError);
      expect(() => createRsvpEngine({ words: [], wpm: NaN })).toThrow(RangeError);
      expect(() => createRsvpEngine({ words: [], wpm: Infinity })).toThrow(RangeError);
    });
  });

  // Spirit-port of Safari `state-machine.test.js` `init` block (WPM clamping)
  // and `togglePlayPause` block. Chrome's engine deliberately diverges:
  //
  //   - Safari clamps wpm into [100, 600] inside the state machine
  //     (`init('Hello world.', { wpm: 50 })` → `sm.wpm === 100`). Chrome
  //     keeps the engine permissive — any positive finite number is
  //     accepted — and enforces the [100, 600] product range at the
  //     persistence layer via `SettingsSchemaV3`. This separates
  //     control-surface validation from engine cadence math.
  //
  //   - Safari ships a `togglePlayPause()` helper on the state machine.
  //     Chrome's engine intentionally omits it; callers compose
  //     `pause()` / `resume()` against the public `state` getter.
  describe('Safari parity / divergence', () => {
    it('engine accepts wpm below Safari clamp floor (100); clamping is a settings concern', () => {
      // Equivalent Safari case: `init('Hello world.', { wpm: 50 })` clamps to 100.
      // Chrome accepts 50 and emits words at 60000/50 = 1200ms cadence.
      const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 50 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // 'a' emits synchronously.
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1199);
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(events).toHaveLength(2);
    });

    it('engine accepts wpm above Safari clamp ceiling (600); clamping is a settings concern', () => {
      // Equivalent Safari case: `init('Hello world.', { wpm: 999 })` clamps to 600.
      // Chrome accepts 999 and emits at 60000/999 ≈ 60.06ms.
      const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 999 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(61);
      expect(events).toHaveLength(2);
    });

    it('punctuationPacing=true scales the gap after a sentence-final word by 1.5×', () => {
      // Safari-parity case: after a word ending in `.`, the engine must wait
      // msPerWord * 1.5 before emitting the next word. Validates the wiring
      // between `calculatePunctuationDelay` and `scheduleNext`.
      const words = ['Hello.', 'world'];
      const wpm = 300;
      const msPerWord = 60000 / wpm; // 200
      const engine = createRsvpEngine({ words, wpm, punctuationPacing: true });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // 'Hello.' emits synchronously on start.
      expect(events).toHaveLength(1);

      // At 1.5× cadence (200ms × 1.5 = 300ms), 'world' must NOT emit at 299ms
      // and MUST emit at exactly 300ms.
      vi.advanceTimersByTime(msPerWord); // 200ms — still inside the 300ms gap
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(msPerWord * 0.5 - 1); // 99ms more = 299ms
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1); // 300ms total
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'world' });
    });

    it('punctuationPacing=false (default) keeps uniform cadence even on punctuated words', () => {
      // Regression guard: existing call sites that don't opt in MUST see
      // unchanged timing. A word ending in `.` should not extend the gap.
      const words = ['Hello.', 'world'];
      const wpm = 300;
      const msPerWord = 60000 / wpm;
      const engine = createRsvpEngine({ words, wpm });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events).toHaveLength(1);

      // At plain cadence, 'world' must emit at exactly msPerWord (200ms).
      vi.advanceTimersByTime(msPerWord - 1);
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'world' });
    });

    it('setPunctuationPacing toggles pacing at runtime', () => {
      // Mirrors the setWpm-mid-stream test: changing the flag while playing
      // should reschedule the pending tick at the new cadence.
      const words = ['Hello.', 'world'];
      const wpm = 300;
      const msPerWord = 60000 / wpm;
      const engine = createRsvpEngine({ words, wpm }); // pacing off
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events).toHaveLength(1);

      // Flip pacing on AFTER 'Hello.' has been emitted but before its gap fires.
      engine.setPunctuationPacing(true);

      // Gap now 1.5× = 300ms. 'world' should not appear at 200ms.
      vi.advanceTimersByTime(msPerWord);
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(msPerWord * 0.5);
      expect(events).toHaveLength(2);
    });

    it("paused seekTo onto a sentence-final word — resume uses the seeked word's multiplier", () => {
      // Regression guard for the paused-seek lastEmittedWord defect found in
      // PR #163 review: the PAUSED branch of seekTo emits the new word but,
      // before the fix, did NOT update lastEmittedWord. resume() then
      // scheduled its first tick against the stale pre-seek word, so a
      // paused-seek onto "Hello." resumed at 1.0× instead of 1.5×.
      const words = ['cat', 'dog', 'Hello.', 'world'];
      const wpm = 300;
      const msPerWord = 60000 / wpm; // 200
      const engine = createRsvpEngine({ words, wpm, punctuationPacing: true });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start(); // emits 'cat'
      engine.pause();
      engine.seekTo(2); // jumps to 'Hello.', emits it (paused-branch)
      // events so far: ['cat', 'Hello.']
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 2, word: 'Hello.' });

      engine.resume();
      // Gap before 'world' MUST be 1.5× msPerWord = 300ms, not the stale 'cat' 1.0×.
      vi.advanceTimersByTime(msPerWord); // 200ms
      expect(events).toHaveLength(2);
      vi.advanceTimersByTime(msPerWord * 0.5 - 1); // 299ms
      expect(events).toHaveLength(2);
      vi.advanceTimersByTime(1); // 300ms
      expect(events).toHaveLength(3);
      expect(events[2]).toEqual({ type: 'word', index: 3, word: 'world' });
    });

    it('setWords clears stale punctuation state — first tick on new stream uses default multiplier', () => {
      // Regression guard from PR #163 review: setWords resets lastEmittedWord
      // to null. Otherwise a stream swap whose prior last-emit was "Hello."
      // would silently apply 1.5× to the first gap of the new stream.
      const wpm = 300;
      const msPerWord = 60000 / wpm; // 200
      const engine = createRsvpEngine({ words: ['Hello.'], wpm, punctuationPacing: true });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start(); // emits 'Hello.', lastEmittedWord = 'Hello.'

      engine.setWords(['plain', 'next']); // resets lastEmittedWord to null
      events.length = 0;
      engine.start(); // emits 'plain'
      expect(events).toHaveLength(1);

      // Gap before 'next' must be 1.0× (200ms), not 1.5× (300ms).
      vi.advanceTimersByTime(msPerWord - 1);
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'next' });
    });

    it('pause/resume cycles compose into a togglePlayPause equivalent', () => {
      // Equivalent Safari cases: `togglePlayPause` (plays when paused, pauses
      // when playing). Chrome composes `pause()` / `resume()` against the
      // exposed state.
      const engine = createRsvpEngine({ words: ['a', 'b', 'c'], wpm: 300 });
      engine.start();
      expect(engine.state).toBe('playing');

      // First toggle: playing → paused
      if (engine.state === 'playing') engine.pause();
      expect(engine.state).toBe('paused');

      // Second toggle: paused → playing
      if (engine.state === 'paused') engine.resume();
      expect(engine.state).toBe('playing');

      // Third toggle round-trip
      if (engine.state === 'playing') engine.pause();
      expect(engine.state).toBe('paused');
    });
  });
});
