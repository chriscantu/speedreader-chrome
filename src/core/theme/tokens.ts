/**
 * Theme tokens — single source of truth for the six named themes adjudicated
 * in ADR #0002. Hex values extracted from `docs/design/Speed Reader Hi-Fi.html`
 * (the design pack). Tokens are CSS-only; the applier writes them as custom
 * properties onto a root element so component CSS can resolve `var(--bg)`,
 * `var(--surface)`, etc.
 *
 * No DOM, no chrome.* / browser.* — safe for src/core/.
 *
 * Slot semantics (per ADR #0002 §Decision and the Hi-Fi pack):
 *   bg          → top-level page background
 *   surface     → card / panel / overlay surface above bg
 *   text        → primary foreground text on bg / surface
 *   accent      → focus + primary action color
 *   accentSoft  → tinted background for accent-on-surface (hover, badge, etc.)
 */

export const THEME_IDS = ['light', 'dark', 'sepia', 'paper', 'cream', 'nord'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeTokens {
  bg: string;
  surface: string;
  text: string;
  accent: string;
  accentSoft: string;
}

export const THEME_TOKENS: Record<ThemeId, ThemeTokens> = {
  light: {
    bg: '#ffffff',
    surface: '#ffffff',
    text: '#202124',
    accent: '#1a73e8',
    accentSoft: '#e8f0fe',
  },
  dark: {
    bg: '#202124',
    surface: '#292a2d',
    text: '#e8eaed',
    accent: '#8ab4f8',
    accentSoft: '#1e3a5f',
  },
  sepia: {
    bg: '#f6efdd',
    surface: '#faf3e0',
    text: '#3a2f1a',
    accent: '#1558b0',
    accentSoft: '#dce8f5',
  },
  paper: {
    bg: '#f5f1ea',
    surface: '#faf7f1',
    text: '#2a2621',
    accent: '#1a73e8',
    accentSoft: '#e3edfa',
  },
  cream: {
    bg: '#fbf9f4',
    surface: '#ffffff',
    text: '#1f1d19',
    accent: '#1a73e8',
    accentSoft: '#e8f0fe',
  },
  nord: {
    bg: '#eceff4',
    surface: '#f4f6fa',
    text: '#2e3440',
    accent: '#5e81ac',
    accentSoft: '#dde4ee',
  },
};

export const TOKEN_KEYS: ReadonlyArray<keyof ThemeTokens> = [
  'bg',
  'surface',
  'text',
  'accent',
  'accentSoft',
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}
