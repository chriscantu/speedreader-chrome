import { describe, it, expect } from 'vitest';
import { validateOverrides, pickValidOverrides, type Overrides } from '../validate';

describe('validateOverrides — shape gate', () => {
  describe('valid object shapes', () => {
    it('accepts empty object', () => {
      expect(validateOverrides({})).toEqual({});
    });

    it('accepts numeric wpm', () => {
      expect(validateOverrides({ wpm: 300 })).toEqual({ wpm: 300 });
    });

    it('accepts in-bounds boundary wpm: 100', () => {
      expect(validateOverrides({ wpm: 100 })).toEqual({ wpm: 100 });
    });

    it('accepts in-bounds boundary wpm: 600', () => {
      expect(validateOverrides({ wpm: 600 })).toEqual({ wpm: 600 });
    });

    it('passes out-of-bound wpm at shape gate (bounds enforced downstream)', () => {
      // The shape gate intentionally allows out-of-bound numeric wpm so the
      // bounds gate can drop just the bad field rather than nuking the
      // entire payload. See OverridesSchema doc for rationale.
      expect(validateOverrides({ wpm: 999999 })).toEqual({ wpm: 999999 });
    });

    it('accepts boolean toggles', () => {
      expect(validateOverrides({ contextLine: true, startFromWordOne: false })).toEqual({
        contextLine: true,
        startFromWordOne: false,
      });
    });
  });

  describe('shape failures → null', () => {
    it('rejects wpm: string ("fast")', () => {
      expect(validateOverrides({ wpm: 'fast' })).toBeNull();
    });

    it('rejects non-object: string', () => {
      expect(validateOverrides('garbage')).toBeNull();
    });

    it('rejects non-object: null', () => {
      expect(validateOverrides(null)).toBeNull();
    });

    it('rejects non-object: array', () => {
      expect(validateOverrides([1, 2, 3])).toBeNull();
    });

    it('rejects non-object: number', () => {
      expect(validateOverrides(42)).toBeNull();
    });

    it('rejects non-object: undefined', () => {
      expect(validateOverrides(undefined)).toBeNull();
    });

    it('rejects non-boolean contextLine', () => {
      expect(validateOverrides({ contextLine: 'true' })).toBeNull();
    });

    it('rejects non-boolean startFromWordOne', () => {
      expect(validateOverrides({ startFromWordOne: 1 })).toBeNull();
    });
  });

  describe('unknown-key strip (graceful forward-compat)', () => {
    it('drops standalone unknown key', () => {
      expect(validateOverrides({ unknown: 'field' })).toEqual({});
    });

    it('preserves known keys while stripping unknown ones', () => {
      // Forward-compat: a future sender adding `overrides.theme` does not
      // hard-reject the message; the known `wpm` still applies.
      expect(validateOverrides({ wpm: 300, theme: 'dark' })).toEqual({
        wpm: 300,
      });
    });
  });
});

describe('pickValidOverrides — bounds gate', () => {
  describe('wpm bounds', () => {
    it('drops wpm above max (999999)', () => {
      const overrides = { wpm: 999999 } as Overrides;
      expect(pickValidOverrides(overrides)).toEqual({});
    });

    it('drops non-integer wpm (300.5)', () => {
      const overrides = { wpm: 300.5 } as Overrides;
      expect(pickValidOverrides(overrides)).toEqual({});
    });

    it('drops wpm below min (50)', () => {
      const overrides = { wpm: 50 } as Overrides;
      expect(pickValidOverrides(overrides)).toEqual({});
    });

    it('drops wpm above max boundary (601)', () => {
      // 601 fails both max(600) and multipleOf(10) — either failure is fine,
      // outcome is the same: dropped.
      const overrides = { wpm: 601 } as Overrides;
      expect(pickValidOverrides(overrides)).toEqual({});
    });

    it('drops non-multipleOf-10 wpm (305)', () => {
      const overrides = { wpm: 305 } as Overrides;
      expect(pickValidOverrides(overrides)).toEqual({});
    });

    it('preserves in-bound wpm', () => {
      expect(pickValidOverrides({ wpm: 300 })).toEqual({ wpm: 300 });
    });

    it('preserves boundary wpm: 100', () => {
      expect(pickValidOverrides({ wpm: 100 })).toEqual({ wpm: 100 });
    });

    it('preserves boundary wpm: 600', () => {
      expect(pickValidOverrides({ wpm: 600 })).toEqual({ wpm: 600 });
    });
  });

  describe('toggle bounds (strict-boolean)', () => {
    it('preserves valid wpm + valid contextLine together', () => {
      expect(pickValidOverrides({ wpm: 300, contextLine: true })).toEqual({
        wpm: 300,
        contextLine: true,
      });
    });

    it('drops non-boolean contextLine (escaped via type-cast)', () => {
      const overrides = { contextLine: 'true' as unknown as boolean };
      expect(pickValidOverrides(overrides)).toEqual({});
    });

    it('drops non-boolean startFromWordOne (escaped via type-cast)', () => {
      const overrides = { startFromWordOne: 1 as unknown as boolean };
      expect(pickValidOverrides(overrides)).toEqual({});
    });

    it('keeps valid boolean while dropping invalid sibling', () => {
      const overrides = {
        contextLine: true,
        startFromWordOne: 'false' as unknown as boolean,
      };
      expect(pickValidOverrides(overrides)).toEqual({ contextLine: true });
    });
  });

  describe('empty / no-op', () => {
    it('returns empty for empty input', () => {
      expect(pickValidOverrides({})).toEqual({});
    });
  });
});

describe('composition — applyOverrides-style pipeline', () => {
  it('shape-then-bounds drops out-of-bound wpm to empty overrides', () => {
    // Mirrors the CS-side pipeline:
    //   const shapeOk = validateOverrides(raw);
    //   if (shapeOk === null) return snapshot;
    //   const valid = pickValidOverrides(shapeOk);
    const shapeOk = validateOverrides({ wpm: 999999 });
    if (shapeOk === null) throw new Error('shape gate should have passed');
    expect(pickValidOverrides(shapeOk)).toEqual({});
  });

  it('shape-then-bounds preserves valid fields and drops invalid ones in same payload', () => {
    // Mixed payload: valid wpm + unknown key (stripped at shape) + valid
    // toggle. All survivors land in final overrides.
    const shapeOk = validateOverrides({
      wpm: 300,
      contextLine: true,
      theme: 'dark',
    });
    if (shapeOk === null) throw new Error('shape gate should have passed');
    expect(pickValidOverrides(shapeOk)).toEqual({
      wpm: 300,
      contextLine: true,
    });
  });

  it('shape-gate null short-circuits the pipeline (non-object input)', () => {
    // Hostile-shape case: non-object payload returns null at shape gate;
    // the caller (CS) returns the snapshot unchanged without ever calling
    // pickValidOverrides.
    expect(validateOverrides('garbage')).toBeNull();
  });
});
