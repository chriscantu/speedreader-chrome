import type { SettingsV7 } from './schema';

export const DEFAULT_SETTINGS: SettingsV7 = {
  version: 7,
  wpm: 250,
  theme: 'system',
  font: 'system-ui',
  fontSize: 20,
  openDyslexic: false,
  punctuationPacing: true,
  alignment: 'orp',
  contextLine: false,
  startFromWordOne: false,
  lastUsedWpm: 250,
  // #49 — opt-in by default. Reading patterns are sensitive; users that
  // want the popup "Recently read" surface must enable it explicitly.
  historyEnabled: false,
  // #51 — single-word display is today's behavior and the safe default.
  // Users opt into 2 or 3 via the options page.
  chunkSize: 1,
  // #211 — auto-hide on by default (matches post-#210 behavior). ADHD
  // readers who use the scrubber as a position anchor opt out via the
  // options page.
  scrubberAutoHide: true,
};
