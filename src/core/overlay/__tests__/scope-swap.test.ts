import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';

const SELECTION_WORDS = ['Lorem', 'ipsum', 'dolor', 'sit', 'amet'];
const FULL_WORDS = Array.from({ length: 30 }, (_, i) => `full${i}`);

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['legacy'],
    scope: 'selection',
    selectionWords: SELECTION_WORDS,
    fullWords: FULL_WORDS,
    articleTitle: 'How Bees Find Flowers',
    initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
    subscribeSettings: () => () => undefined,
    engineFactory: createRsvpEngine,
    ...overrides,
  };
}

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

function requireSwapBtn(shadow: ShadowRoot): HTMLButtonElement {
  const btn = shadow.querySelector<HTMLButtonElement>('.scope-swap-btn');
  if (!btn) throw new Error('overlay shadow: .scope-swap-btn missing');
  return btn;
}

describe('createOverlay — scope-swap state machine (AC #11)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('clicking ← Full article removes the swap button from the DOM', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const swapBtn = requireSwapBtn(shadow);
    swapBtn.click();
    expect(shadow.querySelector('.scope-swap-btn')).toBeNull();
    overlay.unmount();
  });

  test('clicking ← Full article rewrites the header to the full-article text', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const swapBtn = requireSwapBtn(shadow);
    swapBtn.click();
    const header = shadow.querySelector('#sr-scope-header');
    expect(header?.textContent).toBe('How Bees Find Flowers');
    overlay.unmount();
  });

  test('clicking ← Full article falls back to "Whole page — N words" when no articleTitle', () => {
    const overlay = createOverlay(defaultOpts({ articleTitle: undefined }));
    overlay.mount();
    const shadow = getShadow();
    requireSwapBtn(shadow).click();
    const header = shadow.querySelector('#sr-scope-header');
    expect(header?.textContent).toBe(`Whole page — ${FULL_WORDS.length} words`);
    overlay.unmount();
  });

  test('after swap, engine plays the full-article word stream and is paused', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    requireSwapBtn(shadow).click();

    const playPauseBtn = shadow.querySelector('.play-pause-btn');
    expect(playPauseBtn?.getAttribute('aria-pressed')).toBe('false');
    expect(playPauseBtn?.textContent).toMatch(/▶/);
    expect(playPauseBtn?.getAttribute('aria-label')).toMatch(/play/i);

    // The word region should be displaying the first word of the full stream.
    const wordRegion = shadow.querySelector('.word-region');
    expect(wordRegion?.textContent).toContain(FULL_WORDS[0]);
    overlay.unmount();
  });

  test('after swap, live-region announces "Expanded to full article. Restarting from word 1 of N. Paused."', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    requireSwapBtn(shadow).click();

    const ariaLive = shadow.querySelector('.aria-live');
    expect(ariaLive?.textContent).toBe(
      `Expanded to full article. Restarting from word 1 of ${FULL_WORDS.length}. Paused.`,
    );
    overlay.unmount();
  });

  test('after swap, the play/pause button has focus', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    requireSwapBtn(shadow).click();
    const playPauseBtn = shadow.querySelector('.play-pause-btn');
    expect(shadow.activeElement).toBe(playPauseBtn);
    overlay.unmount();
  });

  test('after swap, pressing Space resumes playback of the full-article stream', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    requireSwapBtn(shadow).click();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const playPauseBtn = shadow.querySelector('.play-pause-btn');
    expect(playPauseBtn?.getAttribute('aria-pressed')).toBe('true');

    // Advance one full word interval; the second full word should now be in
    // the word region, proving we're playing the full stream not the selection.
    vi.advanceTimersByTime(60000 / 300 + 1);
    const wordRegion = shadow.querySelector('.word-region');
    expect(wordRegion?.textContent).toContain(FULL_WORDS[1]);
    overlay.unmount();
  });

  test('swap is idempotent — a second click is a no-op (button already removed)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const swapBtn = requireSwapBtn(shadow);
    swapBtn.click();
    // Re-click on the (now-detached) button must not throw.
    expect(() => swapBtn.click()).not.toThrow();
    expect(shadow.querySelector('.scope-swap-btn')).toBeNull();
    overlay.unmount();
  });

  test('scope="full" mount does not render a swap button — no scope-swap path', () => {
    const overlay = createOverlay(defaultOpts({ scope: 'full', selectionWords: undefined }));
    overlay.mount();
    const shadow = getShadow();
    expect(shadow.querySelector('.scope-swap-btn')).toBeNull();
    overlay.unmount();
  });
});
