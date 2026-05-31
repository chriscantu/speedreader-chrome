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
 *
 * Storage layout:
 *   - `position:<canonicalUrl>` → `{ schemaVersion, wordIndex, totalWords, lastReadAt }`
 *   - `position-index` → `string[]` of position keys in LRU order
 *     (oldest at index 0, most-recent at index N-1)
 *
 * Schema versioning: payloads with a `schemaVersion` greater than
 * `POSITION_SCHEMA_VERSION` are ignored on read so an older build
 * cannot misinterpret a newer payload's shape. Lower versions would be
 * migrated by a follow-up; today we only have v1.
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

/** Computes the storage key for a canonical URL. */
export function positionKey(url: string): string {
  return `${POSITION_KEY_PREFIX}${canonicalizeUrl(url)}`;
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
   */
  write(url: string, position: { wordIndex: number; totalWords: number }): Promise<void>;
  /**
   * Bump `lastReadAt` and the LRU slot for `url` without changing the
   * stored `wordIndex`/`totalWords`. No-op when `url` has no record.
   */
  touch(url: string): Promise<void>;
  /** Delete the entry for `url`. No-op when absent. */
  clear(url: string): Promise<void>;
}

export interface CreateReadingPositionStoreOptions {
  adapter: StorageAdapter;
  now: () => number;
}

export function createReadingPositionStore(
  opts: CreateReadingPositionStoreOptions,
): ReadingPositionStore {
  const { adapter, now } = opts;

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

  return {
    async read(url) {
      const key = positionKey(url);
      const got = await adapter.get([key]);
      return parseStored(got[key]);
    },

    async write(url, position) {
      if (
        !Number.isInteger(position.wordIndex) ||
        position.wordIndex < 0 ||
        !Number.isInteger(position.totalWords) ||
        position.totalWords <= 0
      ) {
        throw new RangeError(
          `reading-position.write: invalid position ${JSON.stringify(position)}`,
        );
      }
      const key = positionKey(url);
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
    },

    async touch(url) {
      const key = positionKey(url);
      const got = await adapter.get([key]);
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
    },

    async clear(url) {
      const key = positionKey(url);
      const index = await readIndex();
      const filtered = index.filter((k) => k !== key);
      await adapter.remove([key]);
      if (filtered.length !== index.length) await writeIndex(filtered);
    },
  };
}
