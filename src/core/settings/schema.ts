import { z } from 'zod';

/**
 * V3 widens the `theme` enum to the 7-value set adjudicated in
 * [ADR #0002](../../../../docs/adrs/0002-theming-single-enum-aligned-with-design-pack.md):
 * the V2 baseline (`light | dark | system`) plus the four design-pack
 * themes (`sepia | paper | cream | nord`). Token surfaces shipped in #74
 * (PR #112) — the V3 enum gate (#101) opens once those are merged.
 *
 * No other shape changes from V2. V2-seeded payloads round-trip
 * value-preservingly through the V2->V3 migrator (existing
 * `light | dark | system` values still validate in the new enum).
 */
export const SettingsSchemaV3 = z.object({
  version: z.literal(3),
  wpm: z.number().int().min(100).max(600).multipleOf(10),
  theme: z.enum(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord']),
  font: z.string(),
  fontSize: z.number().int().min(12).max(48),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
  alignment: z.enum(['orp', 'center']),
});

export type SettingsV3 = z.infer<typeof SettingsSchemaV3>;

export const CURRENT_VERSION = 3 as const;

/**
 * Cardinality-pinned constant mirroring Safari's `VALID_ALIGNMENTS`.
 * Used by tests today; consumed by the future Options-page UI radio
 * group (#30 follow-up) and overlay rendering wiring (pairs with #19).
 * Widening the enum is a future ADR — keep this in lockstep with the
 * `alignment` field in `SettingsSchemaV3` above.
 */
export const VALID_ALIGNMENTS = ['orp', 'center'] as const;

/**
 * Cardinality-pinned constant for the 7-value theme enum landed in V3.
 * Mirrors ADR #0002's adjudicated set. Widening the enum is a future
 * ADR — keep this in lockstep with the `theme` field above.
 */
export const VALID_THEMES = ['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord'] as const;
