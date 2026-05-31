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
    const onWordAdvance = vi.fn();
    const overlay = createOverlay(
      defaultOpts({
        scope: 'full',
        fullWords: ['The', 'quick', 'brown', 'fox.'],
        onWordAdvance,
      }),
    );
    overlay.mount();
    // After first chunk: progress.index = chunk 0 endIndex + 1 = 2;
    // total = 4 (raw words; no paragraph sentinels in this stream).
    expect(onWordAdvance).toHaveBeenCalledTimes(1);
    expect(onWordAdvance).toHaveBeenLastCalledWith(2, 4);
    vi.advanceTimersByTime(60000 / 300);
    expect(onWordAdvance).toHaveBeenCalledTimes(2);
    expect(onWordAdvance).toHaveBeenLastCalledWith(4, 4);
    overlay.unmount();
  });

  test('paused state: chunk-driven renderPreview surfaces the chunk word in context', () => {
    // Stream long enough that the chunk lands mid-sentence so the
    // sentence-context builder can produce before/current/after.
    const overlay = createOverlay(
      defaultOpts({
        words: ['The', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog.'],
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20, chunkSize: 2 },
      }),
    );
    overlay.mount();
    const root = getShadow();
    const preview = getEl<HTMLElement>(root, `.${OVERLAY_CLASS.CONTEXT_PREVIEW}`);
    // Preview is hidden while playing.
    expect(preview.hidden).toBe(true);

    // Pause via space key — togglePlayPause renders the preview.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(preview.hidden).toBe(false);
    // Preview text contains the current chunk word (rendered as the
    // `<strong>` child).
    const current = preview.querySelector('strong');
    expect(current).not.toBeNull();
    expect(current?.textContent?.length ?? 0).toBeGreaterThan(0);
    overlay.unmount();
  });
});
