import type { SettingsV2 } from './schema';

export const DEFAULT_SETTINGS: SettingsV2 = {
  version: 2,
  wpm: 250,
  theme: 'system',
  font: 'system-ui',
  fontSize: 20,
  openDyslexic: false,
  punctuationPacing: true,
  alignment: 'orp',
};
