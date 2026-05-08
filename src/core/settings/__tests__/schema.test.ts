import { describe, it, expect } from 'vitest';
import { SettingsSchemaV1 } from '../schema';
import { DEFAULT_SETTINGS } from '../defaults';

describe('SettingsSchemaV1', () => {
  it('accepts the canonical defaults', () => {
    const parsed = SettingsSchemaV1.safeParse(DEFAULT_SETTINGS);
    expect(parsed.success).toBe(true);
  });

  it('accepts a known-good payload', () => {
    const parsed = SettingsSchemaV1.safeParse({
      version: 1,
      wpm: 400,
      theme: 'dark',
      font: 'Georgia',
      fontSize: 24,
      openDyslexic: true,
      punctuationPacing: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects wpm outside [100, 600]', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, wpm: 50 }).success).toBe(false);
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, wpm: 9999 }).success).toBe(false);
  });

  it('rejects wpm not multiples of 10', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, wpm: 255 }).success).toBe(false);
  });

  it('rejects fontSize outside [12, 48]', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, fontSize: 8 }).success).toBe(false);
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, fontSize: 64 }).success).toBe(false);
  });

  it('rejects an unknown theme', () => {
    expect(
      SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, theme: 'sepia' }).success,
    ).toBe(false);
  });

  it('rejects a wrong version literal', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, version: 2 }).success).toBe(false);
  });
});
