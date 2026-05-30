/**
 * Font picker IDs (#28) — mirrors Safari's `ReaderFont` enum in
 * `SpeedReader/Shared/SettingsKeys.swift`.
 *
 * IDs are the canonical persisted values written to
 * `chrome.storage.sync.settings.font`. The overlay binds each ID to a
 * concrete `font-family` stack via a CSS rule in `styles.ts`. Family
 * stacks mirror Safari's `overlay.css` so the visible result on macOS /
 * iOS matches the Safari extension; on Chromium-only platforms the
 * stacks degrade gracefully to system serif / monospace fonts when the
 * Apple-bundled face is unavailable (e.g. New York → Iowan Old Style →
 * Georgia → serif on Linux).
 *
 * Display names are user-facing — the parenthetical category cues match
 * Safari's labels in `ReaderFont.displayName`.
 */

export const FONT_IDS = ['system', 'opendyslexic', 'newYork', 'georgia', 'menlo'] as const;
export type FontId = (typeof FONT_IDS)[number];

export const FONT_DEFAULT: FontId = 'system';

/** Display labels for the options-page picker (Safari parity). */
export const FONT_LABELS: Readonly<Record<FontId, string>> = Object.freeze({
  system: 'System (San Francisco)',
  opendyslexic: 'OpenDyslexic',
  newYork: 'New York (Serif)',
  georgia: 'Georgia (Serif)',
  menlo: 'Menlo (Monospace)',
});

/**
 * Type guard for picker IDs. Used by the options-page reader to refuse
 * unknown values and by the overlay to fall back to the system stack
 * when the persisted value drifts (older payloads with `font: 'Georgia'`
 * literal CSS family names, etc.).
 */
export function isFontId(v: unknown): v is FontId {
  return typeof v === 'string' && (FONT_IDS as readonly string[]).includes(v);
}

/**
 * Resolve the effective FontId from a raw settings value, applying the
 * #27→#28 migration: legacy callers that wrote `openDyslexic: true`
 * without a curated `font` value get promoted to `'opendyslexic'`. Any
 * unknown `font` literal falls back to `'system'` so a stale Safari
 * payload (or a hand-edit) cannot wedge the overlay.
 */
export function resolveFontId(input: { font?: unknown; openDyslexic?: unknown }): FontId {
  if (isFontId(input.font)) return input.font;
  if (input.openDyslexic === true) return 'opendyslexic';
  return FONT_DEFAULT;
}
