import { describe, it, expect } from 'vitest';
import {
  SettingsSchemaV6,
  SettingsSchemaV5,
  SettingsSchemaV4,
  SettingsSchemaV3,
  SettingsSchemaV2,
  VALID_ALIGNMENTS,
} from '../schema';

const VALID_THEMES_V4 = ['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord'] as const;
import { DEFAULT_SETTINGS } from '../defaults';

describe('SettingsSchemaV6 (current)', () => {
  it('accepts the canonical defaults', () => {
    const parsed = SettingsSchemaV6.safeParse(DEFAULT_SETTINGS);
    expect(parsed.success).toBe(true);
  });

  it('accepts a known-good payload', () => {
    const parsed = SettingsSchemaV6.safeParse({
      version: 6,
      wpm: 400,
      theme: 'dark',
      font: 'Georgia',
      fontSize: 24,
      openDyslexic: true,
      punctuationPacing: false,
      alignment: 'orp',
      contextLine: true,
      startFromWordOne: false,
      lastUsedWpm: 400,
      historyEnabled: false,
      chunkSize: 2,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects wpm outside [100, 600]', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, wpm: 50 }).success).toBe(false);
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, wpm: 9999 }).success).toBe(false);
  });

  it('rejects wpm not multiples of 10', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, wpm: 255 }).success).toBe(false);
  });

  it('rejects fontSize outside [12, 48]', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, fontSize: 8 }).success).toBe(false);
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, fontSize: 64 }).success).toBe(false);
  });

  it('rejects an unknown theme', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, theme: 'rainbow' }).success).toBe(
      false,
    );
  });

  it('rejects a wrong version literal', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, version: 1 }).success).toBe(false);
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, version: 2 }).success).toBe(false);
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, version: 3 }).success).toBe(false);
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, version: 4 }).success).toBe(false);
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, version: 5 }).success).toBe(false);
  });
});

// V6 new field (#51) — chunkSize literal-union [1,2,3], default 1.
describe('SettingsSchemaV6 — chunkSize field (#51)', () => {
  it.each([1, 2, 3] as const)('ACCEPTS chunkSize: %d', (n) => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, chunkSize: n }).success).toBe(true);
  });

  it('REJECTS chunkSize: 0', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, chunkSize: 0 }).success).toBe(false);
  });

  it('REJECTS chunkSize: 4 (outside literal union)', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, chunkSize: 4 }).success).toBe(false);
  });

  it('REJECTS chunkSize: non-integer', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, chunkSize: 2.5 }).success).toBe(false);
  });

  it('REJECTS chunkSize: string', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, chunkSize: '2' }).success).toBe(false);
  });

  it('REJECTS missing chunkSize', () => {
    const partial = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete partial.chunkSize;
    expect(SettingsSchemaV6.safeParse(partial).success).toBe(false);
  });
});

// Legacy V5 schema preserved for the V5 -> V6 migrator (#51 retention policy).
describe('SettingsSchemaV5 (legacy, migration consumer)', () => {
  const V5_CANONICAL = {
    version: 5 as const,
    wpm: 250,
    theme: 'system' as const,
    font: 'system-ui',
    fontSize: 20,
    openDyslexic: false,
    punctuationPacing: true,
    alignment: 'orp' as const,
    contextLine: false,
    startFromWordOne: false,
    lastUsedWpm: 250,
    historyEnabled: false,
  };

  it('accepts a V5 payload with version literal 5', () => {
    expect(SettingsSchemaV5.safeParse(V5_CANONICAL).success).toBe(true);
  });

  it('rejects version: 6 (V5 schema is version-literal 5)', () => {
    expect(SettingsSchemaV5.safeParse({ ...V5_CANONICAL, version: 6 }).success).toBe(false);
  });

  it('strips unknown V6 field chunkSize (V5 schema has no chunkSize)', () => {
    expect(SettingsSchemaV5.safeParse({ ...V5_CANONICAL, chunkSize: 2 }).success).toBe(true);
  });
});

// V4 new fields (#72) — pin the three context-menu integration fields.
describe('SettingsSchemaV6 — context-menu fields (#72)', () => {
  it('rejects contextLine: non-boolean', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, contextLine: 'yes' }).success).toBe(
      false,
    );
  });

  it('rejects startFromWordOne: non-boolean', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, startFromWordOne: 1 }).success).toBe(
      false,
    );
  });

  it('rejects lastUsedWpm outside [100, 600]', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, lastUsedWpm: 50 }).success).toBe(
      false,
    );
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, lastUsedWpm: 9999 }).success).toBe(
      false,
    );
  });

  it('rejects lastUsedWpm not multiple of 10', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, lastUsedWpm: 255 }).success).toBe(
      false,
    );
  });

  it('rejects missing contextLine', () => {
    const partial = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete partial.contextLine;
    expect(SettingsSchemaV6.safeParse(partial).success).toBe(false);
  });
});

// V4 retains V3's 7-value theme enum (ADR #0002). Pin acceptance of
// each design-pack theme so a regression collapsing back to V2's
// 3-value set surfaces immediately.
describe('SettingsSchemaV6 — theme enum (inherited from V3 widening, issue #101)', () => {
  it.each(VALID_THEMES_V4)('ACCEPTS theme "%s"', (theme) => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, theme }).success).toBe(true);
  });

  it.each(['sepia', 'paper', 'cream', 'nord'] as const)(
    'design-pack theme "%s" is parseable',
    (theme) => {
      expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, theme }).success).toBe(true);
    },
  );
});

// V5 new field (#49) — pin the historyEnabled boolean.
describe('SettingsSchemaV6 — historyEnabled field (#49)', () => {
  it('rejects historyEnabled: non-boolean', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, historyEnabled: 'yes' }).success).toBe(
      false,
    );
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, historyEnabled: 1 }).success).toBe(
      false,
    );
  });

  it('rejects missing historyEnabled', () => {
    const partial = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete partial.historyEnabled;
    expect(SettingsSchemaV6.safeParse(partial).success).toBe(false);
  });

  it('ACCEPTS historyEnabled: true', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, historyEnabled: true }).success).toBe(
      true,
    );
  });

  it('ACCEPTS historyEnabled: false (default)', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, historyEnabled: false }).success).toBe(
      true,
    );
  });
});

// Legacy V4 schema preserved for the V4 -> V5 migrator (#49 retention policy).
describe('SettingsSchemaV4 (legacy, migration consumer)', () => {
  const V4_CANONICAL = {
    version: 4 as const,
    wpm: 250,
    theme: 'system' as const,
    font: 'system-ui',
    fontSize: 20,
    openDyslexic: false,
    punctuationPacing: true,
    alignment: 'orp' as const,
    contextLine: false,
    startFromWordOne: false,
    lastUsedWpm: 250,
  };

  it('accepts a V4 payload with version literal 4', () => {
    expect(SettingsSchemaV4.safeParse(V4_CANONICAL).success).toBe(true);
  });

  it('rejects version: 5 (V4 schema is version-literal 4)', () => {
    expect(SettingsSchemaV4.safeParse({ ...V4_CANONICAL, version: 5 }).success).toBe(false);
  });

  it('strips unknown V5 field historyEnabled (V4 schema has no historyEnabled)', () => {
    // Zod strips unknown keys; success stays true. Documents the boundary
    // so a future strict() change on V4 surfaces here.
    expect(SettingsSchemaV4.safeParse({ ...V4_CANONICAL, historyEnabled: true }).success).toBe(
      true,
    );
  });
});

// Legacy V3 schema preserved for migration consumers (#72 retention policy).
// Pin the V3 version literal so a future refactor that accidentally bumps
// V3 (and breaks the migration contract) surfaces here.
describe('SettingsSchemaV3 (legacy, migration consumer)', () => {
  const V3_CANONICAL = {
    version: 3 as const,
    wpm: 250,
    theme: 'system' as const,
    font: 'system-ui',
    fontSize: 20,
    openDyslexic: false,
    punctuationPacing: true,
    alignment: 'orp' as const,
  };

  it('accepts a V3 payload with version literal 3', () => {
    expect(SettingsSchemaV3.safeParse(V3_CANONICAL).success).toBe(true);
  });

  it('rejects V4 contextLine field shape on V3 payload (V3 has no contextLine)', () => {
    // Z strips unknown keys by default; success is still true, but the V3 type
    // never carried contextLine. Documents the boundary so a future strict()
    // change surfaces.
    expect(SettingsSchemaV3.safeParse({ ...V3_CANONICAL, contextLine: true }).success).toBe(true);
  });

  it('rejects version: 4 (V3 schema is version-literal 3)', () => {
    expect(SettingsSchemaV3.safeParse({ ...V3_CANONICAL, version: 4 }).success).toBe(false);
  });
});

// Legacy V2 schema preserved for migration consumers. Pin the 3-value
// theme enum so a future refactor that accidentally widens V2 (and breaks
// the migration contract) surfaces here.
describe('SettingsSchemaV2 (legacy, migration consumer)', () => {
  const V2_CANONICAL = {
    version: 2,
    wpm: 250,
    theme: 'system' as const,
    font: 'system-ui',
    fontSize: 20,
    openDyslexic: false,
    punctuationPacing: true,
    alignment: 'orp' as const,
  };

  it('accepts a V2 payload with version literal 2', () => {
    expect(SettingsSchemaV2.safeParse(V2_CANONICAL).success).toBe(true);
  });

  it('rejects V3 new themes on a V2 payload (theme set is light|dark|system only)', () => {
    expect(SettingsSchemaV2.safeParse({ ...V2_CANONICAL, theme: 'sepia' }).success).toBe(false);
    expect(SettingsSchemaV2.safeParse({ ...V2_CANONICAL, theme: 'nord' }).success).toBe(false);
  });

  it('rejects version: 3 (V2 schema is version-literal 2)', () => {
    expect(SettingsSchemaV2.safeParse({ ...V2_CANONICAL, version: 3 }).success).toBe(false);
  });
});

// Spirit-port of Safari's `clampFontSize` / `clampChunkSize` test cases from
// chriscantu/speed-reader → tests/js/settings-defaults.test.js. Safari uses
// pure clamp helpers that return MIN/MAX/DEFAULT for out-of-range or NaN
// input. Chrome rejects-on-parse via Zod instead. Both strategies protect
// downstream code from invalid values; these tests assert the rejection
// behavior at the same boundaries Safari clamps to.
describe('SettingsSchemaV6 — boundary cases (Safari parity)', () => {
  it('accepts fontSize at lower boundary 12 (parity: clampFontSize accepts FONT_SIZE_MIN)', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, fontSize: 12 }).success).toBe(true);
  });

  it('accepts fontSize at upper boundary 48 (parity: clampFontSize accepts FONT_SIZE_MAX)', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, fontSize: 48 }).success).toBe(true);
  });

  it('accepts wpm at lower boundary 100', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, wpm: 100 }).success).toBe(true);
  });

  it('accepts wpm at upper boundary 600', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, wpm: 600 }).success).toBe(true);
  });

  it('rejects fontSize NaN (parity: clampFontSize returns FONT_SIZE_DEFAULT)', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, fontSize: NaN }).success).toBe(false);
  });

  it('rejects fontSize string (parity: clampFontSize returns FONT_SIZE_DEFAULT)', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, fontSize: 'big' }).success).toBe(
      false,
    );
  });

  it('rejects wpm NaN', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, wpm: NaN }).success).toBe(false);
  });

  it('rejects missing wpm key', () => {
    const partial = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete partial.wpm;
    expect(SettingsSchemaV6.safeParse(partial).success).toBe(false);
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
//   - As of V4, Chrome adds `contextLine`, `startFromWordOne`, `lastUsedWpm`
//     for context-menu integration (#72) — no Safari precedent per memory
//     note `project_safari_no_context_menu.md`.
describe('DEFAULT_SETTINGS covers every schema field (Safari parity)', () => {
  it('DEFAULT_SETTINGS round-trips through the schema', () => {
    expect(SettingsSchemaV6.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });

  it('DEFAULT_SETTINGS has a value for every schema key', () => {
    const shapeKeys = Object.keys(SettingsSchemaV6.shape);
    for (const key of shapeKeys) {
      expect(DEFAULT_SETTINGS).toHaveProperty(key);
    }
  });
});

// Alignment field — Safari `validateAlignment` parity (issue #93,
// spec docs/superpowers/specs/2026-05-23-alignment-field-v2.md).
// Target: 7 cases (2 accept + 5 reject). Type-mismatch cases (42, true)
// are paired into a single parameterized it.each per spec author note.
describe('SettingsSchemaV6 — alignment field (Safari parity)', () => {
  it("ACCEPTS alignment: 'orp'", () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, alignment: 'orp' }).success).toBe(
      true,
    );
  });

  it("ACCEPTS alignment: 'center'", () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, alignment: 'center' }).success).toBe(
      true,
    );
  });

  it("REJECTS alignment: 'left' (string outside enum)", () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, alignment: 'left' }).success).toBe(
      false,
    );
  });

  it("REJECTS alignment: '' (empty string)", () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, alignment: '' }).success).toBe(false);
  });

  it('REJECTS alignment: undefined (missing required key)', () => {
    const partial = { ...DEFAULT_SETTINGS } as Partial<typeof DEFAULT_SETTINGS>;
    delete partial.alignment;
    expect(SettingsSchemaV6.safeParse(partial).success).toBe(false);
  });

  it('REJECTS alignment: null', () => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, alignment: null }).success).toBe(
      false,
    );
  });

  it.each([
    { label: 'number 42', value: 42 },
    { label: 'boolean true', value: true },
  ])('REJECTS alignment: $label (type mismatch)', ({ value }) => {
    expect(SettingsSchemaV6.safeParse({ ...DEFAULT_SETTINGS, alignment: value }).success).toBe(
      false,
    );
  });
});

// Defaults / VALID_ALIGNMENTS export — pins the Safari mirror at the
// constant layer so accidental enum widening surfaces immediately.
describe('alignment defaults and VALID_ALIGNMENTS export', () => {
  it("DEFAULT_SETTINGS.alignment === 'orp' AND version === 6 (current)", () => {
    expect(DEFAULT_SETTINGS.alignment).toBe('orp');
    expect(DEFAULT_SETTINGS.version).toBe(6);
  });

  it('DEFAULT_SETTINGS.chunkSize === 1 (back-compat default for #51)', () => {
    expect(DEFAULT_SETTINGS.chunkSize).toBe(1);
  });

  it("VALID_ALIGNMENTS has length 2 and equals ['orp', 'center']", () => {
    expect(VALID_ALIGNMENTS).toHaveLength(2);
    expect(VALID_ALIGNMENTS).toEqual(['orp', 'center']);
  });
});
