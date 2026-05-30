import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import { OVERLAY_CLASS } from '../../../core/overlay/constants';

/**
 * WPM wire test (ring review #21 / test-gap H1 — slider-side counterpart
 * to `font-size-wire.test.ts`).
 *
 * The overlay's `onWpmChange` callback is wired in `content/index.ts` to
 * `saveSettings({ wpm: next })` (debounced 300 ms). Before this file,
 * `onFontSizeChange` had wire coverage but `onWpmChange` had none — a
 * contributor could delete the `saveSettings({ wpm: next })` call site
 * and every other test in the suite would still pass.
 *
 * This file closes the gap. The mutation guard at the bottom is the
 * load-bearing assertion: revert the persist call to `() => undefined`
 * and the suite must go red.
 *
 * Per Fix 1 (ring #21), the SLIDER persists on `change` events only,
 * not `input`. ArrowUp/Down updates engine cadence without persisting
 * (Fix 2). Both behaviors are exercised below.
 */

const SETTINGS_KEY = 'speedreader.settings';

type Listener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void,
) => unknown;

interface ChromeMock {
  runtime: { id: string; onMessage: { addListener: (l: Listener) => void } };
  storage: {
    sync: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
    onChanged: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
}

function installChromeMock(): { mock: ChromeMock; getListener: () => Listener } {
  let capturedListener: Listener | undefined;
  const mock: ChromeMock = {
    runtime: {
      id: 'test-ext',
      onMessage: {
        addListener: (l: Listener) => {
          capturedListener = l;
        },
      },
    },
    storage: {
      sync: {
        // Canonical V4 so loadSettings() inside flushPendingSave does NOT
        // issue its own canonicalisation set — keeps the "exactly one set"
        // count clean.
        get: vi.fn().mockResolvedValue({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS } }),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return {
    mock,
    getListener: () => {
      if (!capturedListener) throw new Error('content script never registered listener');
      return capturedListener;
    },
  };
}

function getSlider(): HTMLInputElement {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  const el = host.shadowRoot.querySelector<HTMLInputElement>(`.${OVERLAY_CLASS.WPM_SLIDER}`);
  if (!el) throw new Error('overlay shadow: missing wpm-slider');
  return el;
}

async function mountOverlay(getListener: () => Listener): Promise<void> {
  document.body.innerHTML = '<article>The quick brown fox jumps over the lazy dog.</article>';
  await import('../index');
  const listener = getListener();
  const respond = vi.fn();
  listener({ type: 'activate-reader' }, { id: 'test-ext' }, respond);
  expect(respond).toHaveBeenCalledWith({ ok: true });
  // Overlay mount awaits loadSettings — drain microtasks/timers so the
  // host element + shadow root exist before we interact.
  await vi.runAllTimersAsync();
}

describe('content script wpm wire (ring #21 / test-gap H1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    document.body.innerHTML = '';
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
    vi.resetModules();
  });

  test('a single slider commit writes wpm via debounced chrome.storage.sync.set', async () => {
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    const slider = getSlider();
    slider.value = '420';
    slider.dispatchEvent(new Event('change', { bubbles: true }));

    // No flush before the debounce trailing edge.
    expect(mock.storage.sync.set.mock.calls.length).toBe(baselineSetCalls);

    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    const newCalls = mock.storage.sync.set.mock.calls.slice(baselineSetCalls);
    expect(newCalls.length).toBe(1);
    const written = newCalls[0]?.[0] as { [k: string]: { wpm: number } } | undefined;
    expect(written?.[SETTINGS_KEY]).toEqual(expect.objectContaining({ wpm: 420 }));
  });

  test('many input ticks during drag write NOTHING; only the final change commits', async () => {
    // Ring #21 BLOCKER: pre-fix code dispatched on `input` which fires
    // ~60×/sec during drag, hammering chrome.storage.sync.set well past
    // the 120 writes/min quota. Post-fix, drag ticks are UI-only.
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    const slider = getSlider();
    for (let v = 310; v <= 500; v += 10) {
      slider.value = String(v);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(5);
    }
    // Past the debounce window, but no `change` yet — zero new writes.
    await vi.advanceTimersByTimeAsync(400);
    await vi.runAllTimersAsync();
    expect(mock.storage.sync.set.mock.calls.length).toBe(baselineSetCalls);

    // Release the drag.
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    const newCalls = mock.storage.sync.set.mock.calls.slice(baselineSetCalls);
    expect(newCalls.length).toBe(1);
    const written = newCalls[0]?.[0] as { [k: string]: { wpm: number } } | undefined;
    expect(written?.[SETTINGS_KEY]).toEqual(expect.objectContaining({ wpm: 500 }));
  });

  test('ArrowUp keyboard shortcut does NOT persist (issue #24 names slider as persistence surface)', async () => {
    // Fix 2 (ring #21): ArrowUp/Down updates engine cadence for the
    // session without rewriting the saved default. Any storage.sync.set
    // here would mean the keyboard shortcut silently re-acquired the
    // persisting behaviour the slider drag fix removed.
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    await vi.advanceTimersByTimeAsync(400);
    await vi.runAllTimersAsync();

    expect(mock.storage.sync.set.mock.calls.length).toBe(baselineSetCalls);
  });

  test('mutation guard — without onWpmChange persisting, no set fires after a slider commit', async () => {
    // If a contributor reverts the `onWpmChange: (next) => saveSettings(...)`
    // call site in `content/index.ts` to a no-op, this test fails: the
    // baseline-vs-post-commit count stays equal, and the `>` assertion
    // below trips.
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    const slider = getSlider();
    slider.value = '410';
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    expect(mock.storage.sync.set.mock.calls.length).toBeGreaterThan(baselineSetCalls);
  });
});
