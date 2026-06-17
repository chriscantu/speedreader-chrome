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
import { positionPersistenceEnabled } from './access-gate';

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
 * Returns a store that consults `isEnabled()` on EVERY op (not once at
 * construction). When disabled, the op resolves to the "nothing persisted"
 * answer and touches no adapter — guaranteeing zero `position:*` writes. The
 * real chrome-backed store is lazily constructed on first enabled op, so a
 * permanently-disabled SW lifetime never builds the `chrome.storage.local`
 * adapter at all.
 *
 * Checking `isEnabled()` dynamically (vs a static boolean) is what makes the
 * gate fail-closed against a `setAccessLevel` that RESOLVES LATE or REJECTS:
 * the access-gate flips its signal only once the call resolves OK, so writes
 * dispatched before resolution (or after a rejection) are dropped rather than
 * landing in an un-gated `local` (ring security finding #1).
 */
export function createGuardedPositionStore(
  isEnabled: () => boolean,
  makeStore: () => ReadingPositionStore = createChromePositionStore,
): ReadingPositionStore {
  let real: ReadingPositionStore | null = null;
  const live = (): ReadingPositionStore | null => {
    if (!isEnabled()) return null;
    real ??= makeStore();
    return real;
  };
  return {
    read: (url) => live()?.read(url) ?? nullStore.read(url),
    write: (url, position) => live()?.write(url, position) ?? nullStore.write(url, position),
    touch: (url) => live()?.touch(url) ?? nullStore.touch(url),
    clear: (url) => live()?.clear(url) ?? nullStore.clear(url),
    list: () => live()?.list() ?? nullStore.list(),
    clearAll: () => live()?.clearAll() ?? nullStore.clearAll(),
  };
}

/**
 * The single SW-lifetime store instance. Wired to the existing
 * `chrome.storage.local` adapter, gated by the access-gate's live fail-closed
 * signal (enabled only once `setAccessLevel` resolves OK).
 */
export const positionStore: ReadingPositionStore = createGuardedPositionStore(
  positionPersistenceEnabled,
);
