import { describe, it, expect } from 'vitest';
import { SettingsSchemaV3, VALID_ALIGNMENTS, VALID_THEMES } from '../schema';
import { DEFAULT_SETTINGS } from '../defaults';

describe('SettingsSchemaV3', () => {
  it('accepts the canonical defaults', () => {
    const parsed = SettingsSchemaV3.safeParse(DEFAULT_SETTINGS);
    expect(parsed.success).toBe(true);
  });

  it('accepts a known-good payload', () => {
    const parsed = SettingsSchemaV3.safeParse({
      version: 3,
      wpm: 400,
      theme: 'dark',
      font: 'Georgia',
      fontSize: 24,
      openDyslexic: true,
      punctuationPacing: false,
      alignment: 'orp',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects wpm outside [100, 600]', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, wpm: 50 }).success).toBe(false);
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, wpm: 9999 }).success).toBe(false);
  });

  it('rejects wpm not multiples of 10', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, wpm: 255 }).success).toBe(false);
  });

  it('rejects fontSize outside [12, 48]', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, fontSize: 8 }).success).toBe(false);
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, fontSize: 64 }).success).toBe(false);
  });

  it('rejects an unknown theme', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, theme: 'rainbow' }).success).toBe(
      false,
    );
  });

  it('rejects a wrong version literal', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, version: 1 }).success).toBe(false);
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, version: 2 }).success).toBe(false);
  });
});

// V3 widened the theme enum to 7 values per ADR #0002. Pin acceptance of
// each new design-pack theme so a regression collapsing back to V2's
// 3-value set surfaces immediately.
describe('SettingsSchemaV3 — theme enum (V3 widening, issue #101)', () => {
  it.each(VALID_THEMES)('ACCEPTS theme "%s"', (theme) => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, theme }).success).toBe(true);
  });

  it.each(['sepia', 'paper', 'cream', 'nord'] as const)(
    'V3 added design-pack theme "%s" is parseable',
    (theme) => {
      expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, theme }).success).toBe(true);
    },
  );

  it('VALID_THEMES has length 7 and matches the canonical enum order', () => {
    expect(VALID_THEMES).toHaveLength(7);
    expect(VALID_THEMES).toEqual(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord']);
  });
});

// Spirit-port of Safari's `clampFontSize` / `clampChunkSize` test cases from
// chriscantu/speed-reader → tests/js/settings-defaults.test.js. Safari uses
// pure clamp helpers that return MIN/MAX/DEFAULT for out-of-range or NaN
// input. Chrome rejects-on-parse via Zod instead. Both strategies protect
// downstream code from invalid values; these tests assert the rejection
// behavior at the same boundaries Safari clamps to.
describe('SettingsSchemaV3 — boundary cases (Safari parity)', () => {
  it('accepts fontSize at lower boundary 12 (parity: clampFontSize accepts FONT_SIZE_MIN)', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, fontSize: 12 }).success).toBe(true);
  });

  it('accepts fontSize at upper boundary 48 (parity: clampFontSize accepts FONT_SIZE_MAX)', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, fontSize: 48 }).success).toBe(true);
  });

  it('accepts wpm at lower boundary 100', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, wpm: 100 }).success).toBe(true);
  });

  it('accepts wpm at upper boundary 600', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, wpm: 600 }).success).toBe(true);
  });

  it('rejects fontSize NaN (parity: clampFontSize returns FONT_SIZE_DEFAULT)', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, fontSize: NaN }).success).toBe(false);
  });

  it('rejects fontSize string (parity: clampFontSize returns FONT_SIZE_DEFAULT)', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, fontSize: 'big' }).success).toBe(
      false,
    );
  });

  it('rejects wpm NaN', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, wpm: NaN }).success).toBe(false);
  });

  it('rejects missing wpm key', () => {
    const partial = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete partial.wpm;
    expect(SettingsSchemaV3.safeParse(partial).success).toBe(false);
  });
});

// Spirit-port of Safari's `SETTINGS_KEYS` / `SETTINGS_DEFAULTS` checks.
// Safari maintains a flat key list constant; Chrome derives the key set
// from the Zod schema shape. Chrome's design intentionally diverges:
//   - Chrome KEEPS `theme` (light/dark/system). Safari removed it.
//   - Chrome lacks `paper`, `chunkSize` — `paper` adjudicated against
//     Chrome's theme system (#74), `chunkSize` tracked in its own follow-up.
//   - Chrome has `font`, `openDyslexic`, `punctuationPacing` — not in Safari.
//   - As of V2, Chrome now mirrors Safari's `alignment` field (orp/center).
describe('DEFAULT_SETTINGS covers every schema field (Safari parity)', () => {
  it('DEFAULT_SETTINGS round-trips through the schema', () => {
    expect(SettingsSchemaV3.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('DEFAULT_SETTINGS has a value for every schema key', () => {
    const shapeKeys = Object.keys(SettingsSchemaV3.shape);
    for (const key of shapeKeys) {
      expect(DEFAULT_SETTINGS).toHaveProperty(key);
    }
  });
});

// Alignment field — Safari `validateAlignment` parity (issue #93,
// spec docs/superpowers/specs/2026-05-23-alignment-field-v2.md).
// Target: 7 cases (2 accept + 5 reject). Type-mismatch cases (42, true)
// are paired into a single parameterized it.each per spec author note.
describe('SettingsSchemaV3 — alignment field (Safari parity)', () => {
  it("ACCEPTS alignment: 'orp'", () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, alignment: 'orp' }).success).toBe(
      true,
    );
  });

  it("ACCEPTS alignment: 'center'", () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, alignment: 'center' }).success).toBe(
      true,
    );
  });

  it("REJECTS alignment: 'left' (string outside enum)", () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, alignment: 'left' }).success).toBe(
      false,
    );
  });

  it("REJECTS alignment: '' (empty string)", () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, alignment: '' }).success).toBe(false);
  });

  it('REJECTS alignment: undefined (missing required key)', () => {
    const partial = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete partial.alignment;
    expect(SettingsSchemaV3.safeParse(partial).success).toBe(false);
  });

  it('REJECTS alignment: null', () => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, alignment: null }).success).toBe(
      false,
    );
  });

  it.each([
    { label: 'number 42', value: 42 },
    { label: 'boolean true', value: true },
  ])('REJECTS alignment: $label (type mismatch)', ({ value }) => {
    expect(SettingsSchemaV3.safeParse({ ...DEFAULT_SETTINGS, alignment: value }).success).toBe(
      false,
    );
  });
});

// Defaults / VALID_ALIGNMENTS export — pins the Safari mirror at the
// constant layer so accidental enum widening surfaces immediately.
describe('alignment defaults and VALID_ALIGNMENTS export', () => {
  it("DEFAULT_SETTINGS.alignment === 'orp' AND version === 3", () => {
    expect(DEFAULT_SETTINGS.alignment).toBe('orp');
    expect(DEFAULT_SETTINGS.version).toBe(3);
  });

  it("VALID_ALIGNMENTS has length 2 and equals ['orp', 'center']", () => {
    expect(VALID_ALIGNMENTS).toHaveLength(2);
    expect(VALID_ALIGNMENTS).toEqual(['orp', 'center']);
  });
});
