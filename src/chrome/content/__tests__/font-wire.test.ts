/**
 * font-wire.test.ts — issue #28
 *
 * End-to-end wire from `chrome.storage.sync.get` → loadSettings →
 * createOverlay (`initialSettings.font` slot) → subscribeSettings push.
 * The unit tests in `core/overlay/__tests__/font-picker.test.ts` pin the
 * overlay's local behaviour; this file pins the chrome-glue boundary so
 * a regression that drops `font: resolveFontId(...)` from the CS payload
 * or the subscribe wiring lands as a test failure rather than a silent
 * default-to-system at the boundary.
 *
 * Mutation guard: commenting out the `font: resolveFontId(settings)`
 * line at content/index.ts ~126 makes the first test fail. Removing
 * `font: resolveFontId(s)` from the subscribe wiring makes the second
 * test fail. Dropping `resolveFontId` (so the raw `openDyslexic: true`
 * legacy payload no longer promotes) makes the third test fail.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import type { SettingsV4 } from '../../../core/settings/schema';
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

function installChromeMock(stored: SettingsV4): {
  mock: ChromeMock;
  getListener: () => Listener;
  emitStorageChange: (next: SettingsV4) => void;
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
    mock,
    getListener: () => {
      if (!capturedListener) throw new Error('content script never registered listener');
      return capturedListener;
    },
    emitStorageChange: (next: SettingsV4) => {
      for (const l of storageListeners) {
        l({ [SETTINGS_KEY]: { newValue: next, oldValue: stored } }, 'sync');
      }
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

function getModal(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.MODAL}`);
  if (!el) throw new Error('overlay shadow: missing modal');
  return el;
}

async function mountOverlay(getListener: () => Listener): Promise<void> {
  document.body.innerHTML = '<article>The quick brown fox jumps over the lazy dog.</article>';
  await import('../index');
  const listener = getListener();
  const respond = vi.fn();
  listener({ type: 'activate-reader' }, { id: EXT_ID }, respond);
  expect(respond).toHaveBeenCalledWith({ ok: true });
  await vi.runAllTimersAsync();
}

describe('content script — font wire boundary (#28)', () => {
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

  test('initialSettings.font reflects stored picker ID — overlay carries .georgia class', async () => {
    // The overlay applies `.modal.<font-id>` on mount when the resolved
    // FontId is anything other than 'system'. Observing the class on the
    // shadow modal asserts the CS passed `font: 'georgia'` across the
    // core boundary. A regression that drops `font: resolveFontId(...)`
    // would default to 'system', dropping the class — test fails.
    const { getListener } = installChromeMock({
      ...DEFAULT_SETTINGS,
      font: 'georgia',
      openDyslexic: false,
    });
    await mountOverlay(getListener);
    const modal = getModal();
    expect(modal.classList.contains('georgia')).toBe(true);
  });

  test('subscribeSettings push delivers new font ID — modal class swaps live', async () => {
    const { getListener, emitStorageChange } = installChromeMock({
      ...DEFAULT_SETTINGS,
      font: 'georgia',
      openDyslexic: false,
    });
    await mountOverlay(getListener);
    const modal = getModal();
    expect(modal.classList.contains('georgia')).toBe(true);

    emitStorageChange({ ...DEFAULT_SETTINGS, font: 'menlo', openDyslexic: false });
    await vi.runAllTimersAsync();

    expect(modal.classList.contains('menlo')).toBe(true);
    expect(modal.classList.contains('georgia')).toBe(false);
  });

  test('legacy openDyslexic=true with no picker literal lands as font=opendyslexic at the overlay', async () => {
    // Pre-#28 payload: V4 default `font: 'system-ui'` literal alongside
    // the legacy boolean. resolveFontId promotes to 'opendyslexic' at
    // the CS boundary, so the overlay applies `.opendyslexic`.
    const { getListener } = installChromeMock({
      ...DEFAULT_SETTINGS,
      font: 'system-ui',
      openDyslexic: true,
    });
    await mountOverlay(getListener);
    expect(getModal().classList.contains('opendyslexic')).toBe(true);
  });
});
