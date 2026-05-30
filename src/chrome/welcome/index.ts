/**
 * SpeedReader — Welcome Page Entry
 *
 * Thin DOM bind. All logic lives in `controller.ts` so it can be unit-tested
 * against a stub SettingsApi (matches the options-page testing pattern).
 *
 * See docs/superpowers/specs/2026-05-30-onboarding-surface.md §"File Layout".
 */
import { bindWelcome } from './controller';
import { loadSettings, saveSettings, flushSettings } from '../settings/storage';

document.addEventListener('DOMContentLoaded', () => {
  void bindWelcome(document, window, {
    load: loadSettings,
    save: saveSettings,
    flush: flushSettings,
  });
});
