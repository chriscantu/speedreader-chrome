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

  describe('raw-axis indices with paragraph sentinels interleaved (#51 architect HIGH)', () => {
    // Engine word axis includes paragraph sentinels ('\n\n') and dashes
    // ('—' / '–'). Chunk-mode startIndex/endIndex MUST key to that raw
    // axis (via WordToken.rawIndex) so a chunk's startIndex === N and a
    // word-mode `word` event with index === N point at the same source
    // token. A regression that keys to local filtered-word positions
    // would silently corrupt #47 scrubber + #48 cross-mode position
    // persistence.
    it('chunk startIndex/endIndex align with raw word-mode index on the same tokens', () => {
      // Raw tokens (paragraph sentinel between "quick" and "brown"):
      //   ['The', 'quick', '\n\n', 'brown', 'fox.']
      //      0      1        2       3        4
      // markSentenceBoundaries:
      //   word(The, start:true, rawIndex:0)
      //   word(quick, start:false, rawIndex:1)
      //   paragraph (resets nextWordStartsSentence=true)
      //   word(brown, start:true, rawIndex:3)
      //   word(fox., start:false, end:true, rawIndex:4)
      // chunkSize=3 chunks (sentence-boundary respect):
      //   chunk 0: [The, quick]     raw 0..1 (capped at next sentence)
      //   chunk 1: [brown, fox.]    raw 3..4
      // chunk 0's endIndex MUST be 1 (rawIndex of `quick`), NOT 1
      // (local) — pre-fix would have been 1 too coincidentally, so
      // the load-bearing assertion is chunk 1's startIndex=3, NOT 2
      // (local chunkWords position of brown is 2). Pre-fix:
      // startIndex would be 2; post-fix: 3 (paragraph slot accounted).
      const rawWords = ['The', 'quick', '\n\n', 'brown', 'fox.'];

      // Word-mode reference: word at raw index 3 should be `brown`.
      const wordEngine = createRsvpEngine({ words: rawWords, wpm: 300 });
      const wordEvents: RsvpEvent[] = [];
      wordEngine.subscribe((e) => wordEvents.push(e));
      wordEngine.start();
      vi.advanceTimersByTime(60000 / 300); // index 1: quick
      vi.advanceTimersByTime(60000 / 300); // index 2: '\n\n'
      vi.advanceTimersByTime(60000 / 300); // index 3: brown
      expect(wordEvents[3]).toMatchObject({ type: 'word', index: 3, word: 'brown' });

      // Chunk-mode: chunk 1's startIndex MUST be 3 (rawIndex of
      // `brown`), matching the word-mode `word` event index above.
      // Pre-fix (local-position keying) this would be 2 instead.
      const chunkEngine = createRsvpEngine({
        words: rawWords,
        wpm: 300,
        chunkSize: 3,
      });
      const chunkEvents: RsvpEvent[] = [];
      chunkEngine.subscribe((e) => chunkEvents.push(e));
      chunkEngine.start();
      vi.advanceTimersByTime(60000 / 300);

      const chunks = chunkEvents.filter(
        (e): e is Extract<RsvpEvent, { type: 'chunk' }> => e.type === 'chunk',
      );
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toMatchObject({
        startIndex: 0,
        endIndex: 1,
        text: 'The quick',
      });
      expect(chunks[1]).toMatchObject({
        startIndex: 3,
        endIndex: 4,
        text: 'brown fox.',
      });
    });

    it('progress() chunk-mode total matches raw token count (mode-switch monotonic for scrubber)', () => {
      // Raw stream: 5 tokens (4 words + 1 paragraph sentinel). Both
      // chunk-mode and word-mode `progress().total` MUST report 5 so
      // a scrubber consumer can map position bidirectionally.
      const rawWords = ['The', 'quick', '\n\n', 'brown', 'fox.'];

      const wordEngine = createRsvpEngine({ words: rawWords, wpm: 300 });
      expect(wordEngine.progress()).toEqual({ index: 0, total: 5, ratio: 0 });

      const chunkEngine = createRsvpEngine({ words: rawWords, wpm: 300, chunkSize: 3 });
      expect(chunkEngine.progress()).toEqual({ index: 0, total: 5, ratio: 0 });

      // After first chunk tick, chunk-mode index = chunk 0's endIndex
      // + 1 = 2 (raw axis). Word-mode after 2 ticks (consuming raw
      // tokens 0, 1) would also report index = 2.
      const events: RsvpEvent[] = [];
      chunkEngine.subscribe((e) => events.push(e));
      chunkEngine.start();
      expect(chunkEngine.progress().index).toBe(2);
      expect(chunkEngine.progress().total).toBe(5);
    });
  });

  // FIX-3 — pause/resume in chunk mode. Catches a regression that
  // accidentally swaps resume()'s totalTicks() back to words.length
  // (which would make a paused chunk-mode engine fire `done` instead
  // of resuming).
  describe('pause / resume (chunk mode)', () => {
    it('pause halts emission; resume fires next chunk exactly one msPerWord later', () => {
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox', 'jumps', 'over.'],
        wpm: 600,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // First chunk emits synchronously on start.
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'chunk', text: 'The quick' });

      // Advance one tick (100ms at 600 wpm) → second chunk fires.
      vi.advanceTimersByTime(100);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({ type: 'chunk', text: 'brown fox' });

      // Pause and assert no new event fires across many ticks.
      engine.pause();
      const beforeLen = events.length;
      vi.advanceTimersByTime(10_000);
      expect(events.length).toBe(beforeLen);
      expect(engine.state).toBe('paused');

      // Resume. Next chunk should fire exactly msPerWord later (100ms).
      engine.resume();
      // Just before the tick fires — still paused-len.
      vi.advanceTimersByTime(99);
      expect(events.length).toBe(beforeLen);
      vi.advanceTimersByTime(1);
      expect(events.length).toBe(beforeLen + 1);
      expect(events[events.length - 1]).toMatchObject({
        type: 'chunk',
        text: 'jumps over.',
      });
    });
  });

  // FIX-6 — pre-start progress in chunk mode. Mutation guard: returning
  // `chunks.length` for `index` instead of 0 must fail.
  describe('progress() before start (chunk mode)', () => {
    it('returns {index: 0, total: rawWords, ratio: 0} before start()', () => {
      const engine = createRsvpEngine({
        words: ['a', 'b', 'c', 'd.', 'e', 'f.'],
        wpm: 300,
        chunkSize: 2,
      });
      // Pre-start: nothing consumed yet.
      expect(engine.progress()).toEqual({ index: 0, total: 6, ratio: 0 });
    });
  });

  // FIX-7 — timeElapsed / timeRemaining in chunk mode. Mutation guards:
  // multiplying by 2 (wrong cadence) OR returning chunks.length instead
  // of (chunks.length - nextIndex) for remaining must fail.
  describe('timeElapsed / timeRemaining (chunk mode)', () => {
    it('timeElapsed grows by msPerWord per emitted chunk; timeRemaining shrinks symmetrically', () => {
      // 6 words, chunkSize=2 → 3 chunks. At 600 wpm, msPerWord = 100.
      // Cadence: chunk = 1 tick (engine comment "One tick = msPerWord per chunk").
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox', 'jumps', 'over.'],
        wpm: 600,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));

      // Pre-start: elapsed=0, remaining=3 chunks × 100ms = 300.
      expect(engine.timeElapsed()).toBe(0);
      expect(engine.timeRemaining()).toBe(300);

      engine.start();
      // After 1 chunk emission: elapsed=100, remaining=200.
      expect(engine.timeElapsed()).toBe(100);
      expect(engine.timeRemaining()).toBe(200);

      vi.advanceTimersByTime(100);
      expect(engine.timeElapsed()).toBe(200);
      expect(engine.timeRemaining()).toBe(100);

      vi.advanceTimersByTime(100);
      // Third chunk emitted; remaining=0.
      expect(engine.timeElapsed()).toBe(300);
      expect(engine.timeRemaining()).toBe(0);

      // Done after one more tick.
      vi.advanceTimersByTime(100);
      expect(events[events.length - 1]).toEqual({ type: 'done' });
      expect(engine.timeRemaining()).toBe(0);
    });
  });

  // FIX-8 (round-2 rewrite) — seekTo snapToSentence in chunk mode.
  // Round-1 stream `['A','B.','C','D','E.','F','G','H.']` was NOT
  // discriminating: every sentence-start word in that stream is also
  // a chunk-start word, so snapped vs unsnapped seek lands in the
  // same chunk (snap walks back to the chunk-start). To make the
  // snap branch mutation-discriminating we need a stream where the
  // sentence-start word lives in a PRIOR chunk than the chunk
  // containing the target word — that requires a sentence that
  // spans multiple chunks. Stream:
  //
  //   ['The', 'quick', 'brown', 'fox.', 'Jumps.']
  //      0       1        2       3        4
  //
  // markSentenceBoundaries:
  //   The   word rawIndex=0 sentenceStart=true
  //   quick word rawIndex=1
  //   brown word rawIndex=2
  //   fox.  word rawIndex=3 sentenceEnd=true
  //   Jumps. word rawIndex=4 sentenceStart=true sentenceEnd=true
  //
  // buildChunks chunkSize=2:
  //   chunk 0: [The, quick]   raw 0..1
  //   chunk 1: [brown, fox.]  raw 2..3
  //   chunk 2: [Jumps.]       raw 4
  //
  // Seek raw=3 (`fox.`) unsnapped → chunk 1 ([brown, fox.],
  //   startIndex=2). Snap walks back from fox.[3] → brown[2] →
  //   quick[1] → The[0].sentenceStart=true → raw=0 → chunk 0
  //   ([The, quick], startIndex=0). DIFFERENT chunks.
  //
  // Mutation: removing the `if (snapToSentence && rawTarget <
  // totalRawWords)` block in `seekToChunk` means snap never fires —
  // the snapped assertion would see startIndex=2 instead of 0 and
  // fail. The unsnapped assertion guards against the inverse
  // mutation (snap always fires).
  describe('seekTo({ snapToSentence: true }) — chunk mode', () => {
    const stream = ['The', 'quick', 'brown', 'fox.', 'Jumps.'];

    it('snapped seek (raw=3, snap=true) lands chunk [The quick] with startIndex=0', () => {
      const engine = createRsvpEngine({ words: stream, wpm: 300, chunkSize: 2 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      // Sanity: chunk 0 emitted on start.
      expect(events[0]).toMatchObject({ type: 'chunk', text: 'The quick' });

      engine.seekTo(3, { snapToSentence: true });
      const last = events[events.length - 1];
      expect(last).toMatchObject({
        type: 'chunk',
        startIndex: 0,
        endIndex: 1,
        text: 'The quick',
      });
    });

    it('unsnapped seek (raw=3, no snap) lands chunk [brown fox.] with startIndex=2', () => {
      const engine = createRsvpEngine({ words: stream, wpm: 300, chunkSize: 2 });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      expect(events[0]).toMatchObject({ type: 'chunk', text: 'The quick' });

      engine.seekTo(3);
      const last = events[events.length - 1];
      expect(last).toMatchObject({
        type: 'chunk',
        startIndex: 2,
        endIndex: 3,
        text: 'brown fox.',
      });
    });
  });

  // FIX-2 — live setChunkSize. Engine rebuilds chunks + maps the
  // current raw position into the new layout per state machine semantics.
  describe('setChunkSize (live update)', () => {
    it('idle 1 → 2 enables chunk emission for the next start()', () => {
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox.'],
        wpm: 300,
        chunkSize: 1,
      });
      engine.setChunkSize(2);
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // Should emit a chunk event, not a word event.
      expect(events[0]).toMatchObject({ type: 'chunk', text: 'The quick' });
    });

    it('paused 2 → 3 rebuilds chunks and emits replacement at new chunk', () => {
      // chunkSize=2 chunks: [The quick] [brown fox] [jumps over.]
      // After tick #1 starts (chunk 0 emitted), pause, then setChunkSize(3).
      // chunkSize=3 chunks: [The quick brown] [fox jumps over.]
      // Current raw position after first chunk = 2 → chunk index 0 in
      // new layout (because chunks[0] spans raw 0..2). Replacement
      // emit should be chunk 0 of the new layout.
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox', 'jumps', 'over.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      const before = events.length;
      engine.setChunkSize(3);
      expect(events.length).toBeGreaterThan(before);
      const last = events[events.length - 1];
      expect(last).toMatchObject({
        type: 'chunk',
        text: 'The quick brown',
        startIndex: 0,
        endIndex: 2,
      });
    });

    it('playing 2 → 1 flips engine to word emission mid-session', () => {
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // Chunk 0 emitted ("The quick"); raw position now = 2.
      expect(events[0]).toMatchObject({ type: 'chunk' });

      engine.setChunkSize(1);
      // Playing → tick fires immediately at the new mode. Next event
      // should be a `word` event, not a `chunk` event.
      const next = events[events.length - 1];
      expect(next.type).toBe('word');
      // Word index should resume at the raw position we held (2),
      // i.e. the word `brown`.
      if (next.type === 'word') {
        expect(next.index).toBe(2);
        expect(next.word).toBe('brown');
      }
    });

    it('same chunkSize value is a no-op (no replacement emit on paused)', () => {
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      const before = events.length;
      engine.setChunkSize(2);
      expect(events.length).toBe(before);
    });

    it('invalid input (0, 4, non-integer) is a no-op', () => {
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox.'],
        wpm: 300,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      engine.pause();
      const before = events.length;
      // @ts-expect-error — exercising runtime validation with invalid input
      engine.setChunkSize(0);
      // @ts-expect-error — exercising runtime validation with invalid input
      engine.setChunkSize(4);
      // @ts-expect-error — exercising runtime validation with invalid input
      engine.setChunkSize(2.5);
      // @ts-expect-error — exercising runtime validation with invalid input
      engine.setChunkSize('2');
      expect(events.length).toBe(before);
      expect(engine.state).toBe('paused');
    });

    // Round-2 ITEM-5: setChunkSize on a DONE engine must NOT emit and
    // must NOT move nextIndex backward. Captures the failure mode
    // where a future refactor unifies the DONE / IDLE / PAUSED /
    // PLAYING branches and accidentally re-emits or resets nextIndex.
    //
    // Mutation: removing the `if (state === RSVP_STATE.DONE) { ... return; }`
    // early-return in `setChunkSize` lets the IDLE/PAUSED reset path
    // run on a DONE engine, which would either emit a fresh event or
    // reset nextIndex away from past-end. Either failure mode flips
    // an assertion below.
    it('done state: setChunkSize pins past-end and emits no events', () => {
      // 4 words at chunkSize=2 → 2 chunks. High WPM so timers drain
      // quickly.
      const engine = createRsvpEngine({
        words: ['The', 'quick', 'brown', 'fox.'],
        wpm: 600,
        chunkSize: 2,
      });
      const events: RsvpEvent[] = [];
      engine.subscribe((e) => events.push(e));
      engine.start();
      // Run all timers to drive the engine to DONE. With 2 chunks at
      // 600 wpm (msPerWord=100), one tick fires chunk 1 and the
      // next tick fires `done`.
      vi.runAllTimers();
      expect(engine.state).toBe('done');
      expect(events[events.length - 1]).toEqual({ type: 'done' });
      const beforeCount = events.length;
      const beforeProgress = engine.progress();
      expect(beforeProgress.index).toBe(beforeProgress.total);

      // Live update on DONE engine.
      engine.setChunkSize(3);

      // No new events emitted.
      expect(events.length).toBe(beforeCount);
      // State still DONE.
      expect(engine.state).toBe('done');
      // progress() index still pinned to total (past-end). Note:
      // chunkSize=3 rebuilds chunks to [[The quick brown], [fox.]]
      // (still 2 chunks); past-end pin yields index === total.
      const afterProgress = engine.progress();
      expect(afterProgress.index).toBe(afterProgress.total);
    });
  });
});
