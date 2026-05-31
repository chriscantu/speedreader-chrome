import type { SettingsV6 } from './schema';

export const DEFAULT_SETTINGS: SettingsV6 = {
  version: 6,
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
};
