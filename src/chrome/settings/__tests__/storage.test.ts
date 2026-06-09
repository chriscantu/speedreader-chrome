import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinonChrome from 'sinon-chrome';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import type { SettingsV7 } from '../../../core/settings/schema';
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
    storedRaw = { ...DEFAULT_SETTINGS, wpm: 380 } satisfies SettingsV7;
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
    storedRaw = { ...DEFAULT_SETTINGS } satisfies SettingsV7;
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
    const finalStored = storedRaw as SettingsV7;
    expect(finalStored.wpm).toBe(340);
    expect(stub.storage.sync.set).toHaveBeenCalledTimes(1);
  });

  // #68 — debounce window resolution contract.
  it('saveSettings: 3 calls in one window share resolution, all resolve on one set', async () => {
    storedRaw = { ...DEFAULT_SETTINGS } satisfies SettingsV7;
    const { saveSettings } = await import('../storage');
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;

    const resolved: boolean[] = [false, false, false];
    const p1 = saveSettings({ wpm: 260 }).then(() => {
      resolved[0] = true;
    });
    const p2 = saveSettings({ wpm: 270 }).then(() => {
      resolved[1] = true;
    });
    const p3 = saveSettings({ wpm: 280 }).then(() => {
      resolved[2] = true;
    });

    // No set yet, no resolutions yet.
    expect(stub.storage.sync.set).not.toHaveBeenCalled();
    expect(resolved).toEqual([false, false, false]);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await Promise.all([p1, p2, p3]);

    // All three resolved together, and exactly one set fired.
    expect(resolved).toEqual([true, true, true]);
    expect(stub.storage.sync.set).toHaveBeenCalledTimes(1);
    expect((storedRaw as SettingsV7).wpm).toBe(280);
  });

  // #68 — late call landing during in-flight flush queues for next window.
  it('saveSettings: call landing during in-flight flush queues for next window (distinct resolutions)', async () => {
    storedRaw = { ...DEFAULT_SETTINGS } satisfies SettingsV7;
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;

    // Replace `get` with a controllable Promise so we can park the in-flight
    // flush mid-await and inject a saveSettings call before it completes.
    let releaseFirstGet: (value: { [k: string]: unknown }) => void = () => {};
    const firstGet = new Promise<{ [k: string]: unknown }>((resolve) => {
      releaseFirstGet = resolve;
    });
    let getCallCount = 0;
    stub.storage.sync.get.mockImplementation((key: string) => {
      getCallCount += 1;
      if (getCallCount === 1) return firstGet;
      return Promise.resolve({ [key]: storedRaw });
    });

    const { saveSettings } = await import('../storage');

    // First window.
    const pFirst = saveSettings({ wpm: 260 });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    // Timer fired; flushPendingSave is now awaiting our parked `get`. Pending
    // state has already been cleared at the top of flushPendingSave, so the
    // next saveSettings starts a fresh window.
    await Promise.resolve(); // yield so the timer callback has entered flushPendingSave

    let firstResolved = false;
    let secondResolved = false;
    void pFirst.then(() => {
      firstResolved = true;
    });

    // Second saveSettings lands mid-flight — must NOT join the in-flight flush.
    const pSecond = saveSettings({ wpm: 380 });
    void pSecond.then(() => {
      secondResolved = true;
    });

    // Still parked; no set has fired yet.
    expect(stub.storage.sync.set).not.toHaveBeenCalled();
    expect(firstResolved).toBe(false);
    expect(secondResolved).toBe(false);

    // Release the first get → first flush completes → first set fires.
    releaseFirstGet({ [KEY]: storedRaw });
    await pFirst;
    expect(firstResolved).toBe(true);
    expect(secondResolved).toBe(false);
    expect(stub.storage.sync.set).toHaveBeenCalledTimes(1);

    // Advance the second window's debounce to flush the late call.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await pSecond;
    expect(secondResolved).toBe(true);

    // Two distinct sets — late call did not coalesce into the in-flight write.
    expect(stub.storage.sync.set).toHaveBeenCalledTimes(2);
    expect((storedRaw as SettingsV7).wpm).toBe(380);
  });

  // #68 — flushSettings semantics.
  it('flushSettings resolves immediately when no pending save', async () => {
    storedRaw = { ...DEFAULT_SETTINGS } satisfies SettingsV7;
    const { flushSettings } = await import('../storage');
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;

    await flushSettings();
    expect(stub.storage.sync.set).not.toHaveBeenCalled();
  });

  it('flushSettings cancels debounce timer and forces an immediate flush', async () => {
    storedRaw = { ...DEFAULT_SETTINGS } satisfies SettingsV7;
    const { saveSettings, flushSettings } = await import('../storage');
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;

    let savePromiseResolved = false;
    const p = saveSettings({ wpm: 410 });
    void p.then(() => {
      savePromiseResolved = true;
    });

    // Debounce is pending — no set yet.
    expect(stub.storage.sync.set).not.toHaveBeenCalled();

    // flushSettings before the 300ms timer would fire on its own.
    let flushPromiseResolved = false;
    const flushPromise = flushSettings();
    void flushPromise.then(() => {
      flushPromiseResolved = true;
    });

    // The flush itself awaits chrome.storage.sync.get + .set, which under the
    // default stub resolve in microtasks. Await both and confirm the write
    // landed without the 300ms timer ever firing.
    await flushPromise;
    await p;

    expect(flushPromiseResolved).toBe(true);
    expect(savePromiseResolved).toBe(true);
    expect(stub.storage.sync.set).toHaveBeenCalledTimes(1);
    expect((storedRaw as SettingsV7).wpm).toBe(410);

    // Confirm there is no zombie timer left behind — advancing past 300ms
    // must not produce a second set.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(stub.storage.sync.set).toHaveBeenCalledTimes(1);
  });

  it('flushSettings rejects when the forced flush fails', async () => {
    storedRaw = { ...DEFAULT_SETTINGS } satisfies SettingsV7;
    const { saveSettings, flushSettings } = await import('../storage');
    const stub = (globalThis as unknown as { chrome: ChromeStub }).chrome;
    const setErr = new Error('quota exceeded');
    stub.storage.sync.set.mockImplementationOnce(() => Promise.reject(setErr));

    let saveErr: unknown;
    let flushErr: unknown;
    const pSave = saveSettings({ wpm: 290 }).catch((e: unknown) => {
      saveErr = e;
    });
    const pFlush = flushSettings().catch((e: unknown) => {
      flushErr = e;
    });
    await pFlush;
    await pSave;
    expect(flushErr).toBe(setErr);
    expect(saveErr).toBe(setErr);
  });

  it('saveSettings preserves the version field', async () => {
    storedRaw = { ...DEFAULT_SETTINGS } satisfies SettingsV7;
    const { saveSettings } = await import('../storage');
    const p = saveSettings({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await p;
    const stored = storedRaw as SettingsV7;
    expect(stored.version).toBe(7);
    expect(stored.theme).toBe('dark');
  });

  it('subscribeSettings invokes listener with parsed payload on sync change', async () => {
    const { subscribeSettings } = await import('../storage');
    const listener = vi.fn();
    const unsubscribe = subscribeSettings(listener);

    const next: SettingsV7 = { ...DEFAULT_SETTINGS, wpm: 420 };
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
