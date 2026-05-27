import { describe, expect, test, vi } from 'vitest';
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

describe('createOverlay — mount', () => {
  test('mount appends a host element with an open shadow root', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const host = document.body.querySelector('[data-speedreader-overlay]');
    expect(host).toBeTruthy();
    expect((host as HTMLElement).shadowRoot).toBeTruthy();
    expect((host as HTMLElement).shadowRoot!.mode).toBe('open');
    overlay.unmount();
  });

  test('mount renders backdrop + modal + word region + close button + aria-live + sentinels', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const root = (document.body.querySelector('[data-speedreader-overlay]') as HTMLElement).shadowRoot!;
    expect(root.querySelector('.backdrop')).toBeTruthy();
    expect(root.querySelector('.modal')).toBeTruthy();
    expect(root.querySelector('.word-region')).toBeTruthy();
    expect(root.querySelector('.close-btn')).toBeTruthy();
    expect(root.querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(root.querySelectorAll('.trap-sentinel')).toHaveLength(2);
    overlay.unmount();
  });
});

describe('createOverlay — engine wiring', () => {
  test('mount starts the engine and renders the first word', async () => {
    vi.useFakeTimers();
    const overlay = createOverlay(defaultOpts({ words: ['quick', 'brown', 'fox'] }));
    overlay.mount();
    vi.advanceTimersByTime(0); // let the engine emit
    const root = (document.body.querySelector('[data-speedreader-overlay]') as HTMLElement).shadowRoot!;
    expect(root.querySelector('.word-region')!.textContent).toBe('quick');
    overlay.unmount();
    vi.useRealTimers();
  });

  test('aria-live region announces each word', () => {
    vi.useFakeTimers();
    const overlay = createOverlay(defaultOpts({ words: ['alpha', 'beta'], initialSettings: { theme: 'system', wpm: 600 } }));
    overlay.mount();
    vi.advanceTimersByTime(0);
    const root = (document.body.querySelector('[data-speedreader-overlay]') as HTMLElement).shadowRoot!;
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe('alpha');
    vi.advanceTimersByTime(100);
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe('beta');
    overlay.unmount();
    vi.useRealTimers();
  });

  test('unmount stops the engine (no further ticks after teardown)', () => {
    vi.useFakeTimers();
    const overlay = createOverlay(defaultOpts({ words: ['a', 'b', 'c'] }));
    overlay.mount();
    overlay.unmount();
    const before = document.body.innerHTML;
    vi.advanceTimersByTime(1000);
    expect(document.body.innerHTML).toBe(before);
    vi.useRealTimers();
  });
});

describe('createOverlay — close path', () => {
  test('Escape key unmounts the overlay', () => {
    const onClose = vi.fn();
    const overlay = createOverlay(defaultOpts({ onClose }));
    overlay.mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.status).toBe('unmounted');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[data-speedreader-overlay]')).toBeNull();
  });

  test('Close button click unmounts the overlay', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const closeBtn = (
      document.body.querySelector('[data-speedreader-overlay]') as HTMLElement
    ).shadowRoot!.querySelector<HTMLButtonElement>('.close-btn')!;
    closeBtn.click();
    expect(overlay.status).toBe('unmounted');
  });
});

describe('createOverlay — settings re-theme', () => {
  test('theme change re-applies tokens without restarting the engine', () => {
    let notify: (s: { theme: 'system' | 'light' | 'dark' | 'sepia' | 'paper' | 'cream' | 'nord'; wpm: number }) => void = () => undefined;
    const overlay = createOverlay(
      defaultOpts({
        subscribeSettings: (listener) => {
          notify = listener;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    const modal = (
      document.body.querySelector('[data-speedreader-overlay]') as HTMLElement
    ).shadowRoot!.querySelector<HTMLElement>('.modal')!;
    const before = modal.style.getPropertyValue('--bg');
    notify({ theme: 'dark', wpm: 300 });
    const after = modal.style.getPropertyValue('--bg');
    expect(after).not.toBe(before);
    expect(after).not.toBe('');
    overlay.unmount();
  });
});

describe('createOverlay — idempotency', () => {
  test('calling mount() twice is a no-op (single host element)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    overlay.mount();
    expect(document.querySelectorAll('[data-speedreader-overlay]')).toHaveLength(1);
    overlay.unmount();
  });

  test('calling unmount() while unmounted is a no-op', () => {
    const overlay = createOverlay(defaultOpts());
    expect(() => overlay.unmount()).not.toThrow();
    expect(overlay.status).toBe('unmounted');
  });
});

describe('createOverlay — document scroll-lock', () => {
  test('mount sets documentElement.style.overflow to hidden', () => {
    document.documentElement.style.overflow = 'auto';
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    expect(document.documentElement.style.overflow).toBe('hidden');
    overlay.unmount();
  });

  test('unmount restores prior overflow value', () => {
    document.documentElement.style.overflow = 'scroll';
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    overlay.unmount();
    expect(document.documentElement.style.overflow).toBe('scroll');
  });

  test('unmount restores empty string when prior overflow was unset', () => {
    document.documentElement.style.overflow = '';
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    overlay.unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });
});
