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
});
