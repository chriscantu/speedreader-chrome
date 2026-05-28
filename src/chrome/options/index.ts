/**
 * SpeedReader — Options Page Entry
 *
 * Thin DOM bind. All logic lives in `controller.ts` so it can be unit-tested
 * against a stub SettingsApi.
 */
import { bindOptionsForm } from './controller';
import { loadSettings, saveSettings, flushSettings, subscribeSettings } from '../settings/storage';

document.addEventListener('DOMContentLoaded', () => {
  void bindOptionsForm(document, window, {
    load: loadSettings,
    save: saveSettings,
    flush: flushSettings,
    subscribe: subscribeSettings,
  });
});
