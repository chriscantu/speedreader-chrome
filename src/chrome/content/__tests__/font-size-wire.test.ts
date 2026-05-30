import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import { FONT_SIZE_STEP } from '../../../core/settings/bounds';
import { OVERLAY_CLASS } from '../../../core/overlay/constants';

/**
 * Font-size stepper wire test (review H1 / test-gap).
 *
 * The PR description claims "rapid stepper clicks coalesce into one
 * chrome.storage.sync.set within the 300 ms debounce window". The
 * stepper UI is tested in `core/overlay/__tests__/font-size-stepper.test.ts`,
 * and the debounce primitive is tested in
 * `src/chrome/settings/__tests__/storage-debounce.test.ts`, but no test
 * asserts the END-TO-END wire from a DOM click through the
 * `onFontSizeChange` callback into the debounced `saveSettings`.
 *
 * This file closes the gap and includes a mutation-guard test: removing
 * the `saveSettings({ fontSize: next })` call site in `content/index.ts`
 * MUST fail this suite.
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
        // Return a canonical V4 payload so loadSettings() inside the
        // debounce-flush does NOT trigger its own canonicalisation write
        // (see storage.ts flushPendingSave note). That keeps the "exactly
        // one set" assertion clean.
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

function getIncBtn(): HTMLButtonElement {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  const btn = host.shadowRoot.querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.FONT_INC_BTN}`);
  if (!btn) throw new Error('overlay shadow: missing font-inc-btn');
  return btn;
}

async function mountOverlay(getListener: () => Listener): Promise<void> {
  document.body.innerHTML = '<article>The quick brown fox jumps over the lazy dog.</article>';
  await import('../index');
  const listener = getListener();
  const respond = vi.fn();
  listener({ type: 'activate-reader' }, { id: 'test-ext' }, respond);
  expect(respond).toHaveBeenCalledWith({ ok: true });
  // overlay mount awaits loadSettings — drain microtasks/timers so the
  // host element + shadow root exist before we click.
  await vi.runAllTimersAsync();
}

describe('content script font-size wire (review H1 / test-gap)', () => {
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

  test('5 rapid A+ clicks coalesce into a single chrome.storage.sync.set with the final fontSize', async () => {
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);

    // chrome.storage.sync.set may have fired once for canonicalization
    // during loadSettings — snapshot the count so we measure the
    // debounce-driven writes only.
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    const incBtn = getIncBtn();
    // 5 clicks well inside the 300ms debounce window.
    for (let i = 0; i < 5; i++) {
      incBtn.click();
      await vi.advanceTimersByTimeAsync(20);
    }
    // We are at ~100ms; no flush yet.
    expect(mock.storage.sync.set.mock.calls.length).toBe(baselineSetCalls);

    // Cross the 300ms trailing edge — the debounced set fires.
    await vi.advanceTimersByTimeAsync(300);
    // Drain the in-flight flushPendingSave promise chain (loadSettings +
    // set) so the mock observes the final write.
    await vi.runAllTimersAsync();

    const newCalls = mock.storage.sync.set.mock.calls.slice(baselineSetCalls);
    expect(newCalls.length).toBe(1);

    // Final payload should carry fontSize = default(20) + 5*STEP(2) = 30.
    const expectedFontSize = DEFAULT_SETTINGS.fontSize + 5 * FONT_SIZE_STEP;
    const written = newCalls[0]?.[0] as { [k: string]: { fontSize: number } } | undefined;
    expect(written?.[SETTINGS_KEY]?.fontSize).toBe(expectedFontSize);
  });

  test('single A+ click results in exactly one debounced set after 300ms', async () => {
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    getIncBtn().click();
    expect(mock.storage.sync.set.mock.calls.length).toBe(baselineSetCalls);

    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    const newCalls = mock.storage.sync.set.mock.calls.slice(baselineSetCalls);
    expect(newCalls.length).toBe(1);
    const written = newCalls[0]?.[0] as { [k: string]: { fontSize: number } } | undefined;
    expect(written?.[SETTINGS_KEY]?.fontSize).toBe(DEFAULT_SETTINGS.fontSize + FONT_SIZE_STEP);
  });

  test('mutation guard — without onFontSizeChange persisting, no set fires after a click', async () => {
    // Mutation test: this asserts the wire is actually load-bearing.
    // If a contributor reverts `onFontSizeChange: (next) => saveSettings(...)`
    // to a no-op (e.g. `() => undefined`), the first test above would still
    // see `baselineSetCalls === newCalls.length` and pass nothing
    // meaningful. This test directly asserts "click → set fires", so the
    // mutation causes a deterministic failure here.
    const { mock, getListener } = installChromeMock();
    await mountOverlay(getListener);
    const baselineSetCalls = mock.storage.sync.set.mock.calls.length;

    getIncBtn().click();
    await vi.advanceTimersByTimeAsync(300);
    await vi.runAllTimersAsync();

    expect(mock.storage.sync.set.mock.calls.length).toBeGreaterThan(baselineSetCalls);
  });
});
