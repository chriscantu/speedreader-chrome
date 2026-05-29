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

function engineOf(holder: Holder): RsvpEngine {
  if (!holder.engine) throw new Error('engine not yet created');
  return holder.engine;
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
 *
 * Returns the list of queries the overlay actually asked about so tests
 * can assert the EXACT query string (not just a substring) — guards
 * against a production regression to `(pointer: coarse)` alone, which
 * would re-introduce the hybrid-laptop false positive.
 */
function mockMatchMedia(matches: (query: string) => boolean): { queries: string[] } {
  const queries: string[] = [];
  // jsdom does not implement matchMedia; install a writable stub on
  // window so vi.spyOn / direct assignment both work, then replace it.
  const stub = (query: string): MediaQueryList => {
    queries.push(query);
    return {
      matches: matches(query),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList;
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: stub,
  });
  return { queries };
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
    // Match by EXACT query string — guards against a production regression
    // to `(pointer: coarse)` alone (would re-introduce hybrid-laptop false
    // positives where the touchscreen reports coarse but a precise mouse
    // is also attached).
    const captured = mockMatchMedia((q) => q === '(pointer: coarse) and (hover: none)');
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(holder.engine?.state).toBe('playing');

    const word = getWordRegion();
    word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(holder.engine?.state).toBe('paused');

    word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(holder.engine?.state).toBe('playing');

    // Lock the contract: the overlay must ask for the combined coarse+no-hover
    // signal, not either condition alone.
    expect(captured.queries).toContain('(pointer: coarse) and (hover: none)');

    overlay.unmount();
  });

  test('tap-to-pause uses the exact (pointer: coarse) and (hover: none) query', () => {
    // Independent assertion: even on non-touch viewports the overlay must
    // call matchMedia with the precise compound query. Guards against the
    // theme-resolver's own matchMedia calls masking a regression in the
    // touch-primary query string.
    const captured = mockMatchMedia(() => false);
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();

    const word = getWordRegion();
    // Trigger the predicate at least once.
    word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(captured.queries).toContain('(pointer: coarse) and (hover: none)');
    // Negative: the loose `(pointer: coarse)` alone must NOT be what we
    // asked. If a future refactor splits the query, this assertion fails.
    expect(captured.queries).not.toContain('(pointer: coarse)');

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

  test('Arrow keys + Escape still work on non-touch (no #33 regression)', () => {
    // #33 (commit 9771a68) handler surface = Space, Escape, ArrowLeft/Right
    // (seekToSentence prev/next), ArrowUp/Down (WPM ±10). Space is covered
    // above; this test locks the remaining keys.
    mockMatchMedia(() => false);
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    // Pause first so the engine is in a deterministic state and we can spy
    // on seekToSentence before the arrow dispatch.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    expect(holder.engine?.state).toBe('paused');

    const engine = engineOf(holder);
    const seekSpy = vi.spyOn(engine, 'seekToSentence');
    const setWpmSpy = vi.spyOn(engine, 'setWpm');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(seekSpy).toHaveBeenCalledWith('next');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(seekSpy).toHaveBeenCalledWith('prev');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    // ArrowUp +10, ArrowDown -10 from initial 300.
    expect(setWpmSpy).toHaveBeenCalledWith(310);
    expect(setWpmSpy).toHaveBeenCalledWith(300);

    // Escape closes the overlay (host removed from DOM).
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    expect(document.body.querySelector('[data-speedreader-overlay]')).toBeNull();
  });

  test('keyboard shortcuts still work on touch-primary viewports (attached-keyboard coexistence)', () => {
    // Touch laptops report (pointer: coarse) AND (hover: none) but may
    // also have an attached keyboard. The tap-to-pause click listener
    // must not stop-propagation kill the capture-phase keydown handler.
    mockMatchMedia((q) => q === '(pointer: coarse) and (hover: none)');
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(holder.engine?.state).toBe('playing');

    // Space on the overlay surface still toggles even when touch-primary
    // is active.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    expect(holder.engine?.state).toBe('paused');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    expect(holder.engine?.state).toBe('playing');

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
