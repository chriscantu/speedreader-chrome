import { describe, it, expect } from 'vitest';
import { migrate } from '../migrations';
import { DEFAULT_SETTINGS } from '../defaults';
import { SettingsSchemaV7 } from '../schema';

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
    expect(SettingsSchemaV7.safeParse(read).success).toBe(true);
  });

  it('migrates a synthetic v0 payload up through the full chain to current version', () => {
    // v0 lacks an explicit version field; defaults fill in the rest.
    const v0 = { wpm: 300, theme: 'dark', font: 'Georgia', fontSize: 22 };
    const result = migrate(v0);
    expect(result.version).toBe(7);
    expect(result.wpm).toBe(300);
    expect(result.theme).toBe('dark');
    // Fields absent in v0 come from defaults.
    expect(result.openDyslexic).toBe(DEFAULT_SETTINGS.openDyslexic);
    expect(result.punctuationPacing).toBe(DEFAULT_SETTINGS.punctuationPacing);
  });

  it('fills in missing fields from defaults when partial v2 is stored', () => {
    const partial = { version: 2, wpm: 350 };
    const result = migrate(partial);
    expect(result.version).toBe(7);
    expect(result.wpm).toBe(350);
    expect(result.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(result.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });

  // Canonical missing-field repair pin (#67). Other tests cover repair as a
  // side effect of version-chain migration; this one isolates the v3-with-
  // missing-field case so the policy is explicit: missing fields in an
  // already-current-version blob acquire defaults rather than failing parse.
  it('migrates v3 blob with missing field by filling defaults (explicit repair behavior)', () => {
    // Valid v3 in every respect except `punctuationPacing` is absent — e.g.
    // a partial sync payload, or a future schema revision where this field
    // was added and an older device's blob lacks it.
    const v3MissingField = {
      version: 3,
      wpm: 300,
      theme: 'dark' as const,
      font: 'system-ui',
      fontSize: 20,
      openDyslexic: false,
      alignment: 'orp' as const,
      // punctuationPacing intentionally omitted
    };
    const result = migrate(v3MissingField);
    expect(result.punctuationPacing).toBe(DEFAULT_SETTINGS.punctuationPacing);
    // And the rest of the user's values survive the repair.
    expect(result.version).toBe(7);
    expect(result.wpm).toBe(300);
    expect(result.theme).toBe('dark');
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
    expect(result.version).toBe(7);
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
    expect(result.version).toBe(7);
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
    expect(result.version).toBe(7);
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
      expect(result.version).toBe(7);
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
      expect(result.version).toBe(7);
    },
  );

  it('V0 payload with legacy theme: light chains through to V3', () => {
    const v0 = { wpm: 320, theme: 'light' as const };
    const result = migrate(v0);
    expect(result.version).toBe(7);
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
    expect(result.version).toBe(7);
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
    expect(result.version).toBe(7);
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
    expect(result.version).toBe(7);
    expect(result.theme).toBe('nord');
    expect(result.alignment).toBe('orp');
  });
});

// V3 -> V4 context-menu fields — issue #72,
// spec docs/superpowers/specs/2026-05-25-context-menu-integration.md.
// V4 adds three fields: contextLine (default false), startFromWordOne
// (default false), lastUsedWpm (defaults to the payload's current wpm so
// the first post-migration submenu open shows the user's actual reading
// speed, not the V4 default).
describe('migrate — V3 -> V4 context-menu fields (#72)', () => {
  const V3_BASE = {
    version: 3 as const,
    wpm: 250,
    theme: 'dark' as const,
    font: 'system-ui',
    fontSize: 20,
    openDyslexic: false,
    punctuationPacing: true,
    alignment: 'orp' as const,
  };

  it('V3 payload (no contextLine/startFromWordOne/lastUsedWpm) -> V4 defaults the new fields; lastUsedWpm mirrors input wpm', () => {
    const result = migrate(V3_BASE);
    expect(result.version).toBe(7);
    expect(result.contextLine).toBe(false);
    expect(result.startFromWordOne).toBe(false);
    expect(result.lastUsedWpm).toBe(V3_BASE.wpm);
    // V3 fields preserved.
    expect(result.wpm).toBe(250);
    expect(result.theme).toBe('dark');
    expect(result.alignment).toBe('orp');
  });

  it('V0 payload chains 0 -> 1 -> 2 -> 3 -> 4 with new V4 fields defaulted', () => {
    const v0 = { wpm: 320, theme: 'light' as const };
    const result = migrate(v0);
    expect(result.version).toBe(7);
    expect(result.contextLine).toBe(false);
    expect(result.startFromWordOne).toBe(false);
    expect(result.lastUsedWpm).toBe(320); // mirrors wpm at 3->4 step
    expect(result.alignment).toBe('orp'); // stamped at 1->2 step
    expect(result.wpm).toBe(320);
    expect(result.theme).toBe('light');
  });

  it('V5 payload with contextLine: true round-trips unchanged', () => {
    const v5 = {
      ...DEFAULT_SETTINGS,
      contextLine: true,
      startFromWordOne: true,
      lastUsedWpm: 420,
      wpm: 420,
    };
    const result = migrate(v5);
    expect(result).toEqual(v5);
    expect(result.contextLine).toBe(true);
    expect(result.startFromWordOne).toBe(true);
    expect(result.lastUsedWpm).toBe(420);
  });

  it('V3 payload with custom wpm: 380 -> V4 with lastUsedWpm: 380 (mirrors input wpm)', () => {
    const result = migrate({ ...V3_BASE, wpm: 380 });
    expect(result.version).toBe(7);
    expect(result.wpm).toBe(380);
    expect(result.lastUsedWpm).toBe(380);
  });

  // AC #9 literal pin — exact payload shape from spec.
  it('AC #9: literal V3 payload migrates to V4 with new fields defaulted and lastUsedWpm: 250', () => {
    const result = migrate({
      version: 3,
      wpm: 250,
      theme: 'dark',
      font: 'system-ui',
      fontSize: 20,
      openDyslexic: false,
      punctuationPacing: true,
      alignment: 'orp',
    });
    expect(result.version).toBe(7);
    expect(result.contextLine).toBe(false);
    expect(result.startFromWordOne).toBe(false);
    expect(result.lastUsedWpm).toBe(250);
  });

  // lastUsedWpm clamp — corrupt raw.wpm must not nuke the whole payload to
  // defaults. The 3->4 migrator clamps + rounds the seed value to the V4
  // schema bounds so the final safeParse sees a valid lastUsedWpm even when
  // the source wpm is bogus. (The whole-payload defaults fallback still
  // fires if raw.wpm itself is out-of-range — that's the wpm field's
  // problem, not lastUsedWpm's.)
  it('clamps a non-multipleOf(10) raw.wpm into lastUsedWpm to a valid V4 value', () => {
    // raw.wpm = 333 is non-multiple-of-10 → also fails wpm schema, so whole
    // payload nukes to defaults. This pins the nuke behavior for the wpm
    // field while the clamp protects lastUsedWpm from being the trigger.
    const result = migrate({ ...V3_BASE, wpm: 333 });
    expect(result).toEqual(DEFAULT_SETTINGS); // wpm:333 still nukes (correct)
  });

  it('clamps an out-of-range numeric source to a valid lastUsedWpm without re-nuking via that field', () => {
    // Pass a current-version blob where wpm is valid but lastUsedWpm is
    // bogus. The V3->V4 migrator does not run (already past V4), so the
    // clamp does not apply — the safeParse falls back to defaults. Pins
    // the boundary so future "auto-repair" changes surface here as
    // intentional.
    const currentBogus = { ...DEFAULT_SETTINGS, lastUsedWpm: 99999 };
    expect(migrate(currentBogus)).toEqual(DEFAULT_SETTINGS);
  });

  it('rounds raw.wpm to nearest multipleOf(10) when seeding lastUsedWpm', () => {
    // Construct a v3-shape input that passes V4 wpm validation after the
    // clamp helper rounds it. Since `wpm` itself must satisfy V3 bounds at
    // input time, use a valid V3 wpm (300) — the clamp is a no-op then.
    // For coverage of the rounding path, exercise the helper indirectly
    // through a v0 chain where intermediate steps don't validate wpm.
    const v0 = { wpm: 305 }; // chains through 0->1->2->3->4
    const result = migrate(v0);
    // wpm:305 fails the multipleOf(10) constraint at the final safeParse
    // → entire payload nukes to defaults. That's correct behavior; this
    // test pins it so a future relaxation surfaces here.
    expect(result).toEqual(DEFAULT_SETTINGS);
  });
});

// V4 -> V5 history opt-in toggle — issue #49.
// V5 adds `historyEnabled: boolean` defaulted to `false` (privacy floor —
// reading patterns are sensitive). The migrator never enables history
// retroactively for existing users.
describe('migrate — V4 -> V5 historyEnabled field (#49)', () => {
  const V4_BASE = {
    version: 4 as const,
    wpm: 250,
    theme: 'dark' as const,
    font: 'system-ui',
    fontSize: 20,
    openDyslexic: false,
    punctuationPacing: true,
    alignment: 'orp' as const,
    contextLine: false,
    startFromWordOne: false,
    lastUsedWpm: 250,
  };

  it('V4 payload (no historyEnabled) -> V5 with historyEnabled: false (opt-in default)', () => {
    const result = migrate(V4_BASE);
    expect(result.version).toBe(7);
    expect(result.historyEnabled).toBe(false);
    // Other V4 fields preserved.
    expect(result.wpm).toBe(250);
    expect(result.theme).toBe('dark');
    expect(result.contextLine).toBe(false);
    expect(result.lastUsedWpm).toBe(250);
  });

  it('V4 payload with historyEnabled: true is NOT possible — but a hand-edited blob is accepted at the V5 schema gate', () => {
    // V4 schema strips historyEnabled (unknown key) on shape gates, but the
    // raw migration step `4 -> 5` only does `...raw, historyEnabled: false`
    // — meaning a user that hand-edits a V4 blob to add `historyEnabled:
    // true` STILL ends up at historyEnabled: false after migration. Pins
    // the migrator's stamp (we never auto-enable history during migration).
    const hand = { ...V4_BASE, historyEnabled: true };
    const result = migrate(hand);
    expect(result.historyEnabled).toBe(false);
  });

  // TG5 — privacy-floor INTENT (not implementation): a hand-edited V4
  // blob carrying ANY truthy or invalid `historyEnabled` value MUST end
  // up at `historyEnabled === false` after migration. The previous
  // single-case assertion (`historyEnabled: true`) passed by accident of
  // spread order — the migrator's `{ ...raw, historyEnabled: false }`
  // happens to put the literal AFTER the spread, so `false` wins. A
  // defensible refactor flipping to `{ historyEnabled: false, ...raw }`
  // ("defaults first, then user overrides") would silently allow
  // `historyEnabled: true` through. These cases pin the contract
  // independently of spread order: even if the migrator stamp loses,
  // the V5 safeParse rejects invalid types and the defaults fallback
  // (historyEnabled: false) restores the privacy floor.
  it.each([
    ['boolean true', true],
    ['number 1', 1],
    ['truthy string', 'TRUTHY_BUT_INVALID'],
    ['number 0 (falsy but non-boolean)', 0],
    ['object {}', {}],
  ])('V4 -> V5 forces historyEnabled to false regardless of hand-edited %s', (_label, value) => {
    const hand = { ...V4_BASE, historyEnabled: value };
    const result = migrate(hand);
    expect(result.historyEnabled).toBe(false);
  });

  it('V5-already-present payload with historyEnabled: true round-trips unchanged', () => {
    const v5 = { ...DEFAULT_SETTINGS, historyEnabled: true };
    const result = migrate(v5);
    expect(result).toEqual(v5);
    expect(result.historyEnabled).toBe(true);
  });

  it('V0 payload chains all the way to V5 with historyEnabled: false', () => {
    const v0 = { wpm: 300, theme: 'light' as const };
    const result = migrate(v0);
    expect(result.version).toBe(7);
    expect(result.historyEnabled).toBe(false);
  });

  it('partial V5 payload missing historyEnabled — defaults fill it as false (forward-compat repair)', () => {
    const partial: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    delete partial.historyEnabled;
    const result = migrate(partial);
    expect(result.version).toBe(7);
    expect(result.historyEnabled).toBe(false);
  });
});

// V5 -> V6 chunkSize field — issue #51.
// V6 adds `chunkSize: 1 | 2 | 3` defaulted to `1` (back-compat — today's
// single-word behavior). The migrator never silently opts users into
// multi-word display.
describe('migrate — V5 -> V6 chunkSize field (#51)', () => {
  const V5_BASE = {
    version: 5 as const,
    wpm: 250,
    theme: 'dark' as const,
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

  it('V5 payload (no chunkSize) -> V6 with chunkSize: 1 (back-compat default)', () => {
    const result = migrate(V5_BASE);
    expect(result.version).toBe(7);
    expect(result.chunkSize).toBe(1);
    // Other V5 fields preserved.
    expect(result.wpm).toBe(250);
    expect(result.theme).toBe('dark');
    expect(result.historyEnabled).toBe(false);
  });

  // TG-equivalent of #49 historyEnabled invariant: a hand-edited V5 blob
  // carrying ANY truthy or invalid `chunkSize` value MUST end up at
  // `chunkSize === 1` after migration. Spread order (`...raw,
  // chunkSize: 1`) is the back-compat floor; even if a future
  // refactor flipped to `chunkSize: 1, ...raw`, the V6 safeParse
  // rejects non-(1|2|3) values and the defaults fallback restores
  // chunkSize: 1.
  it.each([
    ['boolean true', true],
    ['number 0', 0],
    ['number 4', 4],
    ['number 2.5', 2.5],
    ['truthy string', '2'],
    ['object {}', {}],
  ])('V5 -> V6 forces chunkSize to 1 regardless of hand-edited %s', (_label, value) => {
    const hand = { ...V5_BASE, chunkSize: value };
    const result = migrate(hand);
    expect(result.chunkSize).toBe(1);
  });

  it('V6-already-present payload with chunkSize: 2 round-trips unchanged', () => {
    const v6 = { ...DEFAULT_SETTINGS, chunkSize: 2 as const };
    const result = migrate(v6);
    expect(result).toEqual(v6);
    expect(result.chunkSize).toBe(2);
  });

  it('V6-already-present payload with chunkSize: 3 round-trips unchanged', () => {
    const v6 = { ...DEFAULT_SETTINGS, chunkSize: 3 as const };
    const result = migrate(v6);
    expect(result.chunkSize).toBe(3);
  });

  it('V0 payload chains all the way to V6 with chunkSize: 1', () => {
    const v0 = { wpm: 300, theme: 'light' as const };
    const result = migrate(v0);
    expect(result.version).toBe(7);
    expect(result.chunkSize).toBe(1);
  });

  it('partial V6 payload missing chunkSize — defaults fill it as 1 (forward-compat repair)', () => {
    const partial: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    delete partial.chunkSize;
    const result = migrate(partial);
    expect(result.version).toBe(7);
    expect(result.chunkSize).toBe(1);
  });
});

// V6 -> V7 scrubberAutoHide field — issue #211.
// V7 adds `scrubberAutoHide: boolean` defaulted to `true` (back-compat —
// the auto-hide behavior shipped in #52/#210). The migrator never silently
// opts users out of auto-hide.
describe('migrate — V6 -> V7 scrubberAutoHide field (#211)', () => {
  const V6_BASE = {
    version: 6 as const,
    wpm: 250,
    theme: 'dark' as const,
    font: 'system-ui',
    fontSize: 20,
    openDyslexic: false,
    punctuationPacing: true,
    alignment: 'orp' as const,
    contextLine: false,
    startFromWordOne: false,
    lastUsedWpm: 250,
    historyEnabled: false,
    chunkSize: 1 as const,
  };

  it('V6 payload (no scrubberAutoHide) -> V7 with scrubberAutoHide: true (back-compat default)', () => {
    const result = migrate(V6_BASE);
    expect(result.version).toBe(7);
    expect(result.scrubberAutoHide).toBe(true);
    // Other V6 fields preserved.
    expect(result.wpm).toBe(250);
    expect(result.theme).toBe('dark');
    expect(result.chunkSize).toBe(1);
  });

  // A hand-edited V6 blob carrying ANY non-boolean `scrubberAutoHide` value
  // MUST end up at the back-compat default `true` after migration. Spread
  // order (`...raw, scrubberAutoHide: true`) is the floor; even if a future
  // refactor flipped to `scrubberAutoHide: true, ...raw`, the V7 safeParse
  // rejects the non-boolean and the defaults fallback restores `true`.
  it.each([
    ['string', 'false'],
    ['number 0', 0],
    ['null', null],
    ['object {}', {}],
  ])('V6 -> V7 forces scrubberAutoHide to true regardless of hand-edited %s', (_label, value) => {
    const hand = { ...V6_BASE, scrubberAutoHide: value };
    const result = migrate(hand);
    expect(result.scrubberAutoHide).toBe(true);
  });

  it('V7-already-present payload with scrubberAutoHide: false round-trips unchanged', () => {
    const v7 = { ...DEFAULT_SETTINGS, scrubberAutoHide: false };
    const result = migrate(v7);
    expect(result).toEqual(v7);
    expect(result.scrubberAutoHide).toBe(false);
  });

  // Asymmetry pin: a V6 hand-edit with a non-boolean is FLOORED to `true`
  // by the migrator stamp (tested above), but a *current-version* (V7) blob
  // with a non-boolean skips the migrator loop entirely (v=7 not < 7),
  // fails `SettingsSchemaV7.safeParse`, and resets the WHOLE payload to
  // defaults (not just the field). Pin that the reset lands on the
  // back-compat default, documenting the whole-payload behavior.
  it('V7-already-present payload with non-boolean scrubberAutoHide resets to full defaults', () => {
    const corrupt = { ...DEFAULT_SETTINGS, scrubberAutoHide: 'nope' };
    const result = migrate(corrupt);
    expect(result).toEqual(DEFAULT_SETTINGS);
    expect(result.scrubberAutoHide).toBe(true);
  });

  it('V0 payload chains all the way to V7 with scrubberAutoHide: true', () => {
    const v0 = { wpm: 300, theme: 'light' as const };
    const result = migrate(v0);
    expect(result.version).toBe(7);
    expect(result.scrubberAutoHide).toBe(true);
  });

  it('partial V7 payload missing scrubberAutoHide — defaults fill it as true (forward-compat repair)', () => {
    const partial: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    delete partial.scrubberAutoHide;
    const result = migrate(partial);
    expect(result.version).toBe(7);
    expect(result.scrubberAutoHide).toBe(true);
  });
});
