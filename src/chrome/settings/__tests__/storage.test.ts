import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinonChrome from 'sinon-chrome';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import type { SettingsV3 } from '../../../core/settings/schema';
import { DEBOUNCE_MS } from '../storage';

const KEY = 'speedreader.settings';

interface ChromeStub {
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

let storedRaw: unknown;
type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: chrome.storage.AreaName,
) => void;
let changeListeners: ChangeListener[] = [];

function installChromeStub(): ChromeStub {
  storedRaw = undefined;
  changeListeners = [];
  const stub: ChromeStub = {
    storage: {
      sync: {
        get: vi.fn((key: string) => {
          if (key === KEY) return Promise.resolve({ [KEY]: storedRaw });
          return Promise.resolve({});
        }),
        set: vi.fn((items: Record<string, unknown>) => {
          storedRaw = items[KEY];
          return Promise.resolve();
        }),
      },
      onChanged: {
        addListener: vi.fn((cb: ChangeListener) => {
          changeListeners.push(cb);
        }),
        removeListener: vi.fn((cb: ChangeListener) => {
          changeListeners = changeListeners.filter((l) => l !== cb);
        }),
      },
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  return stub;
}

function emitChange(newValue: unknown, area: chrome.storage.AreaName = 'sync'): void {
  const change = { [KEY]: { newValue, oldValue: undefined } };
  changeListeners.forEach((cb) => cb(change, area));
}

// Touch sinon-chrome import so the dep stays explicit even though we use vi-based mocks
void sinonChrome;

describe('chrome settings storage adapter', () => {
  beforeEach(() => {
    installChromeStub();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loadSettings seeds defaults on first install (storage empty)', async () => {
    const { loadSettings } = await import('../storage');
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    // Write-back occurred to canonicalise.
    expect(storedRaw).toEqual(DEFAULT_SETTINGS);
  });

  it('loadSettings returns valid stored payload as-is', async () => {
    storedRaw = { ...DEFAULT_SETTINGS, wpm: 380 } satisfies SettingsV3;
    const { loadSettings } = await import('../storage');
    const settings = await loadSettings();
    expect(settings.wpm).toBe(380);
  });

  it('loadSettings repairs a corrupt payload to defaults and writes back', async () => {
    storedRaw = 'not-an-object';
    const { loadSettings } = await import('../storage');
    const settings = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(storedRaw).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings coalesces 10 calls within 300ms into one write', async () => {
    storedRaw = { ...DEFAULT_SETTINGS } satisfies SettingsV3;
    const { saveSettings } = await import('../storage');
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;

    const promises: Promise<void>[] = [];
    for (let wpm = 250; wpm < 350; wpm += 10) {
      promises.push(saveSettings({ wpm }));
    }
    // No write yet (debounce pending).
    expect(stub.storage.sync.set).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await Promise.all(promises);

    // Exactly one set call (the trailing-edge write); set may also fire from
    // an internal load() canonicalisation if storedRaw mismatched, so assert
    // the *final* persisted wpm rather than count alone.
    const finalStored = storedRaw as SettingsV3;
    expect(finalStored.wpm).toBe(340);
    expect(stub.storage.sync.set).toHaveBeenCalledTimes(1);
  });

  it('saveSettings preserves the version field', async () => {
    storedRaw = { ...DEFAULT_SETTINGS } satisfies SettingsV3;
    const { saveSettings } = await import('../storage');
    const p = saveSettings({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await p;
    const stored = storedRaw as SettingsV3;
    expect(stored.version).toBe(3);
    expect(stored.theme).toBe('dark');
  });

  it('subscribeSettings invokes listener with parsed payload on sync change', async () => {
    const { subscribeSettings } = await import('../storage');
    const listener = vi.fn();
    const unsubscribe = subscribeSettings(listener);

    const next: SettingsV3 = { ...DEFAULT_SETTINGS, wpm: 420 };
    emitChange(next, 'sync');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(next);

    unsubscribe();
    emitChange(next, 'sync');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribeSettings ignores changes from non-sync areas', async () => {
    const { subscribeSettings } = await import('../storage');
    const listener = vi.fn();
    subscribeSettings(listener);

    emitChange({ ...DEFAULT_SETTINGS, wpm: 300 }, 'local');
    expect(listener).not.toHaveBeenCalled();
  });

  it('subscribeSettings falls back to defaults for corrupt change payload', async () => {
    const { subscribeSettings } = await import('../storage');
    const listener = vi.fn();
    subscribeSettings(listener);

    emitChange('garbage', 'sync');
    expect(listener).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });
});
