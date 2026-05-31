import type { SettingsV5 } from './schema';

export const DEFAULT_SETTINGS: SettingsV5 = {
  version: 5,
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
};
