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
  //     persistence layer via `SettingsSchemaV2`. This separates
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
