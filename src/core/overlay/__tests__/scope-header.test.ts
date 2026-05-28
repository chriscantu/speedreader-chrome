import { describe, expect, test, afterEach, vi, beforeEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['hello', 'world'],
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

function makeFortyTwoWords(): string[] {
  return Array.from({ length: 42 }, (_, i) => `w${i}`);
}

describe('createOverlay — scoped header rendering (AC #10, AC #16 ARIA)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('scope undefined (legacy): header element exists with default label; modal uses aria-labelledby', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const header = shadow.querySelector('#sr-scope-header');
    expect(header).toBeTruthy();
    expect(header?.textContent?.trim()).toBe('SpeedReader');

    const modal = shadow.querySelector('.modal');
    expect(modal?.getAttribute('aria-labelledby')).toBe('sr-scope-header');
    expect(modal?.hasAttribute('aria-label')).toBe(false);
    overlay.unmount();
  });

  test('scope="selection": header text matches SELECTION · N words · ~M sec', () => {
    const overlay = createOverlay(
      defaultOpts({
        scope: 'selection',
        selectionWords: makeFortyTwoWords(),
        fullWords: ['a', 'b', 'c'],
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    const header = shadow.querySelector('#sr-scope-header');
    expect(header?.textContent).toMatch(/SELECTION · 42 words · ~8 sec/);
    overlay.unmount();
  });

  test('scope="selection": ← Full article button rendered in footer', () => {
    const overlay = createOverlay(
      defaultOpts({
        scope: 'selection',
        selectionWords: makeFortyTwoWords(),
        fullWords: ['a', 'b', 'c'],
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    const swapBtn = shadow.querySelector('.scope-swap-btn');
    expect(swapBtn).toBeTruthy();
    expect(swapBtn?.tagName).toBe('BUTTON');
    expect(swapBtn?.textContent).toMatch(/Full article/i);
    overlay.unmount();
  });

  test('scope="full" with articleTitle: header text = articleTitle', () => {
    const overlay = createOverlay(
      defaultOpts({
        scope: 'full',
        fullWords: ['a', 'b', 'c'],
        articleTitle: 'How Bees Find Flowers',
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    const header = shadow.querySelector('#sr-scope-header');
    expect(header?.textContent).toBe('How Bees Find Flowers');
    overlay.unmount();
  });

  test('scope="full" without articleTitle: header falls back to "Whole page — N words"', () => {
    const overlay = createOverlay(
      defaultOpts({
        scope: 'full',
        fullWords: makeFortyTwoWords(),
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    const header = shadow.querySelector('#sr-scope-header');
    expect(header?.textContent).toMatch(/Whole page — 42 words/);
    overlay.unmount();
  });

  test('scope="full": no ← Full article button', () => {
    const overlay = createOverlay(
      defaultOpts({
        scope: 'full',
        fullWords: makeFortyTwoWords(),
        articleTitle: 'Title',
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    expect(shadow.querySelector('.scope-swap-btn')).toBeNull();
    overlay.unmount();
  });

  test('engine consumes selectionWords when scope="selection"', () => {
    const seen: string[] = [];
    const factory = vi.fn((opts: { words: string[]; wpm: number }) => {
      seen.push(...opts.words);
      return createRsvpEngine(opts);
    });
    const overlay = createOverlay(
      defaultOpts({
        scope: 'selection',
        selectionWords: ['only', 'the', 'selection'],
        fullWords: ['this', 'should', 'not', 'play'],
        engineFactory: factory,
      }),
    );
    overlay.mount();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['only', 'the', 'selection']);
    overlay.unmount();
  });

  test('engine consumes fullWords when scope="full"', () => {
    const factoryArgs: Array<{ words: string[]; wpm: number }> = [];
    const factory = vi.fn((opts: { words: string[]; wpm: number }) => {
      factoryArgs.push(opts);
      return createRsvpEngine(opts);
    });
    const overlay = createOverlay(
      defaultOpts({
        scope: 'full',
        fullWords: ['full', 'article', 'words'],
        articleTitle: 'Title',
        engineFactory: factory,
      }),
    );
    overlay.mount();
    expect(factoryArgs[0]?.words).toEqual(['full', 'article', 'words']);
    overlay.unmount();
  });

  test('M sec rounds to nearest integer (42 words @ 300 wpm → 8 sec)', () => {
    const overlay = createOverlay(
      defaultOpts({
        scope: 'selection',
        selectionWords: makeFortyTwoWords(),
        fullWords: ['x'],
        initialSettings: { theme: 'system', wpm: 300 },
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    const header = shadow.querySelector('#sr-scope-header');
    expect(header?.textContent).toContain('~8 sec');
    overlay.unmount();
  });

  test('M sec at different wpm (60 words @ 240 wpm → 15 sec)', () => {
    const overlay = createOverlay(
      defaultOpts({
        scope: 'selection',
        selectionWords: Array.from({ length: 60 }, (_, i) => `w${i}`),
        fullWords: ['x'],
        initialSettings: { theme: 'system', wpm: 240 },
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    const header = shadow.querySelector('#sr-scope-header');
    expect(header?.textContent).toContain('~15 sec');
    overlay.unmount();
  });
});
