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
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, theme: 'sepia' }).success).toBe(false);
  });

  it('rejects a wrong version literal', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, version: 2 }).success).toBe(false);
  });
});

// Spirit-port of Safari's `clampFontSize` / `clampChunkSize` test cases from
// chriscantu/speed-reader → tests/js/settings-defaults.test.js. Safari uses
// pure clamp helpers that return MIN/MAX/DEFAULT for out-of-range or NaN
// input. Chrome rejects-on-parse via Zod instead. Both strategies protect
// downstream code from invalid values; these tests assert the rejection
// behavior at the same boundaries Safari clamps to.
describe('SettingsSchemaV1 — boundary cases (Safari parity)', () => {
  it('accepts fontSize at lower boundary 12 (parity: clampFontSize accepts FONT_SIZE_MIN)', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, fontSize: 12 }).success).toBe(true);
  });

  it('accepts fontSize at upper boundary 48 (parity: clampFontSize accepts FONT_SIZE_MAX)', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, fontSize: 48 }).success).toBe(true);
  });

  it('accepts wpm at lower boundary 100', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, wpm: 100 }).success).toBe(true);
  });

  it('accepts wpm at upper boundary 600', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, wpm: 600 }).success).toBe(true);
  });

  it('rejects fontSize NaN (parity: clampFontSize returns FONT_SIZE_DEFAULT)', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, fontSize: NaN }).success).toBe(false);
  });

  it('rejects fontSize string (parity: clampFontSize returns FONT_SIZE_DEFAULT)', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, fontSize: 'big' }).success).toBe(
      false,
    );
  });

  it('rejects wpm NaN', () => {
    expect(SettingsSchemaV1.safeParse({ ...DEFAULT_SETTINGS, wpm: NaN }).success).toBe(false);
  });

  it('rejects missing wpm key', () => {
    const partial = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete partial.wpm;
    expect(SettingsSchemaV1.safeParse(partial).success).toBe(false);
  });
});

// Spirit-port of Safari's `SETTINGS_KEYS` / `SETTINGS_DEFAULTS` checks.
// Safari maintains a flat key list constant; Chrome derives the key set
// from the Zod schema shape. Chrome's design intentionally diverges:
//   - Chrome KEEPS `theme` (light/dark/system). Safari removed it.
//   - Chrome lacks `paper`, `alignment`, `chunkSize` — `paper` adjudicated
//     against Chrome's theme system (#74), `alignment` and `chunkSize`
//     tracked in their own follow-up issues.
//   - Chrome has `font`, `openDyslexic`, `punctuationPacing` — not in Safari.
describe('DEFAULT_SETTINGS covers every schema field (Safari parity)', () => {
  it('DEFAULT_SETTINGS round-trips through the schema', () => {
    expect(SettingsSchemaV1.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('DEFAULT_SETTINGS has a value for every schema key', () => {
    const shapeKeys = Object.keys(SettingsSchemaV1.shape);
    for (const key of shapeKeys) {
      expect(DEFAULT_SETTINGS).toHaveProperty(key);
    }
  });
});
