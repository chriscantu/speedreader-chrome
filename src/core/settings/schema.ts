import { z } from 'zod';

/**
 * V4 adds three fields for the context-menu integration (#72):
 * `contextLine` (toggle the line-of-context decoration around the current
 * RSVP word), `startFromWordOne` (always begin playback at token 0 rather
 * than restoring the saved cursor), and `lastUsedWpm` (persistent
 * "last-used speed" backing the context-menu preset submenu's third item).
 *
 * The 3 -> 4 migrator defaults `contextLine: false`, `startFromWordOne:
 * false`, and `lastUsedWpm` to the payload's current `wpm` (so first
 * post-migration submenu open shows the user's actual reading speed, not
 * a hardcoded 250). See `src/core/settings/migrations.ts`.
 *
 * No other shape changes from V3.
 */
/**
 * Shared WPM constraint — used by both `wpm` and `lastUsedWpm` so the
 * two fields cannot drift. `lastUsedWpm` is conceptually a snapshot of
 * `wpm` at the moment of a context-menu preset click, so a mismatch
 * would be a bug.
 */
const WPM_SCHEMA = z.number().int().min(100).max(600).multipleOf(10);

export const SettingsSchemaV4 = z.object({
  version: z.literal(4),
  wpm: WPM_SCHEMA,
  theme: z.enum(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord']),
  font: z.string(),
  fontSize: z.number().int().min(12).max(48),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
  alignment: z.enum(['orp', 'center']),
  contextLine: z.boolean(),
  startFromWordOne: z.boolean(),
  lastUsedWpm: WPM_SCHEMA,
});

export type SettingsV4 = z.infer<typeof SettingsSchemaV4>;

export const CURRENT_VERSION = 4 as const;

/**
 * Cardinality-pinned constant mirroring Safari's `VALID_ALIGNMENTS`.
 * Used by tests today; consumed by the future Options-page UI radio
 * group (#30 follow-up) and overlay rendering wiring (pairs with #19).
 * Widening the enum is a future ADR — keep this in lockstep with the
 * `alignment` field in `SettingsSchemaV4` above.
 */
export const VALID_ALIGNMENTS = ['orp', 'center'] as const;

/**
 * V3 widened the `theme` enum to the 7-value set adjudicated in
 * [ADR #0002](../../../../docs/adrs/0002-theming-single-enum-aligned-with-design-pack.md):
 * the V2 baseline (`light | dark | system`) plus the four design-pack
 * themes (`sepia | paper | cream | nord`). V3 is preserved here for the
 * V3 -> V4 migrator (#72) per the schema retention policy adopted at
 * V2 (issue #101 AC: "keep prior schema exported").
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

/**
 * Legacy V2 schema preserved for migration consumers per issue #101 AC
 * ("keep prior schema exported"). V2 has the 3-value theme set and
 * `version: 2`. The V2 → V3 migrator only stamps the version literal,
 * so this schema is what raw payloads look like BEFORE migration.
 */
export const SettingsSchemaV2 = z.object({
  version: z.literal(2),
  wpm: z.number().int().min(100).max(600).multipleOf(10),
  theme: z.enum(['light', 'dark', 'system']),
  font: z.string(),
  fontSize: z.number().int().min(12).max(48),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
  alignment: z.enum(['orp', 'center']),
});

export type SettingsV2 = z.infer<typeof SettingsSchemaV2>;
