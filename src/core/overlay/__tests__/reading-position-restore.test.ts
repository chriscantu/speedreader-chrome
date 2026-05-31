/**
 * Tests for the reading-position resume toast + word-advance callback (#48).
 *
 * Anti-tautology stance:
 *   - Toast assertion matches by accessible role (`status`) + the text
 *     content, not by raw class names — a CSS rename must not false-pass.
 *   - Mount-with-saved-position test asserts the OBSERVED first word
 *     rendered, not "engine.seekTo was called".
 *   - The dismiss-after-5s assertion uses fake timers AND asserts the
 *     toast region is hidden AFTER, not just that a timeout was scheduled.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine, type RsvpEngine, type RsvpEngineOptions } from '../../rsvp-engine';

const STREAM = [
  'Alpha.',
  'Beta',
  'gamma',
  'delta.',
  'Epsilon',
  'zeta',
  'eta.',
  'Theta',
  'iota',
  'kappa.',
];

type Holder = { engine: RsvpEngine | null };

function defaultOpts(holder: Holder, overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: STREAM.slice(),
    scope: 'full',
    fullWords: STREAM.slice(),
    selectionWords: [],
    initialSettings: { theme: 'system', wpm: 600, fontSize: 20 },
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

function getWordText(): string {
  return getShadow().querySelector('.word-region')?.textContent ?? '';
}

function getToast(): HTMLElement | null {
  // role="status" is the WCAG-aligned non-blocking polite announcement.
  // Querying by role + name keeps the test resilient to CSS renames.
  return getShadow().querySelector('[role="status"][data-sr-resume-toast]');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
});

describe('overlay — reading-position restore toast (#48)', () => {
  test('mount with a saved position shows the toast AND resumes at that word', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialIndex: 4,
        resumeToast: { totalWords: STREAM.length },
      }),
    );
    overlay.mount();

    // OBSERVED behavior: the first word rendered is the resume word
    // (STREAM[3] — engine emits words[resume-1] on start after seekTo(resume)).
    // Per overlay.ts comment: seekTo(N) is silent then start() emits words[N].
    // Indexing here is 1-based progress; initialIndex=4 means resume at 4 words
    // already consumed → next emission is STREAM[4] = 'Epsilon'. We assert on
    // OBSERVED text rather than internal state.
    expect(getWordText()).toBe('Epsilon');

    const toast = getToast();
    expect(toast).not.toBeNull();
    // Visible text describes the resume position.
    expect(toast?.textContent).toContain('4');
    expect(toast?.textContent).toContain(String(STREAM.length));
  });

  test('mount without a saved position (no initialIndex) does NOT render the toast', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        // No initialIndex; resumeToast also omitted because the caller
        // only sends it when there's a real resume.
      }),
    );
    overlay.mount();
    expect(getWordText()).toBe('Alpha.');
    expect(getToast()).toBeNull();
  });

  test('mount with resumeToast but no real resume (initialIndex=0) does NOT render the toast', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialIndex: 0,
        resumeToast: { totalWords: STREAM.length },
      }),
    );
    overlay.mount();
    // No resume occurred → toast must not appear.
    expect(getToast()).toBeNull();
  });

  test('mount with initialIndex >= total silently starts at 0 with no toast', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        // Out-of-bounds resume target — overlay's existing guard ignores
        // it; the toast wire here must respect the same guard.
        initialIndex: STREAM.length + 5,
        resumeToast: { totalWords: STREAM.length },
      }),
    );
    overlay.mount();
    expect(getWordText()).toBe('Alpha.');
    expect(getToast()).toBeNull();
  });

  test('Start over link resets to word 0 and invokes onStartOver', () => {
    const holder: Holder = { engine: null };
    const onStartOver = vi.fn();
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialIndex: 4,
        resumeToast: { totalWords: STREAM.length, onStartOver },
      }),
    );
    overlay.mount();
    expect(getWordText()).toBe('Epsilon');

    const startOverBtn = getShadow().querySelector('[data-sr-resume-toast] [data-sr-start-over]');
    if (!(startOverBtn instanceof HTMLButtonElement)) {
      throw new Error('start-over button not found');
    }
    startOverBtn.click();

    // OBSERVED: word region now shows the first word of the stream.
    expect(getWordText()).toBe('Alpha.');
    // Toast is dismissed on click.
    expect(getToast()).toBeNull();
    // Callback fired so the host can clear the persisted position.
    expect(onStartOver).toHaveBeenCalledTimes(1);
  });

  test('toast auto-dismisses after 5 seconds', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialIndex: 4,
        resumeToast: { totalWords: STREAM.length },
      }),
    );
    overlay.mount();
    expect(getToast()).not.toBeNull();

    vi.advanceTimersByTime(4_999);
    expect(getToast()).not.toBeNull();

    vi.advanceTimersByTime(2);
    expect(getToast()).toBeNull();
  });
});

describe('overlay — onWordAdvance callback (#48)', () => {
  test('fires for each word event with the engine progress index', () => {
    const holder: Holder = { engine: null };
    const advances: Array<{ index: number; total: number }> = [];
    const overlay = createOverlay(
      defaultOpts(holder, {
        onWordAdvance: (index, total) => {
          advances.push({ index, total });
        },
      }),
    );
    overlay.mount();

    // start() emits word[0] synchronously → one advance recorded with
    // index === 1 (progress is 1-based count of emitted words).
    expect(advances.length).toBeGreaterThanOrEqual(1);
    expect(advances[0].index).toBe(1);
    expect(advances[0].total).toBe(STREAM.length);

    // Advance the engine three more ticks at 600 wpm = 100 ms per word.
    vi.advanceTimersByTime(400);
    expect(advances.length).toBeGreaterThanOrEqual(4);
    expect(advances[advances.length - 1].index).toBe(advances.length);
  });

  test('fires once on the resume word when initialIndex seeks the engine', () => {
    const holder: Holder = { engine: null };
    const advances: Array<{ index: number; total: number }> = [];
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialIndex: 4,
        onWordAdvance: (index, total) => {
          advances.push({ index, total });
        },
      }),
    );
    overlay.mount();
    // After seekTo(4) + start(), the first word emitted is words[4] and
    // progress.index === 5. Per the close-snapshot test conventions in
    // this directory.
    expect(advances[0].index).toBe(5);
    expect(advances[0].total).toBe(STREAM.length);
  });

  test('not fired when overlay mounts without the callback (no observable behaviour change)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    // No onWordAdvance — should not throw, should not affect rendering.
    overlay.mount();
    expect(getWordText()).toBe('Alpha.');
  });
});
