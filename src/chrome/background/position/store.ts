/**
 * SW-side module-scope reading-position store (#196).
 *
 * Constructs ONE store wired to the EXISTING `chrome.storage.local` adapter
 * (`src/chrome/storage/chrome-position-store.ts`, unchanged) — now running
 * SW-side instead of CS-side. Every write from every tab serializes through
 * this single instance's internal promise-queue, which (as a welcome
 * side-effect, not a #196 deliverable) closes the cross-tab LRU-index race #48
 * documented.
 *
 * **Fail-closed (spec §The Core Decision, normative).** When the access-gate
 * could not restrict `local` to trusted contexts (`setAccessLevel` absent —
 * should be unreachable above the pinned Chrome-140 floor), persistence is
 * disabled and this store refuses to touch the adapter at all. It MUST NOT
 * write `position:*` into an un-gated, content-script-readable `local`. The
 * disabled store is a pure no-op: reads return empty, writes are dropped. No
 * resume feature is the only acceptable degraded mode.
 */

import {
  type ReadingPositionStore,
  type WritableReadingPosition,
  type ReadingPosition,
} from '../../../core/storage/reading-position';
import { createChromePositionStore } from '../../storage/chrome-position-store';
import { POSITION_PERSISTENCE_ENABLED } from './access-gate';

/**
 * A store that touches no storage. Used when persistence is disabled
 * (fail-closed). Every method resolves to the "nothing persisted" answer
 * without constructing a chrome-backed adapter.
 */
const nullStore: ReadingPositionStore = {
  read: (_url: string): Promise<ReadingPosition | undefined> => Promise.resolve(undefined),
  write: (_url: string, _position: WritableReadingPosition): Promise<void> => Promise.resolve(),
  touch: (_url: string): Promise<void> => Promise.resolve(),
  clear: (_url: string): Promise<void> => Promise.resolve(),
  list: (): Promise<Array<{ url: string; position: ReadingPosition }>> => Promise.resolve([]),
  clearAll: (): Promise<void> => Promise.resolve(),
};

/**
 * Returns the real chrome-backed store when `enabled`, else a no-op store.
 * `makeStore` is only invoked in the enabled branch, so the disabled path
 * never even constructs the `chrome.storage.local` adapter — guaranteeing zero
 * `position:*` writes.
 */
export function createGuardedPositionStore(
  enabled: boolean,
  makeStore: () => ReadingPositionStore = createChromePositionStore,
): ReadingPositionStore {
  return enabled ? makeStore() : nullStore;
}

/**
 * The single SW-lifetime store instance. Wired to the existing
 * `chrome.storage.local` adapter, gated by the access-gate's fail-closed flag.
 */
export const positionStore: ReadingPositionStore = createGuardedPositionStore(
  POSITION_PERSISTENCE_ENABLED,
);
