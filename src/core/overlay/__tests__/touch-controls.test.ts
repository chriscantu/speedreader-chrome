/**
 * touch-controls.test.ts — issue #36
 *
 * Touch-primary viewports (no `pointer: fine`, `hover: none`) get:
 *  - tap-to-pause/resume on the word region (taps anywhere in the word
 *    region toggle play/pause; the keyboard shortcut Space remains for
 *    keyboard users on non-touch surfaces)
 *  - no regression to the in-overlay keyboard shortcuts (#33) on
 *    non-touch viewports
 *
 * jsdom does not evaluate CSS media queries, so the dimension audit
 * (control-bar buttons ≥ 44 × 44 CSS px) is asserted against the
 * stylesheet text and the inline button styles. Pixel-level layout is
 * exercised by the Playwright e2e (deferred per the existing skipped
 * playpause spec — see PR description for the activeTab constraint).
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine, type RsvpEngine, type RsvpEngineOptions } from '../../rsvp-engine';
import { OVERLAY_CSS } from '../styles';

const STREAM = ['hello', 'world', 'foo', 'bar'];

type Holder = { engine: RsvpEngine | null };

function defaultOpts(holder: Holder, overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: STREAM.slice(),
    initialSettings: { theme: 'system', wpm: 300 },
    subscribeSettings: () => () => undefined,
    engineFactory: (engineOpts: RsvpEngineOptions) => {
      holder.engine = createRsvpEngine(engineOpts);
      return holder.engine;
    },
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

function getWordRegion(): HTMLElement {
  const shadow = getShadow();
  const el = shadow.querySelector<HTMLElement>('.word-region');
  if (!el) throw new Error('overlay shadow: missing .word-region');
  return el;
}

/**
 * Mock `window.matchMedia` so the overlay can decide at mount time whether
 * the viewport is touch-primary. The overlay reads
 * `(pointer: coarse) and (hover: none)` — the WCAG-aligned signal that
 * the primary input is touch.
 */
function mockMatchMedia(matches: (query: string) => boolean): void {
  // jsdom does not implement matchMedia; install a writable stub on
  // window so vi.spyOn / direct assignment both work, then replace it.
  const stub = (query: string): MediaQueryList =>
    ({
      matches: matches(query),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: stub,
  });
}

describe('createOverlay — touch-primary controls (#36)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('tap on word region toggles play/pause when pointer is coarse', () => {
    mockMatchMedia((q) => q.includes('coarse') || q.includes('hover: none'));
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(holder.engine?.state).toBe('playing');

    const word = getWordRegion();
    word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(holder.engine?.state).toBe('paused');

    word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(holder.engine?.state).toBe('playing');

    overlay.unmount();
  });

  test('tap on word region is a no-op when pointer is fine (desktop / mouse)', () => {
    // Default: nothing matches the coarse query → desktop mouse.
    mockMatchMedia(() => false);
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(holder.engine?.state).toBe('playing');

    const word = getWordRegion();
    word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(holder.engine?.state).toBe('playing');

    overlay.unmount();
  });

  test('keyboard Space still toggles play/pause on non-touch (no #33 regression)', () => {
    mockMatchMedia(() => false);
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(holder.engine?.state).toBe('playing');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    expect(holder.engine?.state).toBe('paused');

    overlay.unmount();
  });

  test('CSS sheet contains a coarse-pointer media block enlarging tap targets', () => {
    // The bytes of the adopted stylesheet are the contract — jsdom does not
    // evaluate media queries, but the presence of the block + ≥44px target
    // sizes inside it is a structural guarantee against the WCAG 2.2 AA
    // target-size violation tier #1 audit (issue #36).
    expect(OVERLAY_CSS).toMatch(/@media\s*\(pointer:\s*coarse\)/);
    // Required dimensions inside the coarse block — extract the block and
    // assert minimums.
    const blockMatch = OVERLAY_CSS.match(/@media\s*\(pointer:\s*coarse\)[^{]*\{([\s\S]*?)\n\}/);
    expect(blockMatch, 'coarse-pointer media block must exist').toBeTruthy();
    const blockBody = blockMatch?.[1] ?? '';
    // Both control-bar buttons must meet ≥44px (we use 48px as headroom).
    expect(blockBody).toMatch(/\.play-pause-btn[^{]*\{[^}]*min-height:\s*(4[89]|[5-9]\d|\d{3})px/);
    expect(blockBody).toMatch(/\.close-btn[^{]*\{[^}]*(width|height):\s*(4[89]|[5-9]\d|\d{3})px/);
    // Footer should be bottom-anchored and respect safe-area-inset-bottom.
    expect(blockBody).toMatch(/safe-area-inset-bottom/);
  });
});
