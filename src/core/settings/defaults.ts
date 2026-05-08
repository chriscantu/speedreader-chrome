import type { SettingsV1 } from './schema';

export const DEFAULT_SETTINGS: SettingsV1 = {
  version: 1,
  wpm: 250,
  theme: 'system',
  font: 'system-ui',
  fontSize: 20,
  openDyslexic: false,
  punctuationPacing: true,
};
