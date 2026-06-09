/**
 * scrubber-autohide-wire.test.ts — issue #211 (CS-glue boundary)
 *
 * End-to-end wire from `chrome.storage.sync.get` → loadSettings →
 * createOverlay (`initialSettings.scrubberAutoHide` slot) →
 * subscribeSettings push → overlay scrubber visibility. The unit tests in
 * `core/overlay/__tests__/scrubber-autohide.test.ts` pin the overlay's
 * local gate behaviour; this file pins the chrome-glue boundary so a
 * regression that drops `scrubberAutoHide: settings.scrubberAutoHide` from
 * the CS payload or the subscribe wiring lands as a test failure rather
 * than a silent default at the boundary.
 *
 * Same defect class as the "alignment dead since V3" bug: the schema slot
 * exists but no boundary code reads it. The unit tests can't detect that
 * the CS doesn't forward — only this boundary test can.
 *
 * Mutation guards:
 *   - Dropping `scrubberAutoHide: settings.scrubberAutoHide` from the
 *     initial-mount payload fails the first test (the overlay would default
 *     the gate to true and hide the bar despite stored `false`).
 *   - Dropping `scrubberAutoHide: s.scrubberAutoHide` from the subscribe
 *     payload fails the live-push test (the opt-out flip would have no
 *     effect on the bar).
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import type { SettingsV7 } from '../../../core/settings/schema';
import { OVERLAY_CLASS } from '../../../core/overlay/constants';

const SETTINGS_KEY = 'speedreader.settings';
const EXT_ID = 'test-ext';

type Listener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void,
) => unknown;

type StorageChangedListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string,
) => void;

interface ChromeMock {
  runtime: {
    id: string;
    onMessage: { addListener: (l: Listener) => void };
    getURL: ReturnType<typeof vi.fn>;
  };
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

function installChromeMock(stored: SettingsV7): {
  getListener: () => Listener;
  emitStorageChange: (next: SettingsV7) => void;
} {
  let capturedListener: Listener | undefined;
  const storageListeners: StorageChangedListener[] = [];
  const mock: ChromeMock = {
    runtime: {
      id: EXT_ID,
      onMessage: {
        addListener: (l: Listener) => {
          capturedListener = l;
        },
      },
      getURL: vi.fn((path: string) => `chrome-extension://${EXT_ID}/${path}`),
    },
    storage: {
      sync: {
        get: vi.fn().mockResolvedValue({ [SETTINGS_KEY]: stored }),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn((l: StorageChangedListener) => {
          storageListeners.push(l);
        }),
        removeListener: vi.fn(),
      },
    },
  };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return {
    getListener: () => {
      if (!capturedListener) throw new Error('content script never registered listener');
      return capturedListener;
    },
    emitStorageChange: (next: SettingsV7) => {
      for (const l of storageListeners) {
        l({ [SETTINGS_KEY]: { newValue: next, oldValue: stored } }, 'sync');
      }
    },
  };
}

function isScrubberHidden(): boolean {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  const area = host.shadowRoot.querySelector<HTMLElement>(`.${OVERLAY_CLASS.SCRUBBER_AREA}`);
  if (!area) throw new Error('overlay shadow: missing scrubber-area');
  return area.dataset.hidden === 'true';
}

async function mountOverlay(getListener: () => Listener): Promise<void> {
  document.body.innerHTML = '<article>The quick brown fox jumps over the lazy dog.</article>';
  await import('../index');
  const listener = getListener();
  const respond = vi.fn();
  listener({ type: 'activate-reader' }, { id: EXT_ID }, respond);
  expect(respond).toHaveBeenCalledWith({ ok: true });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('content script — scrubberAutoHide wire boundary (#211)', () => {
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

  test('stored scrubberAutoHide=false → scrubber stays visible on mount (anchor opt-out wired)', async () => {
    // Engine plays on mount. With auto-hide opted out, the bar must NOT
    // hide. A regression that drops scrubberAutoHide from the mount payload
    // defaults the gate to true and hides the bar — failing this test.
    const { getListener } = installChromeMock({
      ...DEFAULT_SETTINGS,
      scrubberAutoHide: false,
    });
    await mountOverlay(getListener);
    expect(isScrubberHidden()).toBe(false);
  });

  test('stored scrubberAutoHide=true → scrubber hides on mount (default behavior also passes the boundary)', async () => {
    const { getListener } = installChromeMock({
      ...DEFAULT_SETTINGS,
      scrubberAutoHide: true,
    });
    await mountOverlay(getListener);
    expect(isScrubberHidden()).toBe(true);
  });

  test('subscribeSettings push delivers scrubberAutoHide change — live flip reveals the bar', async () => {
    // Start auto-hide on (bar hidden during playback). Push the opt-out; the
    // overlay subscribe handler MUST receive it and reveal the bar. Dropping
    // `scrubberAutoHide: s.scrubberAutoHide` from the subscribe payload
    // leaves the bar hidden and fails this test.
    const { getListener, emitStorageChange } = installChromeMock({
      ...DEFAULT_SETTINGS,
      scrubberAutoHide: true,
    });
    await mountOverlay(getListener);
    expect(isScrubberHidden()).toBe(true);

    emitStorageChange({ ...DEFAULT_SETTINGS, scrubberAutoHide: false });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(isScrubberHidden()).toBe(false);
  });
});
