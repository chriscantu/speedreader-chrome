/**
 * SpeedReader — Options Page Entry
 *
 * Thin DOM bind. All logic lives in `controller.ts` so it can be unit-tested
 * against a stub SettingsApi.
 */
import { bindOptionsForm } from './controller';
import { loadSettings, saveSettings, flushSettings, subscribeSettings } from '../settings/storage';
import { createChromePositionStore } from '../storage/chrome-position-store';

document.addEventListener('DOMContentLoaded', () => {
  // #49 — singleton position store for the optional "Also clear existing
  // entries" companion action on the historyEnabled toggle. Constructed
  // at module scope so its internal write-queue serialises any clearAll
  // call with itself; the popup constructs its own store, but they both
  // hit `chrome.storage.local` and the per-instance queue is sufficient
  // for the single user-initiated wipe here.
  const positionStore = createChromePositionStore();
  void bindOptionsForm(
    document,
    window,
    {
      load: loadSettings,
      save: saveSettings,
      flush: flushSettings,
      subscribe: subscribeSettings,
    },
    (alsoClearEntries: boolean) => {
      if (!alsoClearEntries) return;
      positionStore.clearAll().catch((err: unknown) => {
        console.error('[speedreader] options: clearAll on history-disable failed', err);
      });
    },
  );
});
