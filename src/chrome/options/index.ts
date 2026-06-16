/**
 * SpeedReader — Options Page Entry
 *
 * Thin DOM bind. All logic lives in `controller.ts` so it can be unit-tested
 * against a stub SettingsApi.
 */
import { bindOptionsForm } from './controller';
import { loadSettings, saveSettings, flushSettings, subscribeSettings } from '../settings/storage';
import { createPopupHistoryClient } from '../popup/position/client';

document.addEventListener('DOMContentLoaded', () => {
  // #196 — the options page is a trusted context but MUST NOT be a direct
  // `chrome.storage.local` writer (single-writer rule, spec §Thin-Client
  // Interfaces). The "Also clear existing entries" companion action on the
  // historyEnabled toggle routes through the SW-owned store via the same
  // `position/clear-all` RPC the popup uses, keeping ONE writer.
  const historyClient = createPopupHistoryClient(chrome);
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
      historyClient.clearAll().catch((err: unknown) => {
        console.error('[speedreader] options: clearAll on history-disable failed', err);
      });
    },
  );
});
