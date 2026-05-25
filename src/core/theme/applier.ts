import { THEME_TOKENS, THEME_IDS, type ThemeId, type ThemeTokens } from './tokens';

/**
 * Apply theme tokens to a root element as CSS custom properties.
 *
 * Writes `--bg`, `--surface`, `--text`, `--accent`, `--accent-soft` onto the
 * given element's inline style. Component CSS then resolves `var(--bg)` etc.
 * Idempotent — calling again with a different theme replaces the values.
 *
 * Forced-colors fallback: callers should pair the applier with a CSS rule of
 * the form
 *
 *     @media (forced-colors: active) {
 *       :host, :root { --bg: Canvas; --text: CanvasText; --accent: LinkText; }
 *     }
 *
 * which the user agent will substitute for the applier-written values when
 * forced-colors is active. The applier itself does NOT branch on
 * forced-colors — that's a CSS-side concern so the cascade can override.
 *
 * Runtime guard: unknown `theme` values (e.g. corrupt chrome.storage.sync
 * payload) are rejected with a `RangeError` rather than writing `undefined`.
 *
 * No DOM-API dependence beyond `HTMLElement.style.setProperty` — safe for
 * shadow roots and document roots alike.
 */
export function applyTheme(theme: ThemeId, root: HTMLElement): void {
  if (!(THEME_IDS as readonly string[]).includes(theme)) {
    throw new RangeError(
      `Unknown theme: ${String(theme)}. Expected one of ${THEME_IDS.join(', ')}.`,
    );
  }
  const tokens: ThemeTokens = THEME_TOKENS[theme];
  root.style.setProperty('--bg', tokens.bg);
  root.style.setProperty('--surface', tokens.surface);
  root.style.setProperty('--text', tokens.text);
  root.style.setProperty('--accent', tokens.accent);
  root.style.setProperty('--accent-soft', tokens.accentSoft);
}
