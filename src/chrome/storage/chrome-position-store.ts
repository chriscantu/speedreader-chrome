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

/**
 * Thin wrapper over `chrome.storage.local` matching the
 * `StorageAdapter` interface. Each call returns a fresh adapter object
 * but the underlying `chrome.storage.local` surface is process-wide —
 * the adapter itself carries no state. Serialization of writes lives
 * one layer up in `createReadingPositionStore`'s internal write-queue;
 * see `createChromePositionStore` for the construction discipline that
 * preserves that queue.
 *
 * Compatibility note: the Promise form of `chrome.storage.local`
 * (`.get()` / `.set()` / `.remove()` returning Promises instead of
 * requiring a callback) requires Chrome 88+, which is the MV3 baseline.
 * If `minimum_chrome_version` is ever pinned below 88, this adapter
 * breaks silently — the Promise overload simply does not exist and calls
 * return `undefined` with no error thrown.
 */
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
    async getKeys() {
      // `getKeys()` returns every key NAME in `chrome.storage.local`
      // WITHOUT deserializing values (Chrome 130+; this extension pins a
      // 140 floor). Used only by the core store's `clearAll()` orphan
      // sweep — a rare, user-initiated path. Do NOT call on
      // read/write/touch hot paths.
      return chrome.storage.local.getKeys();
    },
  };
}

/**
 * Constructs a `ReadingPositionStore` wired to `chrome.storage.local`
 * with `Date.now` as the time source. Each call returns a NEW store
 * carrying its own internal write-queue.
 *
 * Concurrency invariant: to preserve cross-call write serialization
 * (the queue that protects the LRU index read-modify-write cycle from
 * interleaving), construct ONCE per content-script lifetime and reuse
 * the same store instance for every `read`/`write`/`touch`/`clear`/
 * `clearAll` call. Constructing per-mount or per-call yields fresh
 * queues that cannot coordinate with each other and reintroduces the
 * race the queue exists to prevent. The call site in
 * `src/chrome/content/index.ts` constructs at module scope to honour
 * this; if a future refactor moves construction inside `attachOverlay`
 * or any per-mount path, the serialization guarantee is lost.
 */
export function createChromePositionStore(): ReadingPositionStore {
  return createReadingPositionStore({
    adapter: chromeStorageAdapter(),
    now: () => Date.now(),
  });
}
