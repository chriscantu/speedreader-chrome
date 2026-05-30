import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['hello', 'world', 'foo', 'bar'],
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

function getPlayPauseBtn(): HTMLButtonElement {
  const shadow = getShadow();
  const btn = shadow.querySelector<HTMLButtonElement>('.play-pause-btn');
  if (!btn) throw new Error('overlay shadow: missing .play-pause-btn');
  return btn;
}

describe('createOverlay — play/pause control (#22)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('renders a play/pause button inside the modal', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const btn = getPlayPauseBtn();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.type).toBe('button');
    overlay.unmount();
  });

  test('initial state is playing (engine autostarts) → button shows Pause affordance, aria-pressed=true', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const btn = getPlayPauseBtn();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toMatch(/pause/i);
    expect(btn.textContent).toMatch(/⏸/);
    overlay.unmount();
  });

  test('click toggles engine to paused; button flips to Play affordance, aria-pressed=false', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const btn = getPlayPauseBtn();
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toMatch(/play/i);
    expect(btn.textContent).toMatch(/▶/);
    overlay.unmount();
  });

  test('second click resumes; button returns to Pause affordance', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const btn = getPlayPauseBtn();
    btn.click();
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toMatch(/pause/i);
    expect(btn.textContent).toMatch(/⏸/);
    overlay.unmount();
  });

  test('Space key on the document toggles play/pause when overlay is mounted', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const btn = getPlayPauseBtn();
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    overlay.unmount();
  });

  test('Space key prevents page-scroll default while overlay is mounted', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();

    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    overlay.unmount();
  });

  test('Space listener is removed on unmount (no toggle after unmount)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const btn = getPlayPauseBtn();
    const initial = btn.getAttribute('aria-pressed');
    overlay.unmount();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    // Button is no longer in the DOM. Re-mount and confirm state is fresh.
    overlay.mount();
    const btn2 = getPlayPauseBtn();
    expect(btn2.getAttribute('aria-pressed')).toBe(initial);
    overlay.unmount();
  });

  test('engine `done` event disables the button and sets pressed=false', () => {
    const overlay = createOverlay(defaultOpts({ words: ['only'] }));
    overlay.mount();
    // Advance past the single word's display time → engine emits done.
    vi.advanceTimersByTime(60000 / 300 + 1);

    const btn = getPlayPauseBtn();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    overlay.unmount();
  });
});
