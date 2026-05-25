import type { SettingsV3 } from '../../core/settings/schema';
import { migrate } from '../../core/settings/migrations';

const KEY = 'speedreader.settings';
export const DEBOUNCE_MS = 300;

export type SaveSettingsInput = Omit<Partial<SettingsV3>, 'version'>;

/**
 * Read settings from `chrome.storage.sync`, migrating + validating the raw
 * value. If migration reshapes the stored value (first install, version bump,
 * or repair of a partial payload), the canonical form is written back so the
 * next read is a fast pass-through.
 */
export async function loadSettings(): Promise<SettingsV3> {
  const result = await chrome.storage.sync.get(KEY);
  const raw = result[KEY];
  const settings = migrate(raw);
  if (raw === undefined || JSON.stringify(raw) !== JSON.stringify(settings)) {
    await chrome.storage.sync.set({ [KEY]: settings });
  }
  return settings;
}

let pendingPartial: SaveSettingsInput | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingResolvers: Array<() => void> = [];
let pendingRejectors: Array<(err: unknown) => void> = [];

/**
 * Trailing-edge flush of coalesced `saveSettings` calls.
 *
 * NOTE: this awaits `loadSettings()` to obtain the current canonical state
 * before merging. `loadSettings()` may itself issue a `chrome.storage.sync.set`
 * to canonicalise the stored payload (first install, version bump, or repair
 * of a partial value). In those cases the full save sequence fires *two*
 * underlying `set` calls — one canonicalisation, one merged save. Spec AC #6
 * ("exactly one set ~300 ms after the last save") still holds because it
 * concerns the debounced save itself; the canonicalisation is a separate,
 * one-time event. Future integration tests should not assert
 * `set.toHaveBeenCalledTimes(1)` blindly across a first-install + save flow.
 */
async function flushPendingSave(): Promise<void> {
  const partial = pendingPartial ?? {};
  const resolvers = pendingResolvers;
  const rejectors = pendingRejectors;
  pendingPartial = null;
  pendingTimer = null;
  pendingResolvers = [];
  pendingRejectors = [];
  try {
    const current = await loadSettings();
    const next: SettingsV3 = { ...current, ...partial, version: current.version };
    await chrome.storage.sync.set({ [KEY]: next });
    resolvers.forEach((r) => r());
  } catch (err) {
    rejectors.forEach((r) => r(err));
  }
}

/**
 * Save a partial settings update. Calls within 300 ms are coalesced into a
 * single trailing-edge write to stay under `chrome.storage.sync`'s 120
 * writes/minute rate limit when wired to slider-style controls.
 *
 * Debounce resolution semantics (#68):
 * - A 300 ms trailing-edge debounce coalesces calls. The timer is reset on
 *   every call within the window.
 * - All callers within ONE debounce window share the resolution of that
 *   window's `chrome.storage.sync.set`: the returned Promises resolve (or
 *   reject) together when that single set completes.
 * - A late call that lands during an in-flight flush (after the timer has
 *   fired and `flushPendingSave` is mid-`await`) starts a NEW window. Its
 *   Promise resolves on a different set than the in-flight one — two distinct
 *   resolutions, not coalesced into the in-flight write.
 * - Consumers that need to deterministically `await` the write (e.g. an
 *   options-page "Save" click followed by a navigation) should call
 *   `flushSettings()` which collapses the pending window into an immediate
 *   flush.
 */
export function saveSettings(partial: SaveSettingsInput): Promise<void> {
  pendingPartial = { ...(pendingPartial ?? {}), ...partial };
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  return new Promise<void>((resolve, reject) => {
    pendingResolvers.push(resolve);
    pendingRejectors.push(reject);
    pendingTimer = setTimeout(() => {
      void flushPendingSave();
    }, DEBOUNCE_MS);
  });
}

/**
 * Force any pending `saveSettings` window to flush immediately and resolve
 * once the underlying `chrome.storage.sync.set` completes.
 *
 * - No pending save: resolves immediately on a microtask.
 * - Pending timer scheduled: cancels the timer and calls `flushPendingSave`
 *   directly (no `setTimeout`). The returned Promise awaits that flush.
 *
 * The pending state is cleared at the top of `flushPendingSave`, so any
 * `saveSettings` call that lands while the forced flush is in-flight starts a
 * fresh window — there is no double-flush path. Callers that need to await
 * THAT subsequent window must call `flushSettings()` again.
 */
export function flushSettings(): Promise<void> {
  if (pendingTimer === null) return Promise.resolve();
  clearTimeout(pendingTimer);
  pendingTimer = null;
  return new Promise<void>((resolve, reject) => {
    pendingResolvers.push(resolve);
    pendingRejectors.push(reject);
    void flushPendingSave();
  });
}

/**
 * Subscribe to settings changes from any source — including a sibling tab,
 * the options page, or a different signed-in device via Chrome sync. Returns
 * an unsubscribe function.
 */
export function subscribeSettings(listener: (s: SettingsV3) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'sync' || !changes[KEY]) return;
    listener(migrate(changes[KEY].newValue));
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
