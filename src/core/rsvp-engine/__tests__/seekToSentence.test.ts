import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRsvpEngine, type RsvpEvent } from '../rsvp-engine';

/**
 * `seekToSentence` is the engine surface backing the in-overlay
 * ← / → keyboard shortcuts (#33). Sentence boundary model matches
 * `seekTo({ snapToSentence: true })`: sentence ends at `[.!?]`,
 * sentence-start = the word immediately after that punctuation.
 *
 * Word stream used in most cases:
 *   0    1    2    3    4    5    6    7
 *  ['Hi.', 'How', 'are', 'you?', 'I', 'am', 'fine.', 'Bye!']
 *
 * Sentence starts: 0, 1, 4, 7  (and 8 == past-end == done)
 */

const STREAM = ['Hi.', 'How', 'are', 'you?', 'I', 'am', 'fine.', 'Bye!'];

describe('seekToSentence("prev")', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('mid-sentence: snaps to current sentence start', () => {
    const engine = createRsvpEngine({ words: STREAM, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    engine.pause();
    // After start + pause: emitted 'Hi.' (index 0), nextIndex now 1.
    engine.seekTo(2); // mid "How are you?" sentence; emits 'are' (paused)
    events.length = 0;

    engine.seekToSentence('prev');

    // Current sentence "How are you?" starts at index 1.
    expect(events).toEqual([{ type: 'word', index: 1, word: 'How' }]);
  });

  it('at sentence start (playing): jumps to start of previous sentence', () => {
    const engine = createRsvpEngine({ words: STREAM, wpm: 300 }); // 200ms/word
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start(); // emit 'Hi.', nextIndex=1
    vi.advanceTimersByTime(200); // 'How' (1)
    vi.advanceTimersByTime(200); // 'are' (2)
    vi.advanceTimersByTime(200); // 'you?' (3) — nextIndex now 4 (sentence start of "I am fine.")
    events.length = 0;

    engine.seekToSentence('prev');

    // cur=4 IS a sentence start; back up one sentence → start of "How are you?" at 1.
    expect(events[0]).toEqual({ type: 'word', index: 1, word: 'How' });
  });

  it('at index 0: no-op', () => {
    const engine = createRsvpEngine({ words: STREAM, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    engine.pause();
    // After start+pause: nextIndex === 1 (one word emitted).
    engine.seekTo(0); // re-seeks to 0 in paused state; emits 'Hi.'
    events.length = 0;

    engine.seekToSentence('prev');

    // Going prev from sentence start at 0 is a no-op — emits 'Hi.' again
    // because seekTo(0) under paused state emits the replacement word.
    expect(events).toEqual([{ type: 'word', index: 0, word: 'Hi.' }]);
  });

  it('preserves playing state and reschedules tick', () => {
    const engine = createRsvpEngine({ words: STREAM, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start(); // emits 'Hi.', schedules next tick
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(200);
    // emitted 'Hi.', 'How', 'are', 'you?'; nextIndex now 4
    events.length = 0;

    engine.seekToSentence('prev');

    expect(engine.state).toBe('playing');
    // Snap to current sentence start (index 1 — "How are you?" since
    // nextIndex 4 sits at the next sentence start, prev backs up to 1).
    const first = events[0];
    expect(first).toEqual({ type: 'word', index: 1, word: 'How' });
  });
});

describe('seekToSentence("next")', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('jumps to the start of the next sentence', () => {
    const engine = createRsvpEngine({ words: STREAM, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    engine.pause();
    engine.seekTo(2); // mid "How are you?"
    events.length = 0;

    engine.seekToSentence('next');

    // Next sentence "I am fine." starts at index 4.
    expect(events).toEqual([{ type: 'word', index: 4, word: 'I' }]);
  });

  it('from a sentence start: advances to the following sentence', () => {
    const engine = createRsvpEngine({ words: STREAM, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    engine.pause();
    engine.seekTo(1); // start of "How are you?"
    events.length = 0;

    engine.seekToSentence('next');

    // Next sentence "I am fine." starts at index 4.
    expect(events).toEqual([{ type: 'word', index: 4, word: 'I' }]);
  });

  it('no further sentence: no-op (does NOT transition to done)', () => {
    const engine = createRsvpEngine({ words: STREAM, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    engine.pause();
    engine.seekTo(7); // start of last sentence "Bye!"; nextIndex=8 after paused-seek
    events.length = 0;

    engine.seekToSentence('next');

    // Navigation key should not accidentally end the session — no-op.
    expect(engine.state).toBe('paused');
    expect(events).toEqual([]);
  });

  it('preserves playing state and reschedules tick', () => {
    const engine = createRsvpEngine({ words: STREAM, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start(); // emit 'Hi.', nextIndex=1
    events.length = 0;

    engine.seekToSentence('next');

    expect(engine.state).toBe('playing');
    // cur=1, walk forward: words[3]='you?' boundary → next sentence start = 4 ('I').
    expect(events[0]).toEqual({ type: 'word', index: 4, word: 'I' });
  });
});

describe('seekToSentence edge cases', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('no-op when state is done', () => {
    const engine = createRsvpEngine({ words: ['a.', 'b.'], wpm: 600 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(200);
    expect(engine.state).toBe('done');
    events.length = 0;

    engine.seekToSentence('prev');
    engine.seekToSentence('next');

    expect(events).toEqual([]);
    expect(engine.state).toBe('done');
  });

  it('idle: silent reposition, next start() emits from new index', () => {
    const engine = createRsvpEngine({ words: STREAM, wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));

    // Idle — no emission expected.
    engine.seekToSentence('next');
    expect(events).toEqual([]);

    engine.start();
    // Next sentence after index 0 is at 1; first emission should be 'How'.
    expect(events[0]).toEqual({ type: 'word', index: 1, word: 'How' });
  });

  it('text with no sentence boundaries — next is a no-op', () => {
    const engine = createRsvpEngine({ words: ['no', 'periods', 'here'], wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    engine.pause();
    events.length = 0;

    engine.seekToSentence('next');

    // Navigation key should not accidentally end the session.
    expect(engine.state).toBe('paused');
    expect(events).toEqual([]);
  });

  it('text with no sentence boundaries — prev snaps to 0', () => {
    const engine = createRsvpEngine({ words: ['no', 'periods', 'here'], wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    engine.pause();
    engine.seekTo(2);
    events.length = 0;

    engine.seekToSentence('prev');

    expect(events).toEqual([{ type: 'word', index: 0, word: 'no' }]);
  });
});
