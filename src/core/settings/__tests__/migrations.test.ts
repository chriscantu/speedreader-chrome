import { describe, it, expect } from 'vitest';
import { migrate } from '../migrations';
import { DEFAULT_SETTINGS } from '../defaults';
import { SettingsSchemaV2 } from '../schema';

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

  it('passes through a valid v2 payload', () => {
    const valid = { ...DEFAULT_SETTINGS, wpm: 380, theme: 'dark' as const };
    expect(migrate(valid)).toEqual(valid);
  });

  it('round-trips: default -> modify -> migrate matches modified value', () => {
    const modified = { ...DEFAULT_SETTINGS, wpm: 320, openDyslexic: true };
    const written = JSON.parse(JSON.stringify(modified)); // simulate storage round-trip
    const read = migrate(written);
    expect(read).toEqual(modified);
    expect(SettingsSchemaV2.safeParse(read).success).toBe(true);
  });

  it('migrates a synthetic v0 payload up to v2 via the migration chain', () => {
    // v0 lacks an explicit version field; defaults fill in the rest.
    const v0 = { wpm: 300, theme: 'dark', font: 'Georgia', fontSize: 22 };
    const result = migrate(v0);
    expect(result.version).toBe(2);
    expect(result.wpm).toBe(300);
    expect(result.theme).toBe('dark');
    // Fields absent in v0 come from defaults.
    expect(result.openDyslexic).toBe(DEFAULT_SETTINGS.openDyslexic);
    expect(result.punctuationPacing).toBe(DEFAULT_SETTINGS.punctuationPacing);
  });

  it('fills in missing fields from defaults when partial v2 is stored', () => {
    const partial = { version: 2, wpm: 350 };
    const result = migrate(partial);
    expect(result.wpm).toBe(350);
    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(result.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});

// V1 -> V2 alignment migration — issue #93,
// spec docs/superpowers/specs/2026-05-23-alignment-field-v2.md.
// Pins the 4 cases the spec calls out explicitly. Existing test above
// ("migrates a synthetic v0 payload up to v2 via the migration chain")
// already covers the V0 -> V2 chain reaching version 2; the V0 case
// below adds the explicit alignment === 'orp' assertion the spec
// requires alongside the corrupt-data branch coverage.
describe('migrate — V1 -> V2 alignment field', () => {
  it('V1 payload (no alignment) -> V2 stamps alignment: orp, preserves wpm/theme/etc', () => {
    const v1 = {
      version: 1,
      wpm: 300,
      theme: 'dark' as const,
      font: 'system-ui',
      fontSize: 20,
      openDyslexic: false,
      punctuationPacing: true,
    };
    const result = migrate(v1);
    expect(result.version).toBe(2);
    expect(result.alignment).toBe('orp');
    expect(result.wpm).toBe(300);
    expect(result.theme).toBe('dark');
    expect(result.font).toBe('system-ui');
    expect(result.fontSize).toBe(20);
    expect(result.openDyslexic).toBe(false);
    expect(result.punctuationPacing).toBe(true);
  });

  it('V0 payload (no version) -> V2 via chained 0->1->2 with alignment: orp', () => {
    const v0 = { wpm: 280, theme: 'light' as const };
    const result = migrate(v0);
    expect(result.version).toBe(2);
    expect(result.alignment).toBe('orp');
    expect(result.wpm).toBe(280);
    expect(result.theme).toBe('light');
  });

  it('V2 already-present idempotency: user-set alignment: center is preserved (NOT clobbered)', () => {
    const v2 = {
      version: 2,
      wpm: 300,
      theme: 'dark' as const,
      font: 'system-ui',
      fontSize: 20,
      openDyslexic: false,
      punctuationPacing: true,
      alignment: 'center' as const,
    };
    const result = migrate(v2);
    expect(result).toEqual(v2);
    expect(result.alignment).toBe('center');
  });

  it("V2 payload with invalid alignment ('left') falls back to DEFAULT_SETTINGS", () => {
    const v2Invalid = {
      version: 2,
      wpm: 300,
      theme: 'dark' as const,
      font: 'system-ui',
      fontSize: 20,
      openDyslexic: false,
      punctuationPacing: true,
      alignment: 'left',
    };
    expect(migrate(v2Invalid)).toEqual(DEFAULT_SETTINGS);
  });
});
