import type { SettingsV3 } from './schema';

export const DEFAULT_SETTINGS: SettingsV3 = {
  version: 3,
  wpm: 250,
  theme: 'system',
  font: 'system-ui',
  fontSize: 20,
  openDyslexic: false,
  punctuationPacing: true,
  alignment: 'orp',
};
