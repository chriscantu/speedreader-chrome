/**
 * Persistent per-URL reading-position store (#48).
 *
 * Persists the user's RSVP reading position so closing the overlay on
 * an article and revisiting later auto-resumes at the same word. Keyed
 * by the canonical URL (`src/core/url/canonicalize.ts`) so utm tags,
 * fragments, and host casing collapse into the same slot.
 *
 * Constraints:
 *   - LRU-capped at `POSITION_LRU_MAX` (100). The oldest URL by
 *     `lastReadAt` is evicted when adding the 101st distinct URL.
 *   - Storage-adapter agnostic. This module accepts a `StorageAdapter`
 *     so it can run against the real `chrome.storage.local` in the
 *     extension AND against an in-memory fake in unit tests, without
 *     dragging `chrome.*` into `src/core/`.
 *   - Mutation paths (write / touch / clear / clearAll) serialise
 *     through a per-instance promise queue so concurrent dispatches
 *     cannot corrupt the LRU index by interleaving read-modify-write
 *     cycles. Reads remain concurrent — they only consult the adapter.
 *
 * Storage layout:
 *   - `position:<canonicalUrl>` → `{ schemaVersion, wordIndex, totalWords, lastReadAt }`
 *   - `position-index` → `string[]` of position keys in LRU order
 *     (oldest at index 0, most-recent at index N-1)
 *
 * Schema versioning: payloads with a `schemaVersion` greater than
 * `POSITION_SCHEMA_VERSION` are ignored on read so an older build
 * cannot misinterpret a newer payload's shape. Write paths also
 * pre-check the stored record and abort silently when it already
 * carries a higher version — preserves the newer record across a
 * downgrade. Lower versions would be migrated by a follow-up; today
 * we only have v1.
 */

import { canonicalizeUrl } from '../url/canonicalize';

/**
 * Soft cap on the number of distinct URLs the store retains. Chosen to
 * stay well under the 5 MB total quota for `chrome.storage.local`
 * (~0.5 KB per entry × 100 = ~50 KB, ~1% of quota).
 */
export const POSITION_LRU_MAX = 100;

/** Bumped when the stored payload shape changes. */
export const POSITION_SCHEMA_VERSION = 1;

/** Key prefix for the per-URL payload. */
export const POSITION_KEY_PREFIX = 'position:';

/** Key for the LRU order array. */
export const POSITION_INDEX_KEY = 'position-index';

/**
 * Computes the storage key for a canonical URL, or `null` when the
 * URL is not persistable (disallowed scheme, length cap, unparseable
 * — see `core/url/canonicalize.ts`). Callers MUST treat `null` as
 * "skip persistence".
 */
export function positionKey(url: string): string | null {
  const canonical = canonicalizeUrl(url);
  if (canonical === null) return null;
  return `${POSITION_KEY_PREFIX}${canonical}`;
}

/**
 * Persisted record shape. `lastReadAt` is the wall-clock ms epoch of
 * the most recent write/touch; used by the LRU index for ordering.
 */
export interface ReadingPosition {
  readonly wordIndex: number;
  readonly totalWords: number;
  readonly lastReadAt: number;
}

interface StoredPayload extends ReadingPosition {
  readonly schemaVersion: number;
}

/**
 * Minimal storage contract — matches the subset of
 * `chrome.storage.local` the store uses. Test fakes implement the same
 * three methods against an in-memory map.
 */
export interface StorageAdapter {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export interface ReadingPositionStore {
  /** Returns the stored position for `url`, or undefined. */
  read(url: string): Promise<ReadingPosition | undefined>;
  /**
   * Persist a position for `url`. Updates `lastReadAt` to `now()` and
   * promotes the entry to the most-recent LRU slot. Evicts the oldest
   * URL if the write would exceed `POSITION_LRU_MAX` distinct entries.
   *
   * Silently no-ops when `url` does not canonicalize (non-http(s)
   * scheme, exceeds length cap, unparseable). Silently no-ops when
   * the existing stored record carries a higher schema version (an
   * older build must not clobber a newer build's payload).
   */
  write(url: string, position: { wordIndex: number; totalWords: number }): Promise<void>;
  /**
   * Bump `lastReadAt` and the LRU slot for `url` without changing the
   * stored `wordIndex`/`totalWords`. No-op when `url` has no record,
   * does not canonicalize, or the record carries a higher schema
   * version.
   */
  touch(url: string): Promise<void>;
  /** Delete the entry for `url`. No-op when absent or non-canonicalizable. */
  clear(url: string): Promise<void>;
  /**
   * Returns every stored entry in LRU order, most-recent first
   * (reverse of the on-disk index, which is oldest-first). Skips
   * malformed and forward-incompat records silently. Exposed for #49
   * (popup "recently read" surface).
   */
  list(): Promise<Array<{ url: string; position: ReadingPosition }>>;
  /**
   * Removes every persisted position and the LRU index itself. Exposed
   * for #49 (popup "clear reading history" affordance). Non-position
   * keys in the adapter are left untouched.
   */
  clearAll(): Promise<void>;
}

export interface CreateReadingPositionStoreOptions {
  adapter: StorageAdapter;
  now: () => number;
}

export function createReadingPositionStore(
  opts: CreateReadingPositionStoreOptions,
): ReadingPositionStore {
  const { adapter, now } = opts;

  // Per-instance mutation queue. Every write/touch/clear/clearAll
  // chains onto this so the read-modify-write of the LRU index never
  // interleaves with another mutation against the same adapter. Reads
  // remain concurrent — they only sample the adapter snapshot.
  let writeQueue: Promise<void> = Promise.resolve();
  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = writeQueue.then(op, op);
    // Drop the value from the queue chain and swallow rejections so a
    // single failed op doesn't poison the queue for subsequent calls.
    writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readIndex(): Promise<string[]> {
    const got = await adapter.get([POSITION_INDEX_KEY]);
    const raw = got[POSITION_INDEX_KEY];
    if (!Array.isArray(raw)) return [];
    // Defensive — filter out non-strings so a corrupted payload can't
    // crash the LRU recomputation.
    return raw.filter((x): x is string => typeof x === 'string');
  }

  async function writeIndex(next: string[]): Promise<void> {
    await adapter.set({ [POSITION_INDEX_KEY]: next });
  }

  function parseStored(raw: unknown): ReadingPosition | undefined {
    if (raw === null || typeof raw !== 'object') return undefined;
    const r = raw as Partial<StoredPayload>;
    if (typeof r.schemaVersion !== 'number') return undefined;
    // Forward-incompat — let a newer build's payload pass through
    // untouched rather than silently downgrade it.
    if (r.schemaVersion > POSITION_SCHEMA_VERSION) return undefined;
    if (typeof r.wordIndex !== 'number' || !Number.isInteger(r.wordIndex) || r.wordIndex < 0) {
      return undefined;
    }
    if (typeof r.totalWords !== 'number' || !Number.isInteger(r.totalWords) || r.totalWords <= 0) {
      return undefined;
    }
    if (typeof r.lastReadAt !== 'number' || !Number.isFinite(r.lastReadAt)) {
      return undefined;
    }
    return {
      wordIndex: r.wordIndex,
      totalWords: r.totalWords,
      lastReadAt: r.lastReadAt,
    };
  }

  /**
   * Returns true when the raw stored value at `key` carries a
   * schemaVersion higher than the current build. Write paths consult
   * this before clobbering so a downgrade never overwrites a record
   * an upgrade installed.
   */
  function isForwardIncompat(raw: unknown): boolean {
    if (raw === null || typeof raw !== 'object') return false;
    const r = raw as { schemaVersion?: unknown };
    return typeof r.schemaVersion === 'number' && r.schemaVersion > POSITION_SCHEMA_VERSION;
  }

  return {
    async read(url) {
      const key = positionKey(url);
      if (key === null) return undefined;
      const got = await adapter.get([key]);
      return parseStored(got[key]);
    },

    write(url, position) {
      const key = positionKey(url);
      if (key === null) return Promise.resolve();
      if (
        !Number.isInteger(position.wordIndex) ||
        position.wordIndex < 0 ||
        !Number.isInteger(position.totalWords) ||
        position.totalWords <= 0
      ) {
        return Promise.reject(
          new RangeError(`reading-position.write: invalid position ${JSON.stringify(position)}`),
        );
      }
      return enqueue(async () => {
        // Forward-incompat guard — preserve the newer record. Re-read
        // the raw payload BEFORE touching the index so a downgrade can
        // never strand the LRU slot pointing at an unreadable record.
        const existing = await adapter.get([key]);
        if (isForwardIncompat(existing[key])) return;

        const payload: StoredPayload = {
          schemaVersion: POSITION_SCHEMA_VERSION,
          wordIndex: position.wordIndex,
          totalWords: position.totalWords,
          lastReadAt: now(),
        };

        const index = await readIndex();
        // Remove an existing slot for this URL so the new write promotes it
        // to the most-recent end rather than counting as a new slot.
        const filtered = index.filter((k) => k !== key);
        filtered.push(key);

        // Evict from the FRONT until we are at or under the cap.
        const toEvict: string[] = [];
        while (filtered.length > POSITION_LRU_MAX) {
          const oldest = filtered.shift();
          if (oldest !== undefined) toEvict.push(oldest);
        }

        await adapter.set({ [key]: payload });
        await writeIndex(filtered);
        if (toEvict.length > 0) await adapter.remove(toEvict);
      });
    },

    touch(url) {
      const key = positionKey(url);
      if (key === null) return Promise.resolve();
      return enqueue(async () => {
        const got = await adapter.get([key]);
        // Forward-incompat — the record is newer than we understand;
        // do not rewrite it (parseStored would return undefined and
        // we'd silently drop the index slot, stranding the record).
        if (isForwardIncompat(got[key])) return;
        const existing = parseStored(got[key]);
        if (!existing) return;

        const payload: StoredPayload = {
          schemaVersion: POSITION_SCHEMA_VERSION,
          wordIndex: existing.wordIndex,
          totalWords: existing.totalWords,
          lastReadAt: now(),
        };
        const index = await readIndex();
        const filtered = index.filter((k) => k !== key);
        filtered.push(key);
        await adapter.set({ [key]: payload });
        await writeIndex(filtered);
      });
    },

    clear(url) {
      const key = positionKey(url);
      if (key === null) return Promise.resolve();
      return enqueue(async () => {
        const index = await readIndex();
        const filtered = index.filter((k) => k !== key);
        await adapter.remove([key]);
        if (filtered.length !== index.length) await writeIndex(filtered);
      });
    },

    async list() {
      const index = await readIndex();
      if (index.length === 0) return [];
      // Fetch payloads + index in one round trip when the adapter
      // supports batched gets.
      const got = await adapter.get(index);
      // Reverse — index is oldest-first; callers want most-recent first.
      const out: Array<{ url: string; position: ReadingPosition }> = [];
      for (let i = index.length - 1; i >= 0; i--) {
        const key = index[i];
        const parsed = parseStored(got[key]);
        if (!parsed) continue;
        const url = key.slice(POSITION_KEY_PREFIX.length);
        out.push({ url, position: parsed });
      }
      return out;
    },

    clearAll() {
      return enqueue(async () => {
        const index = await readIndex();
        if (index.length > 0) await adapter.remove(index);
        await adapter.remove([POSITION_INDEX_KEY]);
      });
    },
  };
}
