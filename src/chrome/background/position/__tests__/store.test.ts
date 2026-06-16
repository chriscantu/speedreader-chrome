import { describe, it, expect, vi } from 'vitest';
import { createGuardedPositionStore } from '../store';
import {
  createReadingPositionStore,
  type ReadingPositionStore,
  type StorageAdapter,
} from '../../../../core/storage/reading-position';

function spyAdapter() {
  const map = new Map<string, unknown>();
  const adapter: StorageAdapter = {
    get: vi.fn(async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (map.has(k)) out[k] = map.get(k);
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) map.set(k, v);
    }),
    remove: vi.fn(async (keys: string[]) => {
      for (const k of keys) map.delete(k);
    }),
  };
  return { adapter, map };
}

describe('createGuardedPositionStore — fail-closed when persistence disabled', () => {
  it('does NOT construct the real store and performs ZERO position writes when disabled', async () => {
    const { adapter } = spyAdapter();
    const makeStore = vi.fn(() => createReadingPositionStore({ adapter, now: () => 1000 }));

    const store = createGuardedPositionStore(false, makeStore);

    // The fail-closed branch must NOT build the chrome-backed store at all.
    expect(makeStore).not.toHaveBeenCalled();

    // All mutating ops resolve as no-ops — and crucially touch no adapter.
    await store.write('https://example.com/a', { wordIndex: 5, totalWords: 50 });
    await store.touch('https://example.com/a');
    await store.clear('https://example.com/a');
    await store.clearAll();

    expect(adapter.set).not.toHaveBeenCalled();
    expect(adapter.remove).not.toHaveBeenCalled();
    expect(adapter.get).not.toHaveBeenCalled();

    // Reads degrade to "nothing persisted".
    await expect(store.read('https://example.com/a')).resolves.toBeUndefined();
    await expect(store.list()).resolves.toEqual([]);
  });

  it('delegates to the real store when enabled', async () => {
    const { adapter } = spyAdapter();
    let inner: ReadingPositionStore | undefined;
    const makeStore = vi.fn(() => {
      inner = createReadingPositionStore({ adapter, now: () => 1000 });
      return inner;
    });

    const store = createGuardedPositionStore(true, makeStore);
    expect(makeStore).toHaveBeenCalledTimes(1);

    await store.write('https://example.com/a', { wordIndex: 5, totalWords: 50 });
    expect(adapter.set).toHaveBeenCalled();
    const got = await store.read('https://example.com/a');
    expect(got?.wordIndex).toBe(5);
  });
});
