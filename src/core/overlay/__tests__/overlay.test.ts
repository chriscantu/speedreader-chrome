import { describe, expect, test } from 'vitest';
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
