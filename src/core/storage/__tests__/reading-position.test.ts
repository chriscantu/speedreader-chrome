/**
 * Tests for the platform-agnostic reading-position store (#48).
 *
 * The store is constructed around a `StorageAdapter` so the test can
 * run against an in-memory fake. The real `chrome.storage.local` glue
 * lives in `src/chrome/storage/chrome-position-store.ts` and is
 * exercised separately.
 *
 * Anti-tautology stance:
 *   - LRU eviction is verified by adding 101 entries and asserting the
 *     FIRST inserted URL is the one evicted AND that the 100 most-recent
 *     remain — not by asserting `list().length === 100`.
 *   - Restore behavior asserts the OBSERVED stored value, not
 *     "adapter.get was called".
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  POSITION_LRU_MAX,
  POSITION_SCHEMA_VERSION,
  positionKey,
  createReadingPositionStore,
  type ReadingPositionStore,
  type StorageAdapter,
} from '../reading-position';

// TD2 — POSITION_INDEX_KEY is module-private; tests that inspect raw
// storage must use the literal string instead of the exported constant.
const POSITION_INDEX_KEY = 'position-index';

/**
 * In-memory storage adapter. Uses a plain `Map<string, unknown>` and
 * structuredClone on read/write to match `chrome.storage.local`'s
 * serialization contract (no shared references between caller state
 * and persisted state).
 */
function createMemoryAdapter(): StorageAdapter & { snapshot(): Record<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    async get(keys) {
      const out: Record<string, unknown> = {};
      for (const k of keys) {
        if (map.has(k)) out[k] = structuredClone(map.get(k));
      }
      return out;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) {
        map.set(k, structuredClone(v));
      }
    },
    async remove(keys) {
      for (const k of keys) {
        map.delete(k);
      }
    },
    async getAll() {
      const out: Record<string, unknown> = {};
      for (const [k, v] of map.entries()) out[k] = structuredClone(v);
      return out;
    },
    snapshot() {
      return Object.fromEntries(map.entries());
    },
  };
}

let adapter: ReturnType<typeof createMemoryAdapter>;
let store: ReadingPositionStore;
let now: number;

/**
 * Test helper: every URL these tests pass in is a valid https URL, so
 * `positionKey` always returns a string. Throwing on null surfaces a
 * test-data typo instead of letting the assertion downstream blow up
 * with a confusing message.
 */
function keyOf(url: string): string {
  const k = positionKey(url);
  if (k === null) throw new Error(`test setup error — positionKey null for ${url}`);
  return k;
}

beforeEach(() => {
  adapter = createMemoryAdapter();
  now = 1_700_000_000_000;
  store = createReadingPositionStore({
    adapter,
    now: () => now,
  });
});

afterEach(() => {
  // Nothing — fresh adapter per test.
});

describe('reading-position store — write + read round-trip', () => {
  test('write persists wordIndex, totalWords, lastReadAt under the canonical key', async () => {
    await store.write('https://example.com/a', { wordIndex: 42, totalWords: 200 });
    const got = await store.read('https://example.com/a');
    expect(got).toEqual({
      wordIndex: 42,
      totalWords: 200,
      lastReadAt: now,
    });
  });

  test('read returns undefined when no entry exists for the URL', async () => {
    expect(await store.read('https://example.com/never-visited')).toBeUndefined();
  });

  test('write overwrites a previous entry for the same URL', async () => {
    await store.write('https://example.com/a', { wordIndex: 10, totalWords: 100 });
    now += 5_000;
    await store.write('https://example.com/a', { wordIndex: 55, totalWords: 100 });
    expect(await store.read('https://example.com/a')).toEqual({
      wordIndex: 55,
      totalWords: 100,
      lastReadAt: now,
    });
  });

  test('persists a schema version on the stored payload (forward-compat)', async () => {
    await store.write('https://example.com/a', { wordIndex: 1, totalWords: 2 });
    const raw = adapter.snapshot()[keyOf('https://example.com/a')] as {
      schemaVersion: number;
    };
    expect(raw.schemaVersion).toBe(POSITION_SCHEMA_VERSION);
  });

  test('write rejects negative or non-integer wordIndex (defensive — caller must clamp)', async () => {
    await expect(
      store.write('https://example.com/a', { wordIndex: -1, totalWords: 10 }),
    ).rejects.toThrow();
    await expect(
      store.write('https://example.com/a', { wordIndex: 1.5, totalWords: 10 }),
    ).rejects.toThrow();
    await expect(
      store.write('https://example.com/a', { wordIndex: 0, totalWords: 0 }),
    ).rejects.toThrow();
  });
});

describe('reading-position store — LRU eviction at cap', () => {
  test('keeps at most POSITION_LRU_MAX entries; drops the oldest first', async () => {
    // Add POSITION_LRU_MAX + 1 distinct URLs with monotonically-increasing
    // timestamps so insertion order === LRU order.
    const overflow = POSITION_LRU_MAX + 1;
    for (let i = 0; i < overflow; i++) {
      now = 1_700_000_000_000 + i;
      await store.write(`https://example.com/article-${i}`, {
        wordIndex: i + 1,
        totalWords: 1000,
      });
    }

    // The FIRST-inserted URL must be gone.
    expect(await store.read('https://example.com/article-0')).toBeUndefined();

    // EVERY one of the remaining 100 must still be readable with the
    // exact wordIndex we wrote. Asserting just `list().length === 100`
    // would let a bug where the wrong entry was evicted slip through.
    for (let i = 1; i < overflow; i++) {
      const got = await store.read(`https://example.com/article-${i}`);
      expect(got, `expected article-${i} to survive eviction`).toBeDefined();
      expect(got?.wordIndex).toBe(i + 1);
    }

    // Index must also reflect the eviction.
    const index = (await adapter.get([POSITION_INDEX_KEY]))[POSITION_INDEX_KEY] as string[];
    expect(index).toHaveLength(POSITION_LRU_MAX);
    expect(index).not.toContain(keyOf('https://example.com/article-0'));
  });

  test('overwriting an existing URL does NOT count as a new LRU slot', async () => {
    for (let i = 0; i < POSITION_LRU_MAX; i++) {
      now = 1_700_000_000_000 + i;
      // totalWords must strictly exceed every wordIndex written below;
      // we cap at POSITION_LRU_MAX (=100) so use 1000 to stay clear.
      await store.write(`https://example.com/a-${i}`, { wordIndex: i + 1, totalWords: 1000 });
    }
    // Overwrite the FIRST entry — should NOT evict a-1 (and a-0 should
    // remain present, just moved to the most-recent slot).
    now = 1_700_000_001_000;
    await store.write('https://example.com/a-0', { wordIndex: 99, totalWords: 1000 });

    expect(await store.read('https://example.com/a-0')).toEqual({
      wordIndex: 99,
      totalWords: 1000,
      lastReadAt: now,
    });
    // a-1 must still be present (NOT evicted by the overwrite).
    expect(await store.read('https://example.com/a-1')).toBeDefined();
  });
});

describe('reading-position store — touch reorders LRU without changing position', () => {
  test('touch moves a URL to the most-recent slot and updates lastReadAt', async () => {
    await store.write('https://example.com/old', { wordIndex: 1, totalWords: 10 });
    await store.write('https://example.com/mid', { wordIndex: 2, totalWords: 10 });
    await store.write('https://example.com/new', { wordIndex: 3, totalWords: 10 });

    now += 10_000;
    await store.touch('https://example.com/old');

    const index = (await adapter.get([POSITION_INDEX_KEY]))[POSITION_INDEX_KEY] as string[];
    // The touched URL should be at the END of the index (most-recent).
    expect(index[index.length - 1]).toBe(keyOf('https://example.com/old'));
    // Position data unchanged — only lastReadAt moves.
    const got = await store.read('https://example.com/old');
    expect(got).toEqual({ wordIndex: 1, totalWords: 10, lastReadAt: now });
  });

  test('touch on an unknown URL is a no-op (no entry created)', async () => {
    await store.touch('https://example.com/never');
    expect(await store.read('https://example.com/never')).toBeUndefined();
    const index = (await adapter.get([POSITION_INDEX_KEY]))[POSITION_INDEX_KEY] as
      | string[]
      | undefined;
    // Either no index yet, or an empty one — both acceptable.
    expect(index === undefined || index.length === 0).toBe(true);
  });

  test('touching the oldest entry protects it from the NEXT eviction', async () => {
    for (let i = 0; i < POSITION_LRU_MAX; i++) {
      now = 1_700_000_000_000 + i;
      await store.write(`https://example.com/x-${i}`, { wordIndex: i + 1, totalWords: 1000 });
    }
    // Touch x-0 — now x-1 is the oldest.
    now = 1_700_000_002_000;
    await store.touch('https://example.com/x-0');

    // Adding a NEW entry should evict x-1, not x-0.
    now = 1_700_000_003_000;
    await store.write('https://example.com/new', { wordIndex: 1, totalWords: 100 });

    expect(await store.read('https://example.com/x-0')).toBeDefined();
    expect(await store.read('https://example.com/x-1')).toBeUndefined();
  });
});

describe('reading-position store — clear', () => {
  test('clear removes the entry and drops it from the index', async () => {
    await store.write('https://example.com/a', { wordIndex: 5, totalWords: 50 });
    await store.clear('https://example.com/a');
    expect(await store.read('https://example.com/a')).toBeUndefined();
    const index = (await adapter.get([POSITION_INDEX_KEY]))[POSITION_INDEX_KEY] as
      | string[]
      | undefined;
    expect(index === undefined || index.length === 0).toBe(true);
  });

  test('clear on an unknown URL is a silent no-op', async () => {
    await expect(store.clear('https://example.com/never')).resolves.toBeUndefined();
  });
});

describe('reading-position store — canonicalization is applied on every API', () => {
  test('read with a non-canonical URL matches a previous canonical write', async () => {
    await store.write('https://example.com/post', { wordIndex: 12, totalWords: 100 });
    // Read using a URL that canonicalizes to the same key.
    const got = await store.read('https://EXAMPLE.com/post?utm_source=twitter#section');
    expect(got?.wordIndex).toBe(12);
  });

  test('write with a non-canonical URL is keyed against the canonical form', async () => {
    await store.write('https://EXAMPLE.com/post?utm_source=fb#x', {
      wordIndex: 7,
      totalWords: 50,
    });
    expect(await store.read('https://example.com/post')).toEqual({
      wordIndex: 7,
      totalWords: 50,
      lastReadAt: now,
    });
  });
});

describe('reading-position store — schema version guard', () => {
  test('reads with a future schemaVersion are ignored (forward-incompat payload)', async () => {
    const key = keyOf('https://example.com/a');
    await adapter.set({
      [key]: {
        schemaVersion: POSITION_SCHEMA_VERSION + 1,
        wordIndex: 12,
        totalWords: 100,
        lastReadAt: now,
      },
      [POSITION_INDEX_KEY]: [key],
    });
    expect(await store.read('https://example.com/a')).toBeUndefined();
  });

  test('reads of malformed payloads silently return undefined (not throw)', async () => {
    const key = keyOf('https://example.com/a');
    await adapter.set({
      [key]: { totally: 'wrong shape' },
      [POSITION_INDEX_KEY]: [key],
    });
    expect(await store.read('https://example.com/a')).toBeUndefined();
  });

  test('write does NOT clobber a stored record carrying a higher schemaVersion (downgrade preserve)', async () => {
    // Pre-populate with a v2 (future) record. Index points at it.
    const key = keyOf('https://example.com/future');
    const futureRecord = {
      schemaVersion: POSITION_SCHEMA_VERSION + 1,
      wordIndex: 999,
      totalWords: 1234,
      lastReadAt: now,
      // A field a hypothetical v2 might add — preserved as-is.
      futureExtraField: 'newer-build-data',
    };
    await adapter.set({
      [key]: futureRecord,
      [POSITION_INDEX_KEY]: [key],
    });

    // A v1 (downgrade) build tries to write the same URL — must be a
    // silent no-op so the newer record survives.
    await store.write('https://example.com/future', { wordIndex: 7, totalWords: 50 });

    const snap = adapter.snapshot();
    expect(snap[key]).toEqual(futureRecord);
    // Index must not be modified — no LRU promotion for an aborted write.
    expect(snap[POSITION_INDEX_KEY]).toEqual([key]);
  });

  test('touch does NOT clobber a stored record carrying a higher schemaVersion', async () => {
    const key = keyOf('https://example.com/future');
    const futureRecord = {
      schemaVersion: POSITION_SCHEMA_VERSION + 1,
      wordIndex: 5,
      totalWords: 10,
      lastReadAt: now,
    };
    await adapter.set({
      [key]: futureRecord,
      [POSITION_INDEX_KEY]: [key],
    });

    await store.touch('https://example.com/future');
    expect(adapter.snapshot()[key]).toEqual(futureRecord);
  });
});

describe('reading-position store — non-canonicalizable URLs skip persistence', () => {
  test.each([
    ['javascript:alert(1)'],
    ['data:text/plain,hello'],
    ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html'],
    ['file:///tmp/x'],
    ['about:blank'],
    ['ws://example.com/'],
    ['not a url'],
  ])('write on %s is a no-op', async (url) => {
    await store.write(url, { wordIndex: 1, totalWords: 10 });
    const snap = adapter.snapshot();
    // No keys at all should have been written — neither a payload nor
    // the index.
    expect(Object.keys(snap)).toHaveLength(0);
  });

  test('read on a non-canonicalizable URL returns undefined without touching the adapter', async () => {
    expect(await store.read('javascript:alert(1)')).toBeUndefined();
    expect(await store.read('chrome://settings/')).toBeUndefined();
    // Adapter state unchanged.
    expect(Object.keys(adapter.snapshot())).toHaveLength(0);
  });

  test('clear on a non-canonicalizable URL is a no-op', async () => {
    await expect(store.clear('javascript:alert(1)')).resolves.toBeUndefined();
    expect(Object.keys(adapter.snapshot())).toHaveLength(0);
  });

  test('touch on a non-canonicalizable URL is a no-op', async () => {
    await expect(store.touch('javascript:alert(1)')).resolves.toBeUndefined();
    expect(Object.keys(adapter.snapshot())).toHaveLength(0);
  });

  test('valid https URL still writes through after the guard', async () => {
    await store.write('https://example.com/a', { wordIndex: 3, totalWords: 30 });
    expect(await store.read('https://example.com/a')).toEqual({
      wordIndex: 3,
      totalWords: 30,
      lastReadAt: now,
    });
  });
});

describe('reading-position store — concurrent writes serialize through the queue', () => {
  /**
   * Builds a slow `StorageAdapter` where every `get()` and `set()`
   * yields to the macrotask queue (`setTimeout(0)`) before completing.
   * The yields make the read-modify-write window observable: a
   * non-serialised implementation will let a second dispatch's `get()`
   * resolve against an adapter snapshot that pre-dates the first
   * dispatch's `set()`, then both writes will race on the LRU index.
   */
  function createSlowAdapter(): StorageAdapter & { snapshot(): Record<string, unknown> } {
    const map = new Map<string, unknown>();
    return {
      async get(keys) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const out: Record<string, unknown> = {};
        for (const k of keys) {
          if (map.has(k)) out[k] = structuredClone(map.get(k));
        }
        return out;
      },
      async set(items) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        for (const [k, v] of Object.entries(items)) {
          map.set(k, structuredClone(v));
        }
      },
      async remove(keys) {
        for (const k of keys) map.delete(k);
      },
      async getAll() {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const out: Record<string, unknown> = {};
        for (const [k, v] of map.entries()) out[k] = structuredClone(v);
        return out;
      },
      snapshot() {
        return Object.fromEntries(map.entries());
      },
    };
  }

  test('concurrent writes for DISTINCT URLs serialize on the LRU index: all entries land in dispatch order', async () => {
    // Three writes dispatched without awaits — each performs a
    // read-modify-write on the SHARED `position-index` key. Under the
    // slow adapter, a non-serialised implementation lets each
    // dispatch's `get(index)` resolve against the EMPTY initial
    // snapshot, then each one independently sets the index to its own
    // single-entry array. The last `set()` of `position-index` wins,
    // so the index ends up with ONE entry instead of THREE.
    //
    // Under the queue, dispatch N's `get(index)` only runs after
    // dispatch N-1's `set(index)` has resolved, so each dispatch sees
    // the prior writes accumulated. Final index = [A, B, C].
    //
    // Assertions discriminate: index length AND order both must
    // survive — a non-serialised impl produces length 1.
    const slowAdapter = createSlowAdapter();
    const slowStore = createReadingPositionStore({
      adapter: slowAdapter,
      now: () => now,
    });

    const dispatched = [
      slowStore.write('https://example.com/a', { wordIndex: 1, totalWords: 10 }),
      slowStore.write('https://example.com/b', { wordIndex: 2, totalWords: 10 }),
      slowStore.write('https://example.com/c', { wordIndex: 3, totalWords: 10 }),
    ];
    await Promise.all(dispatched);

    const index = (await slowAdapter.get([POSITION_INDEX_KEY]))[POSITION_INDEX_KEY] as string[];
    expect(index).toEqual([
      keyOf('https://example.com/a'),
      keyOf('https://example.com/b'),
      keyOf('https://example.com/c'),
    ]);

    // Every payload must be readable — proves no payload was lost
    // even though the index races on the shared key.
    expect((await slowStore.read('https://example.com/a'))?.wordIndex).toBe(1);
    expect((await slowStore.read('https://example.com/b'))?.wordIndex).toBe(2);
    expect((await slowStore.read('https://example.com/c'))?.wordIndex).toBe(3);
  });

  test('concurrent writes for the SAME URL serialize: last dispatched write wins', async () => {
    // Three writes against the SAME URL with the slow adapter.
    // Without serialisation, the final stored payload is whichever
    // `adapter.set(payload)` happens to land last — which under the
    // setTimeout(0) scheduler is dispatch-order dependent but not
    // dispatch-order GUARANTEED. With the queue, dispatch order is
    // strictly preserved, so wordIndex=30 wins deterministically.
    const slowAdapter = createSlowAdapter();
    const slowStore = createReadingPositionStore({
      adapter: slowAdapter,
      now: () => now,
    });
    const url = 'https://example.com/same';

    const dispatched = [
      slowStore.write(url, { wordIndex: 10, totalWords: 100 }),
      slowStore.write(url, { wordIndex: 20, totalWords: 100 }),
      slowStore.write(url, { wordIndex: 30, totalWords: 100 }),
    ];
    await Promise.all(dispatched);

    const got = await slowStore.read(url);
    expect(got?.wordIndex).toBe(30);

    const expectedKey = keyOf(url);
    const index = (await slowAdapter.get([POSITION_INDEX_KEY]))[POSITION_INDEX_KEY] as string[];
    expect(index.filter((k) => k === expectedKey)).toHaveLength(1);
  });

  test('a rejected write does NOT poison the queue: subsequent writes still land', async () => {
    // Adapter where the FIRST set() rejects (mimicking a transient
    // quota error). The store's queue chains `then(undefined, () => undefined)`
    // so the rejection is swallowed AFTER the caller-facing promise
    // rejects; the queue itself stays resumable.
    const map = new Map<string, unknown>();
    let setCalls = 0;
    const flakeyAdapter: StorageAdapter = {
      async get(keys) {
        const out: Record<string, unknown> = {};
        for (const k of keys) {
          if (map.has(k)) out[k] = structuredClone(map.get(k));
        }
        return out;
      },
      async set(items) {
        setCalls++;
        if (setCalls === 1) throw new Error('quota');
        for (const [k, v] of Object.entries(items)) {
          map.set(k, structuredClone(v));
        }
      },
      async remove(keys) {
        for (const k of keys) map.delete(k);
      },
      async getAll() {
        const out: Record<string, unknown> = {};
        for (const [k, v] of map.entries()) out[k] = structuredClone(v);
        return out;
      },
    };
    const flakeyStore = createReadingPositionStore({
      adapter: flakeyAdapter,
      now: () => now,
    });

    // (a) The first write rejects with the adapter's error.
    await expect(
      flakeyStore.write('https://example.com/a', { wordIndex: 1, totalWords: 10 }),
    ).rejects.toThrow('quota');

    // (b) A subsequent write against the same store must resolve and
    // land the payload. If the queue's rejection handling were dropped
    // (e.g. the head `writeQueue.then(op, op)` changed to
    // `writeQueue.then(op)` so the next dispatch's op never runs when
    // the prior chain rejected), this second dispatch would reject
    // with the prior error.
    await expect(
      flakeyStore.write('https://example.com/b', { wordIndex: 5, totalWords: 50 }),
    ).resolves.toBeUndefined();
    expect(await flakeyStore.read('https://example.com/b')).toEqual({
      wordIndex: 5,
      totalWords: 50,
      lastReadAt: now,
    });
  });
});

describe('reading-position store — makeReadingPosition smart constructor (via parseStored)', () => {
  // The smart constructor is module-private; we exercise it through
  // `read()` (which routes raw adapter payloads through `parseStored`).
  // Each test pre-seeds the adapter with a payload that exercises one
  // invariant and asserts `read()` returns undefined.
  test('valid construction: payload with 0 <= wordIndex < totalWords round-trips', async () => {
    await store.write('https://example.com/ok', { wordIndex: 5, totalWords: 10 });
    expect(await store.read('https://example.com/ok')).toEqual({
      wordIndex: 5,
      totalWords: 10,
      lastReadAt: now,
    });
  });

  test('rejects when wordIndex >= totalWords (cross-field invariant)', async () => {
    const key = keyOf('https://example.com/bad');
    // Pre-seed a payload where wordIndex equals totalWords — would be
    // "past end of stream" and the engine cannot resume from it.
    await adapter.set({
      [key]: {
        schemaVersion: POSITION_SCHEMA_VERSION,
        wordIndex: 10,
        totalWords: 10,
        lastReadAt: now,
      },
      [POSITION_INDEX_KEY]: [key],
    });
    expect(await store.read('https://example.com/bad')).toBeUndefined();
  });

  test('rejects when wordIndex exceeds totalWords', async () => {
    const key = keyOf('https://example.com/over');
    await adapter.set({
      [key]: {
        schemaVersion: POSITION_SCHEMA_VERSION,
        wordIndex: 50,
        totalWords: 10,
        lastReadAt: now,
      },
      [POSITION_INDEX_KEY]: [key],
    });
    expect(await store.read('https://example.com/over')).toBeUndefined();
  });

  test.each<[string, Record<string, unknown>]>([
    ['negative wordIndex', { wordIndex: -1, totalWords: 10, lastReadAt: 1 }],
    ['non-integer wordIndex', { wordIndex: 1.5, totalWords: 10, lastReadAt: 1 }],
    ['totalWords = 0', { wordIndex: 0, totalWords: 0, lastReadAt: 1 }],
    ['non-integer totalWords', { wordIndex: 1, totalWords: 3.2, lastReadAt: 1 }],
    ['NaN wordIndex', { wordIndex: NaN, totalWords: 10, lastReadAt: 1 }],
    ['Infinity totalWords', { wordIndex: 1, totalWords: Infinity, lastReadAt: 1 }],
    ['negative lastReadAt', { wordIndex: 1, totalWords: 10, lastReadAt: -1 }],
    ['Infinity lastReadAt', { wordIndex: 1, totalWords: 10, lastReadAt: Infinity }],
  ])('rejects malformed numeric field: %s', async (_label, payload) => {
    const key = keyOf('https://example.com/x');
    await adapter.set({
      [key]: { schemaVersion: POSITION_SCHEMA_VERSION, ...payload },
      [POSITION_INDEX_KEY]: [key],
    });
    expect(await store.read('https://example.com/x')).toBeUndefined();
  });

  test('write() rejects when caller supplies wordIndex >= totalWords (smart-constructor guard)', async () => {
    await expect(
      store.write('https://example.com/bad', { wordIndex: 10, totalWords: 10 }),
    ).rejects.toThrow();
    await expect(
      store.write('https://example.com/bad', { wordIndex: 50, totalWords: 10 }),
    ).rejects.toThrow();
  });
});

describe('reading-position store — clearAll() orphan sweep (#197)', () => {
  // Inverts the prior negative-pin (#195 TG6): clearAll() now SWEEPS
  // orphaned `position:*` keys that the LRU index never tracked, in
  // addition to the index-keyed removal. Orphans arise from a crashed
  // write that landed the payload but lost the index update.
  //
  // Mutation evidence: delete the `getAll()` sweep block in
  // `clearAll()` (so it removes only `index`) and the "orphan + index"
  // and "only orphan" cases below go red — the orphan survives.

  test('removes BOTH an indexed entry and an unindexed orphan', async () => {
    const orphanKey = `position:https://orphan.example.com/`;
    await adapter.set({ [orphanKey]: { schemaVersion: 1, wordIndex: 1, totalWords: 10 } });
    await store.write('https://example.com/tracked', { wordIndex: 1, totalWords: 10 });

    await store.clearAll();

    const snap = adapter.snapshot();
    expect(snap[keyOf('https://example.com/tracked')]).toBeUndefined();
    expect(snap[POSITION_INDEX_KEY]).toBeUndefined();
    // Orphan is now swept — the discriminating assertion.
    expect(snap[orphanKey]).toBeUndefined();
  });

  test('removes an orphan even when the index is absent (empty-index crash case)', async () => {
    // The orphan-producing failure mode: write() landed the payload but
    // the index update was lost, so there is NO index at all. A sweep
    // gated on a non-empty index would miss this exact key.
    const orphanKey = `position:https://orphan.example.com/`;
    await adapter.set({ [orphanKey]: { schemaVersion: 1, wordIndex: 1, totalWords: 10 } });

    await store.clearAll();

    expect(adapter.snapshot()[orphanKey]).toBeUndefined();
  });

  test('does NOT remove non-position keys (settings.*, font:*, etc.)', async () => {
    // Explicit regression: a sweep that nukes everything must fail this.
    await adapter.set({
      'settings.theme': { value: 'dark' },
      'font:default': { family: 'OpenDyslexic' },
      'session-state': { lastTab: 7 },
    });
    const orphanKey = `position:https://orphan.example.com/`;
    await adapter.set({ [orphanKey]: { schemaVersion: 1, wordIndex: 1, totalWords: 10 } });

    await store.clearAll();

    const snap = adapter.snapshot();
    expect(snap[orphanKey]).toBeUndefined();
    expect(snap['settings.theme']).toEqual({ value: 'dark' });
    expect(snap['font:default']).toEqual({ family: 'OpenDyslexic' });
    expect(snap['session-state']).toEqual({ lastTab: 7 });
  });

  test('empty store with no orphans → no-op (still scans, does not throw)', async () => {
    await expect(store.clearAll()).resolves.toBeUndefined();
    expect(Object.keys(adapter.snapshot())).toHaveLength(0);
  });
});

describe('reading-position store — list()', () => {
  test('returns empty array when no entries exist', async () => {
    expect(await store.list()).toEqual([]);
  });

  test('returns entries in LRU order, most-recent first', async () => {
    await store.write('https://example.com/oldest', { wordIndex: 1, totalWords: 10 });
    now += 1_000;
    await store.write('https://example.com/middle', { wordIndex: 2, totalWords: 10 });
    now += 1_000;
    await store.write('https://example.com/newest', { wordIndex: 3, totalWords: 10 });

    const got = await store.list();
    expect(got).toHaveLength(3);
    expect(got[0].url).toBe('https://example.com/newest');
    expect(got[0].position.wordIndex).toBe(3);
    expect(got[1].url).toBe('https://example.com/middle');
    expect(got[2].url).toBe('https://example.com/oldest');
  });

  test('reflects touch — touched entry moves to the front of list output', async () => {
    await store.write('https://example.com/a', { wordIndex: 1, totalWords: 10 });
    now += 1_000;
    await store.write('https://example.com/b', { wordIndex: 2, totalWords: 10 });
    now += 1_000;
    await store.touch('https://example.com/a');

    const got = await store.list();
    expect(got[0].url).toBe('https://example.com/a');
    expect(got[1].url).toBe('https://example.com/b');
  });

  test('skips malformed records silently (does not throw)', async () => {
    const goodKey = keyOf('https://example.com/good');
    const badKey = keyOf('https://example.com/bad');
    await adapter.set({
      [goodKey]: {
        schemaVersion: POSITION_SCHEMA_VERSION,
        wordIndex: 5,
        totalWords: 50,
        lastReadAt: now,
      },
      [badKey]: { totally: 'wrong' },
      [POSITION_INDEX_KEY]: [badKey, goodKey],
    });

    const got = await store.list();
    expect(got).toHaveLength(1);
    expect(got[0].url).toBe('https://example.com/good');
  });
});

describe('reading-position store — clearAll()', () => {
  test('removes every persisted position and the index', async () => {
    await store.write('https://example.com/a', { wordIndex: 1, totalWords: 10 });
    await store.write('https://example.com/b', { wordIndex: 2, totalWords: 10 });
    await store.write('https://example.com/c', { wordIndex: 3, totalWords: 10 });

    await store.clearAll();

    expect(await store.read('https://example.com/a')).toBeUndefined();
    expect(await store.read('https://example.com/b')).toBeUndefined();
    expect(await store.read('https://example.com/c')).toBeUndefined();
    expect(await store.list()).toEqual([]);

    // Adapter snapshot — no position:* keys, no index.
    const snap = adapter.snapshot();
    expect(Object.keys(snap)).toHaveLength(0);
  });

  test('clearAll on an empty store is a no-op (does not throw)', async () => {
    await expect(store.clearAll()).resolves.toBeUndefined();
  });

  test('clearAll leaves unrelated adapter keys untouched', async () => {
    await adapter.set({ 'unrelated-key': { keep: true } });
    await store.write('https://example.com/a', { wordIndex: 1, totalWords: 10 });

    await store.clearAll();

    const snap = adapter.snapshot();
    expect(snap['unrelated-key']).toEqual({ keep: true });
  });
});
