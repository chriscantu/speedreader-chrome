import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRsvpEngine } from '../rsvp-engine';
import type { RsvpEvent } from '../rsvp-engine';

/**
 * `setWords(words)` replaces the engine's word stream in-place. Required by
 * the scope-swap state machine (spec
 * `docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 * §"Expand to full") so the overlay can swap selection-mode tokens for
 * full-article tokens without tearing down and re-subscribing to a fresh
 * engine instance.
 *
 * Contract:
 *   - Replaces the words array (defensive slice).
 *   - Resets nextIndex to 0.
 *   - Resets state to `idle`. The next emission requires a `start()` or
 *     `seekTo()` call; `setWords` itself emits nothing.
 *   - Clears any pending scheduled tick.
 *   - Callable from any prior state (idle / playing / paused / done).
 *   - Validates the words argument via the same boundary check used at
 *     construction (`assertValidWords`).
 */

describe('rsvpEngine.setWords', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replaces words and resets nextIndex to 0 from idle', () => {
    const engine = createRsvpEngine({ words: ['a', 'b', 'c'], wpm: 300 });
    expect(engine.state).toBe('idle');

    engine.setWords(['x', 'y']);

    expect(engine.state).toBe('idle');
    expect(engine.progress()).toEqual({ index: 0, total: 2, ratio: 0 });
  });

  it('replaces words and resets state from playing to idle', () => {
    const engine = createRsvpEngine({ words: ['a', 'b', 'c'], wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    expect(engine.state).toBe('playing');
    expect(events).toEqual([{ type: 'word', index: 0, word: 'a' }]);

    engine.setWords(['x', 'y', 'z', 'w']);

    expect(engine.state).toBe('idle');
    expect(engine.progress()).toEqual({ index: 0, total: 4, ratio: 0 });
  });

  it('replaces words and resets state from paused to idle', () => {
    const engine = createRsvpEngine({ words: ['a', 'b', 'c'], wpm: 300 });
    engine.start();
    engine.pause();
    expect(engine.state).toBe('paused');

    engine.setWords(['x']);

    expect(engine.state).toBe('idle');
    expect(engine.progress()).toEqual({ index: 0, total: 1, ratio: 0 });
  });

  it('replaces words and resets state from done to idle', () => {
    const engine = createRsvpEngine({ words: ['a'], wpm: 300 });
    engine.start();
    vi.advanceTimersByTime(60000 / 300);
    expect(engine.state).toBe('done');

    engine.setWords(['x', 'y', 'z']);

    expect(engine.state).toBe('idle');
    expect(engine.progress()).toEqual({ index: 0, total: 3, ratio: 0 });
  });

  it('emits nothing when called', () => {
    const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 300 });
    engine.start();
    const eventsAfterSwap: RsvpEvent[] = [];
    engine.subscribe((e) => eventsAfterSwap.push(e));

    engine.setWords(['x', 'y']);

    expect(eventsAfterSwap).toEqual([]);
  });

  it('clears the pending scheduled tick (no emission after swap when idle)', () => {
    const engine = createRsvpEngine({ words: ['a', 'b', 'c'], wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    expect(events.length).toBe(1);

    engine.setWords(['x', 'y']);

    // Advance well past several word-intervals; no tick should fire because
    // setWords leaves the engine in idle and clearPending() cancelled the
    // scheduled timer.
    vi.advanceTimersByTime((60000 / 300) * 10);
    expect(events.length).toBe(1); // unchanged
  });

  it('next start() emits from the new words[0]', () => {
    const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    expect(events).toEqual([{ type: 'word', index: 0, word: 'a' }]);

    engine.setWords(['x', 'y', 'z']);
    engine.start();

    expect(events).toEqual([
      { type: 'word', index: 0, word: 'a' },
      { type: 'word', index: 0, word: 'x' },
    ]);
  });

  it('next seekTo() with paused source emits from the new words at target index', () => {
    const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));

    engine.setWords(['x', 'y', 'z']);
    // Engine is idle after setWords; bring to paused state to test seekTo
    // emission semantics on the new words list.
    engine.start();
    engine.pause();
    engine.seekTo(2);

    expect(events).toEqual([
      { type: 'word', index: 0, word: 'x' },
      { type: 'word', index: 2, word: 'z' },
    ]);
  });

  it('defensively copies the input array', () => {
    const input = ['x', 'y'];
    const engine = createRsvpEngine({ words: ['a'], wpm: 300 });

    engine.setWords(input);
    input.push('z');

    expect(engine.progress().total).toBe(2);
  });

  it('rejects a non-array argument', () => {
    const engine = createRsvpEngine({ words: ['a'], wpm: 300 });
    // @ts-expect-error — runtime guard at the API boundary
    expect(() => engine.setWords('not-an-array')).toThrow(TypeError);
  });

  it('rejects an array with a non-string element', () => {
    const engine = createRsvpEngine({ words: ['a'], wpm: 300 });
    // @ts-expect-error — runtime guard at the API boundary
    expect(() => engine.setWords(['x', 42, 'z'])).toThrow(TypeError);
  });

  it('accepts an empty words array (next start emits done)', () => {
    const engine = createRsvpEngine({ words: ['a', 'b'], wpm: 300 });
    const events: RsvpEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    expect(events.length).toBe(1);

    engine.setWords([]);
    expect(engine.state).toBe('idle');
    expect(engine.progress()).toEqual({ index: 0, total: 0, ratio: 0 });

    engine.start();
    expect(events).toEqual([{ type: 'word', index: 0, word: 'a' }, { type: 'done' }]);
    expect(engine.state).toBe('done');
  });
});
