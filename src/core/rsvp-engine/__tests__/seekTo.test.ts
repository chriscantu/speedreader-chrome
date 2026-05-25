import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRsvpEngine, type RsvpEvent } from '../rsvp-engine';

// Spirit-port of Safari `state-machine.test.js` `seekTo` describe block.
// `seekTo with chunks` cases are deferred to issue #51 (per #95 DoD).

describe('seekTo()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('repositions while playing and stays playing', () => {
    const words = ['a', 'b', 'c', 'd', 'e', 'f'];
    const engine = createRsvpEngine({ words, wpm: 300 }); // 200ms/word
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    // 'a' emitted on start; nextIndex = 1.

    engine.seekTo(3);

    expect(engine.state).toBe('playing');
    // Replacement word emitted at the new index.
    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'word', index: 3, word: 'd' });

    // Next tick at current cadence emits index 4.
    vi.advanceTimersByTime(200);
    const after = events[events.length - 1];
    expect(after).toEqual({ type: 'word', index: 4, word: 'e' });
  });

  it('repositions while paused and stays paused (replacement word emitted, no auto-advance)', () => {
    const words = ['a', 'b', 'c', 'd', 'e'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    engine.pause();
    expect(engine.state).toBe('paused');

    const before = events.length;
    engine.seekTo(2);

    expect(engine.state).toBe('paused');
    expect(events[before]).toEqual({ type: 'word', index: 2, word: 'c' });

    // No auto-advance from paused.
    vi.advanceTimersByTime(1000);
    expect(events.length).toBe(before + 1);
  });

  it('repositions while idle silently — no event until start()', () => {
    const words = ['a', 'b', 'c', 'd'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));

    engine.seekTo(2);

    expect(engine.state).toBe('idle');
    expect(events).toEqual([]);

    engine.start();
    expect(events[0]).toEqual({ type: 'word', index: 2, word: 'c' });
  });

  it('past-end index → done state + done event, no word event', () => {
    const words = ['a', 'b', 'c'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start(); // emits 'a'

    engine.seekTo(99);

    expect(engine.state).toBe('done');
    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'done' });
  });

  it('negative index clamps to 0', () => {
    const words = ['a', 'b', 'c'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    vi.advanceTimersByTime(200); // 'b'

    engine.seekTo(-5);

    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'word', index: 0, word: 'a' });
  });

  it('seek while done is a no-op', () => {
    const words = ['a', 'b'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    vi.advanceTimersByTime(200 * 3); // drain
    expect(engine.state).toBe('done');
    const before = events.length;

    engine.seekTo(0);

    expect(engine.state).toBe('done');
    expect(events.length).toBe(before);
  });
});

describe('seekTo() with snapToSentence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('snaps backward to nearest sentence-start (word after preceding "." / "!" / "?")', () => {
    // Words: "Hello", "world.", "This", "is", "fine!", "Next", "sentence", "here."
    // Indices: 0       1         2       3     4        5       6           7
    const words = ['Hello', 'world.', 'This', 'is', 'fine!', 'Next', 'sentence', 'here.'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    // Seek to index 3 ("is") with snap → nearest preceding boundary is "world." (1) → snap to 2 ("This").
    engine.seekTo(3, { snapToSentence: true });

    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'word', index: 2, word: 'This' });
  });

  it('snaps to 0 when no preceding sentence boundary exists', () => {
    const words = ['no', 'punctuation', 'here', 'at', 'all'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();

    engine.seekTo(3, { snapToSentence: true });

    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'word', index: 0, word: 'no' });
  });

  it('snaps with "?" and "!" terminators too', () => {
    const words = ['Why?', 'Because', 'I', 'say!', 'Listen', 'now'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();

    // Seek to index 5 ("now") → nearest preceding boundary is "say!" (3) → snap to 4 ("Listen").
    engine.seekTo(5, { snapToSentence: true });
    const last1 = events[events.length - 1];
    expect(last1).toEqual({ type: 'word', index: 4, word: 'Listen' });

    // Seek to index 2 ("I") → nearest preceding boundary is "Why?" (0) → snap to 1 ("Because").
    engine.seekTo(2, { snapToSentence: true });
    const last2 = events[events.length - 1];
    expect(last2).toEqual({ type: 'word', index: 1, word: 'Because' });
  });

  it('snapToSentence at target 0 stays at 0', () => {
    const words = ['First.', 'Second.', 'Third.'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();

    engine.seekTo(0, { snapToSentence: true });

    const last = events[events.length - 1];
    expect(last).toEqual({ type: 'word', index: 0, word: 'First.' });
  });

  it('snapToSentence past-end still → done (snap is bypassed for out-of-range targets)', () => {
    const words = ['First.', 'Second.'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();

    engine.seekTo(99, { snapToSentence: true });

    expect(engine.state).toBe('done');
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });
});
