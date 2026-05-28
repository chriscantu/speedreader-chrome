import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';

const FULL_WORDS = ['the', 'full', 'article', 'tokens'];
const EMPTY_SELECTION_TEXT = 'No selection detected. Reading full article instead.';

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['legacy'],
    scope: 'selection',
    selectionWords: [],
    fullWords: FULL_WORDS,
    articleTitle: 'Bees',
    initialSettings: { theme: 'system', wpm: 300 },
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

describe('createOverlay — empty-selection fallback (AC #15)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('scope="selection" with empty selectionWords renders no ← Full article button', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    expect(shadow.querySelector('.scope-swap-btn')).toBeNull();
    overlay.unmount();
  });

  test('header renders the full-article text, not the SELECTION pattern', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const header = shadow.querySelector('#sr-scope-header');
    expect(header?.textContent).toBe('Bees');
    expect(header?.textContent).not.toMatch(/SELECTION/);
    overlay.unmount();
  });

  test('a visible .scope-subtitle node renders with the fallback text', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const subtitle = shadow.querySelector('.scope-subtitle');
    expect(subtitle).toBeTruthy();
    expect(subtitle?.textContent).toBe(EMPTY_SELECTION_TEXT);
    overlay.unmount();
  });

  test('aria-live region surfaces the fallback announcement on mount', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const ariaLive = shadow.querySelector('.aria-live');
    expect(ariaLive?.textContent).toBe(EMPTY_SELECTION_TEXT);
    overlay.unmount();
  });

  test('engine plays the full-article word stream', () => {
    const seen: Array<{ words: string[] }> = [];
    const factory = vi.fn((opts: { words: string[]; wpm: number }) => {
      seen.push({ words: opts.words });
      return createRsvpEngine(opts);
    });
    const overlay = createOverlay(defaultOpts({ engineFactory: factory }));
    overlay.mount();
    expect(seen[0]?.words).toEqual(FULL_WORDS);
    overlay.unmount();
  });

  test('scope="selection" with non-empty selectionWords does NOT render a subtitle (normal scoped mode)', () => {
    const overlay = createOverlay(
      defaultOpts({ selectionWords: ['hello', 'world'] }),
    );
    overlay.mount();
    const shadow = getShadow();
    expect(shadow.querySelector('.scope-subtitle')).toBeNull();
    overlay.unmount();
  });

  test('scope="full" on mount renders no subtitle (no fallback occurred)', () => {
    const overlay = createOverlay(
      defaultOpts({ scope: 'full', selectionWords: undefined }),
    );
    overlay.mount();
    const shadow = getShadow();
    expect(shadow.querySelector('.scope-subtitle')).toBeNull();
    overlay.unmount();
  });
});
