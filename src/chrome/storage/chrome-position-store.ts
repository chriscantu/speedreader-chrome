/**
 * Chrome glue for the reading-position store (#48).
 *
 * Thin adapter over `chrome.storage.local` that satisfies the
 * platform-agnostic `StorageAdapter` contract from
 * `core/storage/reading-position.ts`. Lives in `src/chrome/` so the
 * core stays free of `chrome.*` imports per `src/core/README.md`.
 *
 * Why `chrome.storage.local`, not `.sync`:
 *   - `sync` is capped at 100 KB total and 8 KB per item, with a
 *     120 writes/min rate limit. With a 100-entry LRU and the
 *     position-write-on-every-word-advance hot path, even debounced
 *     writes would risk quota exhaustion.
 *   - `local` is 5 MB total, no per-item cap, no rate limit — fits the
 *     access pattern.
 *   - Cross-device sync is explicitly out of scope for #48 (would
 *     require dedup + last-write-wins reconciliation; deferred).
 */

import {
  createReadingPositionStore,
  type ReadingPositionStore,
  type StorageAdapter,
} from '../../core/storage/reading-position';

function chromeStorageAdapter(): StorageAdapter {
  return {
    async get(keys) {
      // `chrome.storage.local.get` accepts string[] | string | null;
      // string[] returns only the requested keys, which is what we want.
      return (await chrome.storage.local.get(keys)) as Record<string, unknown>;
    },
    async set(items) {
      await chrome.storage.local.set(items);
    },
    async remove(keys) {
      await chrome.storage.local.remove(keys);
    },
  };
}

/**
 * Constructs a `ReadingPositionStore` wired to `chrome.storage.local`
 * with `Date.now` as the time source. Returned instance is stateless —
 * safe to construct per-call or reuse across the content-script
 * lifetime.
 */
export function createChromePositionStore(): ReadingPositionStore {
  return createReadingPositionStore({
    adapter: chromeStorageAdapter(),
    now: () => Date.now(),
  });
}
