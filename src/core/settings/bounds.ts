/**
 * Canonical numeric bounds for SettingsV7 fields.
 *
 * Single source of truth — `schema.ts` derives its Zod constraints from these
 * constants, and consumers that need to clamp/validate outside Zod (the
 * options-page controller, the overlay's ↑/↓ keyboard shortcut) import the
 * same values. Widen here once, not in three places.
 *
 * Pure data — no DOM, no chrome.*; safe for `src/core/`.
 */

export const WPM_MIN = 100;
export const WPM_MAX = 600;
export const WPM_STEP = 10;

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 48;
/**
 * Neutral point for the RSVP word-scale (#247). The overlay sizes the
 * streaming word as `clamp(...) * (fontSize / FONT_SIZE_DEFAULT)`, so a
 * stored `fontSize` equal to this default yields a scale of 1.0 (the
 * responsive clamp governs unchanged). Kept as the single source of truth
 * for the default so the "default → scale 1.0" invariant cannot silently
 * drift if the default is ever retuned.
 */
export const FONT_SIZE_DEFAULT = 20;
/**
 * Increment used by the overlay's in-modal `A−` / `A+` stepper (#29).
 * Mirrors Safari upstream `FONT_SIZE_STEP = 2`
 * (`SpeedReader/SpeedReaderExtension/Resources/rsvp/settings-defaults.js`).
 * The options page number-input uses `step="1"` for fine-grained edits —
 * that's an unrelated affordance and intentionally stays at 1.
 */
export const FONT_SIZE_STEP = 2;
