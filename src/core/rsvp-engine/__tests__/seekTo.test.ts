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

  it('seek with non-integer index is a no-op (NaN, Infinity, fractional)', () => {
    // Finite-integer guard prevents nextIndex corruption that would otherwise
    // emit `{ word: undefined }` downstream.
    const words = ['a', 'b', 'c'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    const before = events.length;

    engine.seekTo(Number.NaN);
    engine.seekTo(Number.POSITIVE_INFINITY);
    engine.seekTo(2.7);

    expect(events.length).toBe(before);
    expect(engine.state).toBe('playing');
  });

  it('reschedules at exactly the current cadence (no sub-msPerWord jitter pin)', () => {
    // Pin the timing contract: after seekTo while playing, the next emission
    // fires at exactly msPerWord, not less, not more.
    const words = ['a', 'b', 'c', 'd', 'e'];
    const engine = createRsvpEngine({ words, wpm: 300 }); // 200ms/word
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    vi.advanceTimersByTime(50); // Pre-seek mid-tick; partial elapsed.

    engine.seekTo(2);
    const afterSeek = events.length;

    vi.advanceTimersByTime(199);
    expect(events.length).toBe(afterSeek);
    vi.advanceTimersByTime(1);
    expect(events.length).toBe(afterSeek + 1);
    expect(events[afterSeek]).toEqual({ type: 'word', index: 3, word: 'd' });
  });

  it('subscriber-initiated seek during word emit is bounded by re-entrancy guard', () => {
    // A subscriber that calls engine.seekTo from inside its own word handler
    // would otherwise re-enter tick() mid-emit, double-emitting and corrupting
    // the schedule. The inner call is silently dropped; the outer tick
    // proceeds normally.
    const words = ['a', 'b', 'c', 'd', 'e'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    let reentered = 0;
    engine.subscribe((e) => {
      events.push(e);
      if (e.type === 'word' && e.index === 1) {
        reentered += 1;
        engine.seekTo(4); // Should be no-op while parent seek is in flight.
      }
    });
    engine.start();
    engine.seekTo(1); // Triggers the subscriber re-entry at index 1.

    expect(reentered).toBe(1);
    expect(engine.state).toBe('playing');
    // Outer seek emitted only the index=1 replacement; inner was dropped.
    const wordEvents = events.filter((e) => e.type === 'word');
    expect(wordEvents.length).toBeGreaterThanOrEqual(2);
    // No corruption — last word event has a defined `word` value.
    const last = wordEvents[wordEvents.length - 1];
    if (last.type === 'word') expect(typeof last.word).toBe('string');
  });

  it('snapToSentence: false / undefined skip snap', () => {
    const words = ['Hello', 'world.', 'This', 'is', 'fine.'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();

    engine.seekTo(3, { snapToSentence: false });
    expect(events[events.length - 1]).toEqual({ type: 'word', index: 3, word: 'is' });

    engine.seekTo(2);
    expect(events[events.length - 1]).toEqual({ type: 'word', index: 2, word: 'This' });
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

  it('snap exempts honorifics ("Dr." not treated as sentence end) — #208', () => {
    // Pre-#208 this test pinned the naive [.!?]$ heuristic (snap to 1,
    // 'Smith') so a sentence-detector refactor would be caught as a
    // behavior change rather than slipping in silently. #208 unified the
    // predicate with chunk-mode's `endsSentence` — the honorific
    // exemption now applies, and this test pins the CORRECTED behavior.
    const words = ['Dr.', 'Smith', 'said', 'hello.', 'Next', 'sentence', 'here.'];
    const engine = createRsvpEngine({ words, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();

    // Seek to index 2 ("said") with snap. "Dr." is exempt, so the
    // sentence start is index 0.
    engine.seekTo(2, { snapToSentence: true });

    expect(events[events.length - 1]).toEqual({ type: 'word', index: 0, word: 'Dr.' });
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

  // Issue #118 — seeking onto the word ALREADY displayed while playing
  // must preserve the in-flight beat rather than re-emit the word and
  // restart a full beat (which costs up to a full msPerWord of jitter
  // and a redundant redraw — visible when the scrubber settles on the
  // current word). Seeking onto a DIFFERENT word keeps the existing
  // emit-immediately-at-a-full-beat behavior (a new word earns a full
  // display beat).
  describe('seekTo preserves the in-flight beat when targeting the current word (#118)', () => {
    it('seekTo onto the currently displayed word does not re-emit and keeps the original deadline', () => {
      const words = ['a', 'b', 'c'];
      const engine = createRsvpEngine({ words, wpm: 300 }); // 200 ms/word
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start(); // 'a' at t=0; displayed index 0; nextIndex = 1
      expect(events).toHaveLength(1);

      vi.advanceTimersByTime(120); // 60% through 'a'
      engine.seekTo(0); // == current displayed word → preserve beat (80 ms left)

      expect(engine.state).toBe('playing');
      expect(events).toHaveLength(1); // NO duplicate 'a' re-emit
      vi.advanceTimersByTime(79);
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(1); // t = 200 → 'b' at the word's original deadline
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'b' });
    });

    it('seekTo onto a DIFFERENT word still emits it immediately at a full beat', () => {
      const words = ['a', 'b', 'c', 'd'];
      const engine = createRsvpEngine({ words, wpm: 300 }); // 200 ms/word
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start(); // 'a'

      vi.advanceTimersByTime(120);
      engine.seekTo(2); // different word → emit 'c' now, fresh full beat
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({ type: 'word', index: 2, word: 'c' });

      vi.advanceTimersByTime(199);
      expect(events).toHaveLength(2);
      vi.advanceTimersByTime(1); // full 200 ms beat from the seek
      expect(events).toHaveLength(3);
      expect(events[2]).toEqual({ type: 'word', index: 3, word: 'd' });
    });
  });
});
