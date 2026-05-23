import type { SettingsV2 } from '../../core/settings/schema';
import { migrate } from '../../core/settings/migrations';

const KEY = 'speedreader.settings';
export const DEBOUNCE_MS = 300;

export type SaveSettingsInput = Omit<Partial<SettingsV2>, 'version'>;

/**
 * Read settings from `chrome.storage.sync`, migrating + validating the raw
 * value. If migration reshapes the stored value (first install, version bump,
 * or repair of a partial payload), the canonical form is written back so the
 * next read is a fast pass-through.
 */
export async function loadSettings(): Promise<SettingsV2> {
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
    const next: SettingsV2 = { ...current, ...partial, version: current.version };
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
 * Subscribe to settings changes from any source — including a sibling tab,
 * the options page, or a different signed-in device via Chrome sync. Returns
 * an unsubscribe function.
 */
export function subscribeSettings(listener: (s: SettingsV2) => void): () => void {
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
