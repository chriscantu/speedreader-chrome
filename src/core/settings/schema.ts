import { z } from 'zod';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, WPM_MAX, WPM_MIN, WPM_STEP } from './bounds';

/**
 * V7 adds `scrubberAutoHide` (issue #211) — opt-out for the playback
 * scrubber auto-hide shipped in #52/#210. Default `true` (auto-hide on,
 * matching post-#210 behavior). ADHD readers who use the position bar as
 * a visual anchor set it `false` to keep the bar visible during playback.
 * The 6 -> 7 migrator stamps `scrubberAutoHide: true` for every existing
 * payload; users opt out via the options page.
 *
 * V6 adds `chunkSize` (issue #51) — multi-word RSVP display. Default
 * `1` (single-word, today's behavior). The 5 -> 6 migrator stamps
 * `chunkSize: 1` for every existing payload; users opt into 2 or 3
 * via the options page.
 *
 * V5 adds `historyEnabled` (issue #49) — opt-in toggle gating the popup
 * "Recently read" surface. Default is `false` (privacy floor — reading
 * patterns are sensitive). The 4 -> 5 migrator stamps `historyEnabled:
 * false` for every existing payload; users that want history must
 * opt in via the options page.
 *
 * Disabling the toggle does NOT clear existing reading-position records
 * (the options-page UX surfaces a separate "Also clear existing entries"
 * checkbox for that — see `src/chrome/options/`). The flag only gates
 * the popup's display of `ReadingPositionStore.list()`.
 *
 * V4 added three fields for the context-menu integration (#72):
 * `contextLine` (toggle the line-of-context decoration around the current
 * RSVP word), `startFromWordOne` (always begin playback at token 0 rather
 * than restoring the saved cursor), and `lastUsedWpm` (persistent
 * "last-used speed" backing the context-menu preset submenu's third item).
 *
 * The 3 -> 4 migrator defaults `contextLine: false`, `startFromWordOne:
 * false`, and `lastUsedWpm` to the payload's current `wpm` (so first
 * post-migration submenu open shows the user's actual reading speed, not
 * a hardcoded 250). See `src/core/settings/migrations.ts`.
 */
/**
 * Shared WPM constraint — used by both `wpm` and `lastUsedWpm` so the
 * two fields cannot drift. `lastUsedWpm` is conceptually a snapshot of
 * `wpm` at the moment of a context-menu preset click, so a mismatch
 * would be a bug.
 */
const WPM_SCHEMA = z.number().int().min(WPM_MIN).max(WPM_MAX).multipleOf(WPM_STEP);

/**
 * Chunk-size constraint (#51). Bounded literal union mirrors the
 * `ChunkSize` type in `core/rsvp-engine/chunks.ts`. Widening past 3
 * is a future ADR — Safari upstream caps at 3, and human RSVP
 * comprehension typically degrades past 3-word chunks per the
 * reading-research literature.
 */
const CHUNK_SIZE_SCHEMA = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const SettingsSchemaV7 = z.object({
  version: z.literal(7),
  wpm: WPM_SCHEMA,
  theme: z.enum(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord']),
  font: z.string(),
  fontSize: z.number().int().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
  alignment: z.enum(['orp', 'center']),
  contextLine: z.boolean(),
  startFromWordOne: z.boolean(),
  lastUsedWpm: WPM_SCHEMA,
  historyEnabled: z.boolean(),
  chunkSize: CHUNK_SIZE_SCHEMA,
  scrubberAutoHide: z.boolean(),
});

export type SettingsV7 = z.infer<typeof SettingsSchemaV7>;

export const CURRENT_VERSION = 7 as const;

/**
 * V6 preserved for the V6 -> V7 migrator (#211) per the schema retention
 * policy adopted at V2 (issue #101 AC: "keep prior schema exported").
 */
export const SettingsSchemaV6 = z.object({
  version: z.literal(6),
  wpm: WPM_SCHEMA,
  theme: z.enum(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord']),
  font: z.string(),
  fontSize: z.number().int().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
  alignment: z.enum(['orp', 'center']),
  contextLine: z.boolean(),
  startFromWordOne: z.boolean(),
  lastUsedWpm: WPM_SCHEMA,
  historyEnabled: z.boolean(),
  chunkSize: CHUNK_SIZE_SCHEMA,
});

export type SettingsV6 = z.infer<typeof SettingsSchemaV6>;

/**
 * V5 preserved for the V5 -> V6 migrator (#51) per the schema retention
 * policy adopted at V2 (issue #101 AC: "keep prior schema exported").
 */
export const SettingsSchemaV5 = z.object({
  version: z.literal(5),
  wpm: WPM_SCHEMA,
  theme: z.enum(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord']),
  font: z.string(),
  fontSize: z.number().int().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
  alignment: z.enum(['orp', 'center']),
  contextLine: z.boolean(),
  startFromWordOne: z.boolean(),
  lastUsedWpm: WPM_SCHEMA,
  historyEnabled: z.boolean(),
});

export type SettingsV5 = z.infer<typeof SettingsSchemaV5>;

/**
 * V4 preserved for the V4 -> V5 migrator (#49) per the schema retention
 * policy adopted at V2 (issue #101 AC: "keep prior schema exported").
 */
export const SettingsSchemaV4 = z.object({
  version: z.literal(4),
  wpm: WPM_SCHEMA,
  theme: z.enum(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord']),
  font: z.string(),
  fontSize: z.number().int().min(FONT_SIZE_MIN).max(FONT_SIZE_MAX),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
  alignment: z.enum(['orp', 'center']),
  contextLine: z.boolean(),
  startFromWordOne: z.boolean(),
  lastUsedWpm: WPM_SCHEMA,
});

export type SettingsV4 = z.infer<typeof SettingsSchemaV4>;

/**
 * Cardinality-pinned constant mirroring Safari's `VALID_ALIGNMENTS`.
 * Used by tests today; consumed by the future Options-page UI radio
 * group (#30 follow-up) and overlay rendering wiring (pairs with #19).
 * Widening the enum is a future ADR — keep this in lockstep with the
 * `alignment` field in `SettingsSchemaV6` above.
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
