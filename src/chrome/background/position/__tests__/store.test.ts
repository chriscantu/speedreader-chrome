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
    getAll: vi.fn(async () => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of map.entries()) out[k] = v;
      return out;
    }),
  };
  return { adapter, map };
}

describe('createGuardedPositionStore — fail-closed when persistence disabled', () => {
  it('does NOT construct the real store and performs ZERO position writes when disabled', async () => {
    const { adapter } = spyAdapter();
    const makeStore = vi.fn(() => createReadingPositionStore({ adapter, now: () => 1000 }));

    const store = createGuardedPositionStore(() => false, makeStore);

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

    const store = createGuardedPositionStore(() => true, makeStore);
    // Lazy: the real store is built on first enabled op, not at construction.
    expect(makeStore).not.toHaveBeenCalled();

    await store.write('https://example.com/a', { wordIndex: 5, totalWords: 50 });
    expect(makeStore).toHaveBeenCalledTimes(1);
    expect(adapter.set).toHaveBeenCalled();
    const got = await store.read('https://example.com/a');
    expect(got?.wordIndex).toBe(5);
  });

  // Ring security finding #1 — the live-signal contract: a write dispatched
  // while the gate has NOT yet resolved (signal false) is dropped with zero
  // adapter access; once the gate resolves (signal true) writes land. This is
  // what makes the store fail-closed against a late-resolving / rejecting
  // setAccessLevel instead of writing to an un-gated `local`.
  it('consults the live signal per-op: drops writes while disabled, lands them once enabled', async () => {
    const { adapter } = spyAdapter();
    let enabled = false;
    const makeStore = vi.fn(() => createReadingPositionStore({ adapter, now: () => 1000 }));
    const store = createGuardedPositionStore(() => enabled, makeStore);

    // Disabled window — dropped, no adapter touch, no store construction.
    await store.write('https://example.com/a', { wordIndex: 5, totalWords: 50 });
    expect(makeStore).not.toHaveBeenCalled();
    expect(adapter.set).not.toHaveBeenCalled();
    await expect(store.read('https://example.com/a')).resolves.toBeUndefined();

    // Gate resolves → signal flips → subsequent writes land.
    enabled = true;
    await store.write('https://example.com/a', { wordIndex: 9, totalWords: 90 });
    expect(adapter.set).toHaveBeenCalled();
    const got = await store.read('https://example.com/a');
    expect(got?.wordIndex).toBe(9);
  });
});
