import { describe, it, expect } from 'vitest';
import { migrate } from '../migrations';
import { DEFAULT_SETTINGS } from '../defaults';
import { SettingsSchemaV1 } from '../schema';

describe('migrate', () => {
  it('returns a fresh defaults clone for undefined input (first install)', () => {
    const result = migrate(undefined);
    expect(result).toEqual(DEFAULT_SETTINGS);
    // ensure it's a clone, not the singleton
    expect(result).not.toBe(DEFAULT_SETTINGS);
  });

  it('returns defaults for null', () => {
    expect(migrate(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for a string (corrupt payload)', () => {
    expect(migrate('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for an array', () => {
    expect(migrate([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for schema-incompatible value (out-of-range wpm)', () => {
    expect(migrate({ ...DEFAULT_SETTINGS, wpm: 9999 })).toEqual(DEFAULT_SETTINGS);
  });

  it('passes through a valid v1 payload', () => {
    const valid = { ...DEFAULT_SETTINGS, wpm: 380, theme: 'dark' as const };
    expect(migrate(valid)).toEqual(valid);
  });

  it('round-trips: default -> modify -> migrate matches modified value', () => {
    const modified = { ...DEFAULT_SETTINGS, wpm: 320, openDyslexic: true };
    const written = JSON.parse(JSON.stringify(modified)); // simulate storage round-trip
    const read = migrate(written);
    expect(read).toEqual(modified);
    expect(SettingsSchemaV1.safeParse(read).success).toBe(true);
  });

  it('migrates a synthetic v0 payload up to v1 via the migration hook', () => {
    // v0 lacks an explicit version field; defaults fill in the rest.
    const v0 = { wpm: 300, theme: 'dark', font: 'Georgia', fontSize: 22 };
    const result = migrate(v0);
    expect(result.version).toBe(1);
    expect(result.wpm).toBe(300);
    expect(result.theme).toBe('dark');
    // Fields absent in v0 come from defaults.
    expect(result.openDyslexic).toBe(DEFAULT_SETTINGS.openDyslexic);
    expect(result.punctuationPacing).toBe(DEFAULT_SETTINGS.punctuationPacing);
  });

  it('fills in missing fields from defaults when partial v1 is stored', () => {
    const partial = { version: 1, wpm: 350 };
    const result = migrate(partial);
    expect(result.wpm).toBe(350);
    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(result.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});
