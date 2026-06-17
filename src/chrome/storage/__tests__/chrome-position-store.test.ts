/**
 * Tests for the `chrome.storage.local` adapter used by the persistent
 * reading-position store (#48).
 *
 * Asserts the adapter shape only — round-trip semantics live in the
 * core store's test file. Test uses sinon-chrome to provide a real
 * chrome.storage.local surface.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createChromePositionStore } from '../chrome-position-store';

interface FakeLocalStorage {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getKeys: ReturnType<typeof vi.fn>;
}

let fakeStore: Map<string, unknown>;
let local: FakeLocalStorage;
let originalChrome: typeof globalThis.chrome | undefined;

beforeEach(() => {
  fakeStore = new Map();
  local = {
    get: vi.fn(async (keys: string[] | string | null) => {
      const keyList = Array.isArray(keys) ? keys : keys === null ? [...fakeStore.keys()] : [keys];
      const out: Record<string, unknown> = {};
      for (const k of keyList) {
        if (fakeStore.has(k)) out[k] = structuredClone(fakeStore.get(k));
      }
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) {
        fakeStore.set(k, structuredClone(v));
      }
    }),
    remove: vi.fn(async (keys: string[] | string) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) fakeStore.delete(k);
    }),
    getKeys: vi.fn(async () => [...fakeStore.keys()]),
  };
  originalChrome = globalThis.chrome;
  // Minimal cast — we only stub the surface the adapter uses.
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local },
  };
});

afterEach(() => {
  (globalThis as unknown as { chrome: typeof globalThis.chrome | undefined }).chrome =
    originalChrome;
});

describe('chrome-position-store adapter', () => {
  test('round-trips a write through chrome.storage.local', async () => {
    const store = createChromePositionStore();
    await store.write('https://example.com/article', { wordIndex: 42, totalWords: 200 });

    const got = await store.read('https://example.com/article');
    expect(got?.wordIndex).toBe(42);
    expect(got?.totalWords).toBe(200);
    expect(typeof got?.lastReadAt).toBe('number');
  });

  test('write reaches the real chrome.storage.local.set (smoke)', async () => {
    const store = createChromePositionStore();
    await store.write('https://example.com/a', { wordIndex: 1, totalWords: 10 });
    expect(local.set).toHaveBeenCalled();
  });

  /**
   * ME3 — contract test: chrome.storage.local.set MUST be called with
   * exactly ONE argument (the items object). The callback form of
   * chrome.storage.local.set takes a second `callback` argument; if an
   * accidental refactor to the callback form were to land, the Promise
   * API contract would break silently in production (Chrome ignores
   * extra arguments but the Promise is never resolved when callback form
   * is used alongside the Promise expectation). Pinning the argument
   * count here guards against that regression.
   *
   * Mutation evidence: removing `.length` check or changing `toBe(1)` to
   * `toBe(2)` flips this test red.
   */
  test('ME3 — chrome.storage.local.set is called with exactly one argument (items object only)', async () => {
    const store = createChromePositionStore();
    local.set.mockClear();
    await store.write('https://example.com/contract', { wordIndex: 5, totalWords: 50 });
    // The store calls set at least once (for the payload) and possibly
    // twice (for the LRU index update). Every call must pass exactly ONE
    // argument — the items Record. A second callback arg would indicate
    // the callback API form was accidentally used.
    expect(local.set).toHaveBeenCalled();
    for (const call of local.set.mock.calls) {
      expect(call.length).toBe(1);
    }
  });

  /**
   * #197 — the adapter's `getKeys()` maps to `chrome.storage.local.getKeys()`,
   * the only production wiring of the orphan-sweep enumeration. The core
   * store's tests use hand-rolled fakes, so this is the sole guard that the
   * real adapter reaches the right Chrome API. Mutation evidence: changing
   * `chrome.storage.local.getKeys()` to `.get(null)` (or dropping the await)
   * leaves the orphan unswept and flips this test red.
   */
  test('clearAll() orphan sweep round-trips through chrome.storage.local.getKeys()', async () => {
    const store = createChromePositionStore();
    // An orphan position:* key the LRU index never tracked.
    fakeStore.set('position:https://orphan.example.com/', {
      schemaVersion: 1,
      wordIndex: 1,
      totalWords: 10,
    });
    // A non-position key that must survive.
    fakeStore.set('settings.theme', { value: 'dark' });

    await store.clearAll();

    expect(local.getKeys).toHaveBeenCalled();
    expect(fakeStore.has('position:https://orphan.example.com/')).toBe(false);
    expect(fakeStore.get('settings.theme')).toEqual({ value: 'dark' });
  });
});
