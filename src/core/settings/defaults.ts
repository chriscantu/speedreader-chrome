import type { SettingsV4 } from './schema';

export const DEFAULT_SETTINGS: SettingsV4 = {
  version: 4,
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
};
