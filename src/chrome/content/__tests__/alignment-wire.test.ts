/**
 * alignment-wire.test.ts — issue #52 PART A (test-gap HIGH #1)
 *
 * End-to-end wire from `chrome.storage.sync.get` → loadSettings →
 * createOverlay (`initialSettings.alignment` slot) → subscribeSettings
 * push → host `data-alignment` attribute. The unit tests in
 * `core/overlay/__tests__/alignment-wire.test.ts` pin the overlay's
 * local behaviour; this file pins the chrome-glue boundary so a
 * regression that drops `alignment: settings.alignment` from the CS
 * payload or the subscribe wiring lands as a test failure rather
 * than a silent default at the boundary.
 *
 * This is the same defect class as the original "alignment dead since V3"
 * bug — the schema slot existed but no boundary code read it. The unit
 * tests can't detect that the CS doesn't forward — only this boundary
 * test can.
 *
 * Mutation guards:
 *   - Dropping `alignment: settings.alignment` from the initial-mount
 *     payload fails the first test (host attribute would default to
 *     'orp' regardless of stored value).
 *   - Dropping `alignment: s.alignment` from the subscribe payload
 *     fails the second test (the live push from orp → center would
 *     have no effect at the host attribute).
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import type { SettingsV6 } from '../../../core/settings/schema';
import { OVERLAY_ATTR } from '../../../core/overlay/constants';

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

function installChromeMock(stored: SettingsV6): {
  mock: ChromeMock;
  getListener: () => Listener;
  emitStorageChange: (next: SettingsV6) => void;
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
    emitStorageChange: (next: SettingsV6) => {
      for (const l of storageListeners) {
        l({ [SETTINGS_KEY]: { newValue: next, oldValue: stored } }, 'sync');
      }
    },
  };
}

function getHost(): HTMLElement {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement)) {
    throw new Error('overlay host missing');
  }
  return host;
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

describe('content script — alignment wire boundary (#52 PART A)', () => {
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

  test('initialSettings.alignment reflects stored value — host data-alignment="center" on mount', async () => {
    // The overlay forwards initialSettings.alignment to the host
    // data-alignment attribute. With stored alignment='center', a
    // regression that hardcodes alignment:'orp' (or drops the field) at
    // the mount-site payload would leave the host on the default 'orp'
    // and fail this test.
    const { getListener } = installChromeMock({
      ...DEFAULT_SETTINGS,
      alignment: 'center',
    });
    await mountOverlay(getListener);
    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('center');
  });

  test('initialSettings.alignment="orp" wires through (default value also passes the boundary)', async () => {
    const { getListener } = installChromeMock({
      ...DEFAULT_SETTINGS,
      alignment: 'orp',
    });
    await mountOverlay(getListener);
    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('orp');
  });

  test('subscribeSettings push delivers alignment change — live update flips host attribute', async () => {
    // Start at alignment='orp'. Then push alignment='center'; the overlay's
    // subscribe handler MUST receive the new value and flip the host
    // data-alignment attribute. A regression that drops
    // `alignment: s.alignment` from the subscribe payload would leave the
    // attribute on 'orp' and fail this test.
    const { getListener, emitStorageChange } = installChromeMock({
      ...DEFAULT_SETTINGS,
      alignment: 'orp',
    });
    await mountOverlay(getListener);
    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('orp');

    emitStorageChange({ ...DEFAULT_SETTINGS, alignment: 'center' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getHost().getAttribute(OVERLAY_ATTR.ALIGNMENT)).toBe('center');
  });
});
