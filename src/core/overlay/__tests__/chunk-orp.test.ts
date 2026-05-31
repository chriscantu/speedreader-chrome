/**
 * chunk-orp.test.ts — issue #52 PART C (#51 Q3 deferred)
 *
 * Chunk events in #51 rendered `ev.text` (the full joined chunk string)
 * via `renderWord`, which called `splitWordAtFocus` on the WHOLE chunk.
 * Result: nonsense ORP split on multi-word strings (`splitWordAtFocus`
 * of `"The quick"` returned `focus = 'e'` somewhere in the middle, not
 * one focus character per word).
 *
 * Fix: new `renderChunk(region, chunkText, chunkWords)` renders each
 * word as its own .word-run with before/focus/after spans; runs
 * separated by space text nodes. The chunk text remains the aria-live
 * value (single readable unit) — that's covered in chunk-render.test.ts.
 *
 * Mutation guards:
 *   - Falling back to renderWord(region, ev.text) fails the per-word
 *     focus-count assertion (1 focus vs N=words.length focuses).
 *   - Omitting space text nodes fails the joined-textContent assertion.
 *   - Wrapping words in the wrong tag (no .word-run class) fails the
 *     selector-bound assertion.
 *   - Setting focus class on the wrong word index fails the
 *     per-word-spans-order assertion.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';
import { OVERLAY_CLASS } from '../constants';
import { renderChunk } from '../word';

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

function getRegion(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.WORD_REGION}`);
  if (!el) throw new Error('overlay shadow: missing word-region');
  return el;
}

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['The', 'quick', 'brown', 'fox.'],
    initialSettings: { theme: 'system', wpm: 300, fontSize: 20, chunkSize: 2 },
    subscribeSettings: () => () => undefined,
    engineFactory: createRsvpEngine,
    ...overrides,
  };
}

describe('renderChunk — per-word ORP render (#52 PART C)', () => {
  test('renders N .word-run children for N chunk words', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderChunk(region, 'The quick', ['The', 'quick']);
    const runs = region.querySelectorAll(`.${OVERLAY_CLASS.WORD_RUN}`);
    expect(runs).toHaveLength(2);
  });

  test('each word-run contains exactly one .focus span (per-word ORP)', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderChunk(region, 'The quick brown', ['The', 'quick', 'brown']);
    const runs = region.querySelectorAll(`.${OVERLAY_CLASS.WORD_RUN}`);
    expect(runs).toHaveLength(3);
    for (const run of runs) {
      const focuses = run.querySelectorAll('.focus');
      expect(focuses).toHaveLength(1);
    }
  });

  test('each word-run has three spans (before / focus / after)', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderChunk(region, 'quick brown', ['quick', 'brown']);
    const runs = region.querySelectorAll(`.${OVERLAY_CLASS.WORD_RUN}`);
    for (const run of runs) {
      // each run has exactly 3 immediate <span> children
      const spans = run.querySelectorAll(':scope > span');
      expect(spans).toHaveLength(3);
      expect(spans[1].classList.contains('focus')).toBe(true);
    }
  });

  test('word-runs are separated by space text nodes', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderChunk(region, 'a b c', ['a', 'b', 'c']);
    // Expected child sequence: run, space-text, run, space-text, run
    const children = Array.from(region.childNodes);
    expect(children).toHaveLength(5);
    expect((children[0] as Element).className).toContain(OVERLAY_CLASS.WORD_RUN);
    expect(children[1].nodeType).toBe(Node.TEXT_NODE);
    expect(children[1].textContent).toBe(' ');
    expect((children[2] as Element).className).toContain(OVERLAY_CLASS.WORD_RUN);
    expect(children[3].textContent).toBe(' ');
    expect((children[4] as Element).className).toContain(OVERLAY_CLASS.WORD_RUN);
  });

  test('joined textContent preserves the visible chunk string', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderChunk(region, 'The quick brown', ['The', 'quick', 'brown']);
    expect(region.textContent).toBe('The quick brown');
  });

  test('repeated calls replace prior content', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderChunk(region, 'first second', ['first', 'second']);
    renderChunk(region, 'third', ['third']);
    expect(region.textContent).toBe('third');
    expect(region.querySelectorAll(`.${OVERLAY_CLASS.WORD_RUN}`)).toHaveLength(1);
  });

  test('single-word chunk renders one word-run (no trailing space text node)', () => {
    const doc = document.implementation.createHTMLDocument('t');
    const region = doc.createElement('div');
    renderChunk(region, 'solo', ['solo']);
    expect(region.childNodes).toHaveLength(1);
    expect(region.querySelectorAll(`.${OVERLAY_CLASS.WORD_RUN}`)).toHaveLength(1);
  });
});

describe('createOverlay — chunk ORP integration (#52 PART C)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
    vi.useRealTimers();
  });

  test('chunk-mode emission renders one .focus per word in the chunk (not one per chunk-text)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    // First chunk: "The quick" (chunkSize=2). The pre-fix render path called
    // renderWord(region, "The quick") which produced ONE .focus span on
    // splitWordAtFocus("The quick"). The fix renders two .word-run children,
    // each with its own .focus — total 2.
    const region = getRegion();
    const focuses = region.querySelectorAll('.focus');
    expect(focuses).toHaveLength(2);
    overlay.unmount();
  });

  test('single-word mode (chunkSize=1) renders exactly one .word-run with one .focus', () => {
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, chunkSize: 1 },
      }),
    );
    overlay.mount();
    const region = getRegion();
    // chunkSize=1 → word events, renderWord path → ONE .word-run wrapper
    // (the wrapper is the grid container the orp-alignment CSS consumes,
    // shared between single-word and chunk modes).
    expect(region.querySelectorAll(`.${OVERLAY_CLASS.WORD_RUN}`)).toHaveLength(1);
    // Exactly one .focus span (per-word ORP, single word).
    const focuses = region.querySelectorAll('.focus');
    expect(focuses).toHaveLength(1);
    overlay.unmount();
  });

  test('chunk-mode visible text matches ev.text (aria-live announces full chunk)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    expect(getRegion().textContent).toBe('The quick');
    const live = getShadow().querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('The quick');
    overlay.unmount();
  });
});
