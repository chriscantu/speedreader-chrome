/**
 * Overlay chunk-event render coverage (#51 test-gap HIGH #2).
 *
 * The overlay engine subscribe handler has two top-level branches:
 * `word` events and `chunk` events. The `word` branch is covered by
 * the other overlay tests; this file pins the `chunk` branch
 * explicitly.
 *
 * Mutation guards:
 *   - Swapping `ev.text` → `ev.words[0]` (only first chunk word) must fail
 *     — the chunk-text assertion catches it.
 *   - Dropping the `ariaLive.textContent = ev.text` line must fail —
 *     the aria-live assertion catches it.
 *   - Failing to invoke `onWordAdvance` on chunk events must fail.
 *   - Paused-state `renderPreview` failing to surface chunk context
 *     must fail (preview hidden assertion).
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';
import { OVERLAY_CLASS } from '../constants';

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

function getEl<T extends Element>(root: ShadowRoot, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`overlay shadow: missing selector ${sel}`);
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

describe('createOverlay — chunk event rendering (#51)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
    vi.useRealTimers();
  });

  test('word region renders full chunk text (ev.text), not ev.words[0]', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const root = getShadow();
    // Engine emits chunk 0 synchronously on start → "The quick" (chunkSize=2).
    expect(getEl(root, `.${OVERLAY_CLASS.WORD_REGION}`).textContent).toBe('The quick');
    // Advance one tick → "brown fox." (chunkSize=2 over 4 words).
    vi.advanceTimersByTime(60000 / 300);
    expect(getEl(root, `.${OVERLAY_CLASS.WORD_REGION}`).textContent).toBe('brown fox.');
    overlay.unmount();
  });

  test('aria-live region announces the full chunk text', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const root = getShadow();
    expect(getEl(root, '[aria-live="polite"]').textContent).toBe('The quick');
    vi.advanceTimersByTime(60000 / 300);
    expect(getEl(root, '[aria-live="polite"]').textContent).toBe('brown fox.');
    overlay.unmount();
  });

  test('onWordAdvance fires on each chunk event with post-emit raw-axis progress', () => {
    // Round-2 ITEM-3: stream contains a paragraph sentinel ('\n\n')
    // between "quick" and "brown" so raw axis (5) and filtered-word
    // axis (4) DIVERGE. A regression that reverts progress().index
    // / total to filtered-word counts would report (2, 4) and
    // (4, 4); the raw-axis assertions (2, 5) and (5, 5) catch it.
    //
    // markSentenceBoundaries:
    //   The   word rawIndex=0 sentenceStart=true
    //   quick word rawIndex=1
    //   \n\n  paragraph (no rawIndex; sets next word sentenceStart)
    //   brown word rawIndex=3 sentenceStart=true
    //   fox.  word rawIndex=4 sentenceEnd=true
    //
    // buildChunks chunkSize=2 (filtered word axis):
    //   chunk 0: [The, quick]   raw 0..1
    //   chunk 1: [brown, fox.]  raw 3..4
    //
    // After chunk 0 emit: progress.index = chunk 0 endIndex + 1 = 2.
    // After chunk 1 emit: nextIndex >= chunks.length → index = total = 5.
    const onWordAdvance = vi.fn();
    const overlay = createOverlay(
      defaultOpts({
        scope: 'full',
        fullWords: ['The', 'quick', '\n\n', 'brown', 'fox.'],
        // Override default initialSettings to keep chunkSize=2 with
        // the sentinel-bearing stream.
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, chunkSize: 2 },
        onWordAdvance,
      }),
    );
    overlay.mount();
    // After first chunk: progress.index = 2 (raw), total = 5 (raw
    // including the paragraph sentinel slot).
    expect(onWordAdvance).toHaveBeenCalledTimes(1);
    expect(onWordAdvance).toHaveBeenLastCalledWith({ index: 2, total: 5 });
    vi.advanceTimersByTime(60000 / 300);
    expect(onWordAdvance).toHaveBeenCalledTimes(2);
    expect(onWordAdvance).toHaveBeenLastCalledWith({ index: 5, total: 5 });
    overlay.unmount();
  });

  test('paused state: chunk-driven renderPreview surfaces the chunk word in context', () => {
    // Stream long enough that the chunk lands mid-sentence so the
    // sentence-context builder can produce before/current/after.
    const overlay = createOverlay(
      defaultOpts({
        words: ['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog.'],
        // #242 — preview only shows when `contextLine` is enabled.
        initialSettings: {
          theme: 'system',
          wpm: 300,
          fontSize: 20,
          chunkSize: 2,
          contextLine: true,
        },
      }),
    );
    overlay.mount();
    const root = getShadow();
    const preview = getEl<HTMLElement>(root, `.${OVERLAY_CLASS.CONTEXT_PREVIEW}`);
    // #242 — preview not visible while playing; slot stays in flow (no
    // `hidden` attribute / no display:none → no reflow on toggle).
    expect(preview.style.visibility).toBe('hidden');
    expect(preview.hasAttribute('hidden')).toBe(false);

    // Pause via space key — togglePlayPause renders the preview.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(preview.style.visibility).toBe('visible');
    // Preview text contains the current chunk word (rendered as the
    // `<strong>` child).
    const current = preview.querySelector('strong');
    expect(current).not.toBeNull();
    expect(current?.textContent?.length ?? 0).toBeGreaterThan(0);
    overlay.unmount();
  });
});
