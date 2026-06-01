import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import { OVERLAY_CLASS } from '../../../core/overlay/constants';
import { WPM_STEP } from '../../../core/settings/bounds';

/**
 * WPM wire test (ring review #21 / test-gap H1 — stepper-side counterpart
 * to `font-size-wire.test.ts`; #213 swapped the prior slider for a
 * [−] [num] [wpm] [+] stepper).
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
 * Stepper contract: every − / + click commits one discrete WPM_STEP delta
 * to the engine AND fires onWpmChange (the stepper IS the persistence
 * surface, just like the prior slider was). ArrowUp/Down updates engine
 * cadence without persisting (Fix 2 — issue #24 contract preserved).
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

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

function getStepperInc(): HTMLButtonElement {
  const el = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.WPM_STEPPER_INC}`);
  if (!el) throw new Error('overlay shadow: missing wpm-stepper-inc');
  return el;
}

function getStepperNum(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.WPM_STEPPER_NUM}`);
  if (!el) throw new Error('overlay shadow: missing wpm-stepper-num');
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

  test('a single + click writes wpm via debounced chrome.storage.sync.set', async () => {
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    // Capture the readout BEFORE the click so we can assert the delta
    // landed at exactly WPM_STEP (catches an off-by-N regression in
    // the click handler — mutation guard #2 from the dispatch brief).
    const before = Number(getStepperNum().textContent);
    getStepperInc().click();
    expect(Number(getStepperNum().textContent)).toBe(before + WPM_STEP);

    // No flush before the debounce trailing edge.
    expect(mock.storage.sync.set.mock.calls.length).toBe(baselineSetCalls);

    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    const newCalls = mock.storage.sync.set.mock.calls.slice(baselineSetCalls);
    expect(newCalls.length).toBe(1);
    const written = newCalls[0]?.[0] as { [k: string]: { wpm: number } } | undefined;
    expect(written?.[SETTINGS_KEY]).toEqual(expect.objectContaining({ wpm: before + WPM_STEP }));
  });

  test('a single − click writes wpm via debounced chrome.storage.sync.set', async () => {
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    const before = Number(getStepperNum().textContent);
    const dec = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.WPM_STEPPER_DEC}`);
    if (!dec) throw new Error('missing wpm-stepper-dec');
    dec.click();
    expect(Number(getStepperNum().textContent)).toBe(before - WPM_STEP);

    expect(mock.storage.sync.set.mock.calls.length).toBe(baselineSetCalls);
    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    const newCalls = mock.storage.sync.set.mock.calls.slice(baselineSetCalls);
    expect(newCalls.length).toBe(1);
    const written = newCalls[0]?.[0] as { [k: string]: { wpm: number } } | undefined;
    expect(written?.[SETTINGS_KEY]).toEqual(expect.objectContaining({ wpm: before - WPM_STEP }));
  });

  test('multiple stepper clicks within the debounce window collapse to a single set', async () => {
    // The 300 ms saveSettings debounce coalesces rapid clicks — the
    // final written value reflects the last click's WPM, not each
    // intermediate step. This protects chrome.storage.sync's 120
    // writes/min quota the way the prior drag-then-change pattern did.
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    const before = Number(getStepperNum().textContent);
    const inc = getStepperInc();
    inc.click();
    await vi.advanceTimersByTimeAsync(50);
    inc.click();
    await vi.advanceTimersByTimeAsync(50);
    inc.click();

    // Past the debounce window with no further activity → one flush.
    await vi.advanceTimersByTimeAsync(400);
    await vi.runAllTimersAsync();

    const newCalls = mock.storage.sync.set.mock.calls.slice(baselineSetCalls);
    expect(newCalls.length).toBe(1);
    const written = newCalls[0]?.[0] as { [k: string]: { wpm: number } } | undefined;
    expect(written?.[SETTINGS_KEY]).toEqual(
      expect.objectContaining({ wpm: before + 3 * WPM_STEP }),
    );
  });

  test('ArrowUp keyboard shortcut does NOT persist (issue #24 contract preserved through #213)', async () => {
    // ArrowUp/Down updates engine cadence for the session without
    // rewriting the saved default. Any storage.sync.set here would mean
    // the keyboard shortcut silently re-acquired persisting behaviour
    // — the stepper IS the persistence surface, not the keyboard.
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

  test('mutation guard — without onWpmChange persisting, no set fires after a stepper click', async () => {
    // If a contributor reverts the `onWpmChange: (next) => saveSettings(...)`
    // call site in `content/index.ts` to a no-op, this test fails: the
    // baseline-vs-post-commit count stays equal, and the `>` assertion
    // below trips.
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    getStepperInc().click();
    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    expect(mock.storage.sync.set.mock.calls.length).toBeGreaterThan(baselineSetCalls);
  });
});
