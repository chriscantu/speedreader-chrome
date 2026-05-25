import { describe, it, expect } from 'vitest';
import { migrate } from '../migrations';
import { DEFAULT_SETTINGS } from '../defaults';
import { SettingsSchemaV3 } from '../schema';

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
    expect(SettingsSchemaV3.safeParse(read).success).toBe(true);
  });

  it('migrates a synthetic v0 payload up through the full chain to current version', () => {
    // v0 lacks an explicit version field; defaults fill in the rest.
    const v0 = { wpm: 300, theme: 'dark', font: 'Georgia', fontSize: 22 };
    const result = migrate(v0);
    expect(result.version).toBe(3);
    expect(result.wpm).toBe(300);
    expect(result.theme).toBe('dark');
    // Fields absent in v0 come from defaults.
    expect(result.openDyslexic).toBe(DEFAULT_SETTINGS.openDyslexic);
    expect(result.punctuationPacing).toBe(DEFAULT_SETTINGS.punctuationPacing);
  });

  it('fills in missing fields from defaults when partial v2 is stored', () => {
    const partial = { version: 2, wpm: 350 };
    const result = migrate(partial);
    expect(result.version).toBe(3);
    expect(result.wpm).toBe(350);
    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(result.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});

// V1 -> V2 alignment migration — issue #93,
// spec docs/superpowers/specs/2026-05-23-alignment-field-v2.md.
// Pins the 4 cases the spec calls out explicitly. After the V3 enum widen
// (#101) the chain runs 0 -> 1 -> 2 -> 3; result.version is now 3 but the
// alignment stamp invariant lives at the 1 -> 2 step and is preserved.
describe('migrate — V1 -> V2 alignment field (forward-compatible)', () => {
  it('V1 payload (no alignment) -> stamps alignment: orp, preserves wpm/theme/etc', () => {
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
    expect(result.version).toBe(3);
    expect(result.alignment).toBe('orp');
    expect(result.wpm).toBe(300);
    expect(result.theme).toBe('dark');
    expect(result.font).toBe('system-ui');
    expect(result.fontSize).toBe(20);
    expect(result.openDyslexic).toBe(false);
    expect(result.punctuationPacing).toBe(true);
  });

  it('V0 payload (no version) -> chained 0->1->2->3 with alignment: orp', () => {
    const v0 = { wpm: 280, theme: 'light' as const };
    const result = migrate(v0);
    expect(result.version).toBe(3);
    expect(result.alignment).toBe('orp');
    expect(result.wpm).toBe(280);
    expect(result.theme).toBe('light');
  });

  it('V2 payload migrates to V3, user-set alignment: center preserved (NOT clobbered)', () => {
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
    expect(result.version).toBe(3);
    expect(result.alignment).toBe('center');
    expect(result.wpm).toBe(300);
    expect(result.theme).toBe('dark');
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

// V2 -> V3 theme enum widening — issue #101, ADR #0002.
// 2 -> 3 is value-preserving: the V2 theme set (light | dark | system) is a
// strict subset of V3's (+ sepia | paper | cream | nord). Migrator only
// stamps the version literal.
describe('migrate — V2 -> V3 theme enum widening (#101)', () => {
  const V2_BASE = {
    version: 2,
    wpm: 300,
    font: 'system-ui',
    fontSize: 20,
    openDyslexic: false,
    punctuationPacing: true,
    alignment: 'orp' as const,
  };

  it.each(['light', 'dark', 'system'] as const)(
    'V2 payload with legacy theme "%s" -> V3 preserves theme, stamps version: 3',
    (theme) => {
      const result = migrate({ ...V2_BASE, theme });
      expect(result.version).toBe(3);
      expect(result.theme).toBe(theme);
      expect(result.wpm).toBe(300);
      expect(result.alignment).toBe('orp');
    },
  );

  it.each(['sepia', 'paper', 'cream', 'nord'] as const)(
    'V3-already-present payload with new theme "%s" round-trips unchanged',
    (newTheme) => {
      const v3 = { ...DEFAULT_SETTINGS, theme: newTheme };
      const result = migrate(v3);
      expect(result).toEqual(v3);
      expect(result.theme).toBe(newTheme);
      expect(result.version).toBe(3);
    },
  );

  it('V0 payload with legacy theme: light chains through to V3', () => {
    const v0 = { wpm: 320, theme: 'light' as const };
    const result = migrate(v0);
    expect(result.version).toBe(3);
    expect(result.theme).toBe('light');
    expect(result.alignment).toBe('orp'); // stamped at 1->2
  });

  it('hand-edited V2 payload with NEW theme (sepia) — policy: V3 accepts after migrator stamp', () => {
    // Plausible corrupt-state scenario: user syncs from a newer client OR
    // hand-edits storage. The 2->3 migrator stamps version literally; the
    // safeParse then accepts the new theme because V3 enum includes it.
    // Pins the policy so a future ADR reverting theme widening surfaces
    // here as an intentional change, not silent data loss.
    const v2Corrupt = { ...V2_BASE, theme: 'sepia' as const };
    const result = migrate(v2Corrupt);
    expect(result.version).toBe(3);
    expect(result.theme).toBe('sepia');
  });
});

// Forward-incompat + idempotency boundary cases.
describe('migrate — version-boundary policies', () => {
  it('forward-incompat: V99 payload — fields that validate against V3 are preserved, version stamps to 3', () => {
    // V > CURRENT_VERSION skips the loop entirely; the final merge stamps
    // version: 3 (overriding the V99 literal) and individual fields that
    // pass V3's schema survive. Documents the lossy-downgrade behavior so
    // a future "reject future versions" change surfaces here.
    const future = { version: 99, wpm: 400, theme: 'dark' as const, alignment: 'orp' as const };
    const result = migrate(future);
    expect(result.version).toBe(3);
    expect(result.wpm).toBe(400);
    expect(result.theme).toBe('dark');
    expect(result.alignment).toBe('orp');
  });

  it('forward-incompat: V99 with field that fails V3 schema falls back to DEFAULT_SETTINGS', () => {
    // E.g. a future schema added a `chunkSize` that V3 doesn't accept — but
    // V3 strips unknown keys via safeParse, so this never fails. The
    // failure path requires a field that V3 KNOWS about but rejects (out-
    // of-range value).
    const futureCorrupt = {
      version: 99,
      wpm: 999, // outside V3 range
      theme: 'dark',
    };
    expect(migrate(futureCorrupt)).toEqual(DEFAULT_SETTINGS);
  });

  it('idempotent: migrate(migrate(v2)) deep-equals migrate(v2)', () => {
    const v2 = {
      version: 2,
      wpm: 350,
      theme: 'light' as const,
      font: 'Georgia',
      fontSize: 24,
      openDyslexic: true,
      punctuationPacing: false,
      alignment: 'center' as const,
    };
    const once = migrate(v2);
    expect(migrate(once)).toEqual(once);
  });

  it('partial V3 payload (missing alignment) -> defaults fill alignment: orp', () => {
    const partialV3 = { version: 3, wpm: 300, theme: 'nord' };
    const result = migrate(partialV3);
    expect(result.version).toBe(3);
    expect(result.theme).toBe('nord');
    expect(result.alignment).toBe('orp');
  });
});
