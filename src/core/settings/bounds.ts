/**
 * Canonical numeric bounds for SettingsV6 fields.
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
 * Increment used by the overlay's in-modal `A−` / `A+` stepper (#29).
 * Mirrors Safari upstream `FONT_SIZE_STEP = 2`
 * (`SpeedReader/SpeedReaderExtension/Resources/rsvp/settings-defaults.js`).
 * The options page number-input uses `step="1"` for fine-grained edits —
 * that's an unrelated affordance and intentionally stays at 1.
 */
export const FONT_SIZE_STEP = 2;
