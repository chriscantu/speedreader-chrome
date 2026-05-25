import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRsvpEngine } from '../rsvp-engine';

// Spirit-port of Safari `state-machine.test.js` `progress` and
// `timeElapsed and timeRemaining` describe blocks, adapted to the Chrome
// engine's API. Two deliberate divergences from Safari:
//
//   - `progress().ratio` (0..1 float) instead of `progress().percent` (0..100).
//   - `timeElapsed()` / `timeRemaining()` return MILLISECONDS, not seconds.
//
// This issue's spec wins over literal Safari porting (ratio + ms shape).

describe('progress()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ratio 0 at start, with current index 0 and total = words.length', () => {
    const engine = createRsvpEngine({ words: ['one', 'two', 'three', 'four'], wpm: 300 });
    const p = engine.progress();
    expect(p.index).toBe(0);
    expect(p.total).toBe(4);
    expect(p.ratio).toBe(0);
  });

  it('advances index and ratio as words are emitted', () => {
    const words = ['one', 'two', 'three', 'four'];
    const engine = createRsvpEngine({ words, wpm: 300 }); // 200ms/word
    engine.start();
    // After start, 'one' has emitted synchronously → nextIndex = 1.
    expect(engine.progress()).toEqual({ index: 1, total: 4, ratio: 0.25 });

    vi.advanceTimersByTime(200);
    expect(engine.progress()).toEqual({ index: 2, total: 4, ratio: 0.5 });

    vi.advanceTimersByTime(200);
    expect(engine.progress()).toEqual({ index: 3, total: 4, ratio: 0.75 });
  });

  it('reaches ratio 1 at end (after all words emit and done fires)', () => {
    const words = ['a', 'b', 'c', 'd'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    engine.start();
    // Drain all words + done event.
    vi.advanceTimersByTime(200 * 4);
    expect(engine.state).toBe('done');
    const p = engine.progress();
    expect(p.index).toBe(4);
    expect(p.total).toBe(4);
    expect(p.ratio).toBe(1);
  });

  it('returns ratio 0 and total 0 for empty words', () => {
    const engine = createRsvpEngine({ words: [], wpm: 300 });
    const p = engine.progress();
    expect(p.index).toBe(0);
    expect(p.total).toBe(0);
    expect(p.ratio).toBe(0);
  });

  it('returns ratio 0 and total 0 for empty words even after start (engine goes straight to done)', () => {
    const engine = createRsvpEngine({ words: [], wpm: 300 });
    engine.start();
    expect(engine.state).toBe('done');
    const p = engine.progress();
    expect(p.index).toBe(0);
    expect(p.total).toBe(0);
    expect(p.ratio).toBe(0);
  });

  it('pins ratio as 0..1 (NOT Safari percent 0..100) — divergence assertion', () => {
    // After 1 of 4 emissions: ratio should be 0.25, NOT 25. Tight bound (<1)
    // distinguishes the 0..1 contract from a hypothetical 0..100 regression
    // that would return 25 and pass any loose 0..N upper bound.
    const engine = createRsvpEngine({ words: ['a', 'b', 'c', 'd'], wpm: 300 });
    engine.start();
    vi.advanceTimersByTime(200);
    const ratio = engine.progress().ratio;
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeCloseTo(0.5);
  });

  it('preserves mid-stream index after stop() (no special-case zeroing)', () => {
    // POLICY (not invariant): post-stop() mid-stream, timeRemaining returns
    // the math for the unread tail rather than clamping to 0. The engine
    // does NOT special-case stop here; the JSDoc on timeRemaining names this
    // explicitly. A future spec change to zero on DONE-via-stop is a policy
    // flip, not a regression — this test will fail intentionally and the
    // change should be deliberate, not silent.
    const engine = createRsvpEngine({ words: ['a', 'b', 'c', 'd', 'e', 'f'], wpm: 300 });
    engine.start();
    vi.advanceTimersByTime(200);
    engine.stop();
    expect(engine.state).toBe('done');
    const p = engine.progress();
    expect(p.index).toBe(2);
    expect(p.total).toBe(6);
    expect(p.ratio).toBeCloseTo(2 / 6);
    // Tail math continues — engine does NOT clamp timeRemaining to 0 on stop.
    expect(engine.timeElapsed()).toBe(400);
    expect(engine.timeRemaining()).toBe(800);
  });
});

describe('timeElapsed() and timeRemaining()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 elapsed and full remaining at start', () => {
    // 4 words at 300 wpm → 200ms/word → 800ms total.
    const engine = createRsvpEngine({ words: ['a', 'b', 'c', 'd'], wpm: 300 });
    expect(engine.timeElapsed()).toBe(0);
    expect(engine.timeRemaining()).toBe(800);
  });

  it('returns elapsed = index * msPerWord and remaining = (total - index) * msPerWord at midpoint', () => {
    // 6 words at 300 wpm → 200ms/word; mid-stream after 3 emits.
    const engine = createRsvpEngine({ words: ['a', 'b', 'c', 'd', 'e', 'f'], wpm: 300 });
    engine.start();
    // 'a' on start, then advance for 'b' and 'c' → nextIndex = 3.
    vi.advanceTimersByTime(200); // 'b'
    vi.advanceTimersByTime(200); // 'c'
    expect(engine.progress().index).toBe(3);
    expect(engine.timeElapsed()).toBe(600); // 3 * 200
    expect(engine.timeRemaining()).toBe(600); // 3 * 200
  });

  it('returns full elapsed and 0 remaining at end', () => {
    const engine = createRsvpEngine({ words: ['a', 'b', 'c', 'd'], wpm: 300 });
    engine.start();
    vi.advanceTimersByTime(200 * 4); // drain
    expect(engine.state).toBe('done');
    expect(engine.timeRemaining()).toBe(0);
    expect(engine.timeElapsed()).toBe(800); // 4 * 200
  });

  it('returns 0 for both when words array is empty', () => {
    const engine = createRsvpEngine({ words: [], wpm: 300 });
    expect(engine.timeElapsed()).toBe(0);
    expect(engine.timeRemaining()).toBe(0);
  });

  it('updates live when wpm changes via setWpm', () => {
    // 10 words at 300 wpm → 200ms/word → 2000ms total.
    const engine = createRsvpEngine({
      words: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      wpm: 300,
    });
    expect(engine.timeRemaining()).toBe(2000);

    // Double the cadence: 600 wpm → 100ms/word → 1000ms total.
    engine.setWpm(600);
    expect(engine.timeRemaining()).toBe(1000);
    expect(engine.timeElapsed()).toBe(0);
  });

  it('setWpm while paused is reflected on next time-getter read (live getter across PAUSED)', () => {
    const engine = createRsvpEngine({ words: ['a', 'b', 'c', 'd'], wpm: 300 });
    engine.start();
    vi.advanceTimersByTime(200);
    engine.pause();
    expect(engine.state).toBe('paused');
    expect(engine.timeRemaining()).toBe(400);

    engine.setWpm(60);
    expect(engine.state).toBe('paused');
    expect(engine.timeRemaining()).toBe(2000);
    expect(engine.timeElapsed()).toBe(2000);
  });

  it('resume after paused setWpm emits at the new cadence (scheduler reads live wpm)', () => {
    // Guards against a regression where paused setWpm updates the getter math
    // but the scheduler retains a stale msPerWord on resume.
    const engine = createRsvpEngine({ words: ['a', 'b', 'c', 'd', 'e'], wpm: 300 });
    const indices: number[] = [];
    engine.subscribe((e) => {
      if (e.type === 'word') indices.push(e.index);
    });
    engine.start(); // emits index 0
    vi.advanceTimersByTime(200); // emits index 1 → nextIndex=2
    engine.pause();
    engine.setWpm(60); // 1000ms/word
    engine.resume();

    // Old cadence (200ms) should NOT emit anything.
    vi.advanceTimersByTime(999);
    expect(indices[indices.length - 1]).toBe(1);
    // New cadence (1000ms) emits index 2 on the next ms.
    vi.advanceTimersByTime(1);
    expect(indices[indices.length - 1]).toBe(2);
  });

  it('elapsed at various wpms reflects the current cadence (live getter semantics)', () => {
    // 4 words; start at 300 wpm (200ms/word), advance 2 emissions, change to 60 wpm (1000ms/word).
    const engine = createRsvpEngine({ words: ['a', 'b', 'c', 'd'], wpm: 300 });
    engine.start();
    vi.advanceTimersByTime(200); // 'b' → index 2
    expect(engine.progress().index).toBe(2);
    expect(engine.timeElapsed()).toBe(400); // 2 * 200ms

    engine.setWpm(60); // 1000ms/word
    // Live re-read at new cadence.
    expect(engine.timeElapsed()).toBe(2000); // 2 * 1000ms
    expect(engine.timeRemaining()).toBe(2000); // 2 * 1000ms
  });
});
