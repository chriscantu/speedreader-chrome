import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['a', 'b', 'c'],
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

describe('createOverlay — mount focus management (AC #16)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
    document.body.querySelectorAll('[data-test-trigger]').forEach((n) => n.remove());
  });

  test('initial focus lands on the play/pause button on legacy mount', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const playPauseBtn = shadow.querySelector('.play-pause-btn');
    expect(shadow.activeElement).toBe(playPauseBtn);
    overlay.unmount();
  });

  test('initial focus lands on the play/pause button on scope="selection" mount', () => {
    const overlay = createOverlay(
      defaultOpts({
        scope: 'selection',
        selectionWords: ['hello', 'world'],
        fullWords: ['a', 'b'],
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    const playPauseBtn = shadow.querySelector('.play-pause-btn');
    expect(shadow.activeElement).toBe(playPauseBtn);
    overlay.unmount();
  });

  test('initial focus lands on the play/pause button on scope="full" mount', () => {
    const overlay = createOverlay(
      defaultOpts({
        scope: 'full',
        fullWords: ['a', 'b'],
        articleTitle: 'Title',
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    const playPauseBtn = shadow.querySelector('.play-pause-btn');
    expect(shadow.activeElement).toBe(playPauseBtn);
    overlay.unmount();
  });

  test('on unmount, focus is restored to the element active before mount', () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('data-test-trigger', '');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    overlay.unmount();

    expect(document.activeElement).toBe(trigger);
  });
});
