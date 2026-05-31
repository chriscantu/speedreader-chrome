/**
 * Engine integration tests for chunkSize >= 2 (issue #51).
 *
 * Covers:
 *   - chunk event emission shape + ordering
 *   - sentence-boundary respect across ticks
 *   - punctuation pacing (chunk LAST-word multiplier — Q2 decision)
 *   - seekTo snap-to-chunk-start (Q1 decision)
 *   - seekToSentence navigation in chunk mode
 *   - progress() reports filtered-word axis
 *   - back-compat: chunkSize=1 still emits `word` events (Q4 decision)
 *
 * Self-pushback mutation hypotheses pinned per assertion in PR body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRsvpEngine, type RsvpEvent } from '../rsvp-engine';

describe('createRsvpEngine — chunk mode (chunkSize >= 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('chunk event emission', () => {
    it('emits one chunk per tick, advancing through the stream', () => {
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();

      // First chunk emits synchronously on start.
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'chunk',
        startIndex: 0,
        endIndex: 1,
        text: 'The quick',
        words: ['The', 'quick'],
      });

      // Advance one chunk's worth of time.
      vi.advanceTimersByTime(60000 / 300);
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        type: 'chunk',
        startIndex: 2,
        endIndex: 3,
        text: 'brown fox.',
        words: ['brown', 'fox.'],
      });

      // One more tick fires done.
      vi.advanceTimersByTime(60000 / 300);
      expect(events).toHaveLength(3);
      expect(events[2]).toEqual({ type: 'done' });
    });

    it('respects sentence boundaries — chunk ends early before next sentence', () => {
      const engine = createRsvpEngine({
        words: ['Hello', 'world.', 'Goodbye', 'world.'],
        wpm: 300,
        chunkSize: 3,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      vi.advanceTimersByTime(60000 / 300);

      // Two chunks: ["Hello", "world."] (cut by sentence boundary at "Goodbye")
      // and ["Goodbye", "world."] (end of stream).
      const chunks = events.filter(
        (e): e is Extract<RsvpEvent, { type: 'chunk' }> => e.type === 'chunk',
      );
      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toBe('Hello world.');
      expect(chunks[0].words).toEqual(['Hello', 'world.']);
      expect(chunks[1].text).toBe('Goodbye world.');
      expect(chunks[1].words).toEqual(['Goodbye', 'world.']);
    });
  });

  describe('punctuation pacing (chunk last-word multiplier)', () => {
    it('uses the chunk last-word multiplier for the next gap (sentence-end → 1.5×)', () => {
      // First chunk = ["Hello", "world."] ends in '.'; gap before next
      // chunk should be 1.5 × base. Use 600 wpm → 100ms base, 150ms paced.
      const engine = createRsvpEngine({
        words: ['Hello', 'world.', 'Goodbye', 'world.'],
        wpm: 600,
        chunkSize: 3,
        punctuationPacing: true,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // 1 chunk emitted synchronously.
      expect(events).toHaveLength(1);

      // Advance base-only (100ms). Pacing should hold the next chunk
      // until 150ms — at 100ms, no new event.
      vi.advanceTimersByTime(100);
      expect(events).toHaveLength(1);

      // Advance the remaining 50ms (paced multiplier × base).
      vi.advanceTimersByTime(50);
      expect(events).toHaveLength(2);
    });

    it('non-sentence-ending chunk uses 1.0× base', () => {
      // First chunk = ["The", "quick"] does not end in punctuation; gap
      // should be exactly base (no multiplier).
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox.'],
        wpm: 600,
        chunkSize: 2,
        punctuationPacing: true,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events).toHaveLength(1);
      vi.advanceTimersByTime(100); // base only
      expect(events).toHaveLength(2);
    });
  });

  describe('seekTo (chunk mode)', () => {
    it('mid-chunk word-axis index snaps to the chunk containing it', () => {
      // chunks at chunkSize=2: [The quick] [brown fox.] [jumps over.]
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox.', 'jumps', 'over.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      // Initial start emitted chunk 0.
      const before = events.length;
      // Seek to word-axis index 3 ("fox.") — should snap to chunk 1 ("brown fox.").
      engine.seekTo(3);
      const lastEvent = events[events.length - 1];
      expect(events.length).toBeGreaterThan(before);
      expect(lastEvent).toEqual({
        type: 'chunk',
        startIndex: 2,
        endIndex: 3,
        text: 'brown fox.',
        words: ['brown', 'fox.'],
      });
    });

    it('seek past the end transitions to done', () => {
      const engine = createRsvpEngine({
        words: ['a', 'b.', 'c', 'd.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      engine.seekTo(999);
      expect(engine.state).toBe('done');
      expect(events[events.length - 1]).toEqual({ type: 'done' });
    });

    it('negative seek clamps to chunk 0', () => {
      const engine = createRsvpEngine({
        words: ['a', 'b', 'c.', 'd', 'e.'],
        wpm: 300,
        chunkSize: 3,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      engine.seekTo(-5);
      const last = events[events.length - 1];
      // First chunk is words 0..2 → "a b c."
      expect(last).toMatchObject({ type: 'chunk', startIndex: 0 });
    });
  });

  describe('seekToSentence (chunk mode)', () => {
    it('next sentence walks past current to the sentence after the chunk just emitted', () => {
      // 3 sentences in chunkSize=2: "A B." "C D." "E F."
      // chunks: ["A B."] ["C D."] ["E F."]
      // After start: chunk 0 emitted ("A B."). next-sentence skips past
      // current sentence (B. is sentenceEnd) → targets "C" → snaps to chunk 1.
      const engine = createRsvpEngine({
        words: ['A', 'B.', 'C', 'D.', 'E', 'F.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      engine.seekToSentence('next');
      const last = events[events.length - 1];
      expect(last).toMatchObject({ type: 'chunk', text: 'C D.' });
    });

    it('next sentence at last sentence is a no-op (matches word mode contract)', () => {
      // Single sentence stream: no sentenceStart exists past index 0,
      // so next-sentence is a no-op (matches word mode: nav key cannot
      // navigate past the last sentence). Using one sentence makes
      // the absence-of-future-sentenceStart unambiguous.
      const engine = createRsvpEngine({
        words: ['no', 'periods', 'here'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      const beforeLen = events.length;
      engine.seekToSentence('next');
      expect(events.length).toBe(beforeLen);
      expect(engine.state).toBe('paused');
    });

    it('prev sentence on first sentence is a no-op for navigation (stays at start, emits replacement on paused)', () => {
      const engine = createRsvpEngine({
        words: ['A.', 'B.', 'C.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      // After start, chunk 0 emitted (just "A."). seekToSentence('prev')
      // should walk back to sentence start at A. → chunk 0 again.
      engine.seekToSentence('prev');
      const last = events[events.length - 1];
      expect(last).toMatchObject({ type: 'chunk', text: 'A.' });
    });
  });

  describe('progress() reports filtered-word axis', () => {
    it('reports words consumed across chunks', () => {
      const engine = createRsvpEngine({
        words: ['a', 'b', 'c', 'd.', 'e', 'f.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // After first tick, 2 of 6 words consumed (chunk 0 = "a b").
      expect(engine.progress()).toEqual({ index: 2, total: 6, ratio: 2 / 6 });
      vi.advanceTimersByTime(60000 / 300);
      expect(engine.progress()).toEqual({ index: 4, total: 6, ratio: 4 / 6 });
    });
  });

  describe('back-compat: chunkSize === 1 still emits word events (Q4)', () => {
    it('chunkSize=1 keeps legacy word emission unchanged', () => {
      const engine = createRsvpEngine({
        words: ['hello', 'world.'],
        wpm: 300,
        chunkSize: 1,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events[0]).toEqual({ type: 'word', index: 0, word: 'hello' });
      vi.advanceTimersByTime(60000 / 300);
      expect(events[1]).toEqual({ type: 'word', index: 1, word: 'world.' });
    });

    it('chunkSize undefined keeps legacy word emission unchanged', () => {
      const engine = createRsvpEngine({
        words: ['hello', 'world.'],
        wpm: 300,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events[0]).toEqual({ type: 'word', index: 0, word: 'hello' });
    });
  });

  describe('empty / single-chunk cases', () => {
    it('empty words array → done immediately on start (matches word mode)', () => {
      const engine = createRsvpEngine({ words: [], wpm: 300, chunkSize: 2 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events).toEqual([{ type: 'done' }]);
    });

    it('single chunk → emits then done on next tick', () => {
      const engine = createRsvpEngine({ words: ['Hi.'], wpm: 300, chunkSize: 3 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events[0]).toMatchObject({ type: 'chunk', text: 'Hi.' });
      vi.advanceTimersByTime(60000 / 300);
      expect(events[1]).toEqual({ type: 'done' });
    });
  });

  describe('setWords rebuilds chunks', () => {
    it('swapping words array rebuilds the chunk stream', () => {
      const engine = createRsvpEngine({
        words: ['a', 'b', 'c.', 'd', 'e.'],
        wpm: 300,
        chunkSize: 2,
      });
      engine.setWords(['Hello', 'world.', 'Goodbye', 'world.']);
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      expect(events[0]).toMatchObject({ type: 'chunk', text: 'Hello world.' });
    });
  });
});
