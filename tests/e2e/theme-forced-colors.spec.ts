/**
 * theme-forced-colors.spec.ts — real-browser verification of the
 * forced-colors fallback contract (issue #116).
 *
 * Why this spec exists: PR #112 shipped theme tokens + applier + WCAG
 * contrast math, but JSDOM cannot evaluate `@media (forced-colors:
 * active)` cascade overrides nor substitute system color keywords
 * (`Canvas`, `CanvasText`, `Highlight`, `ButtonText`, `ButtonFace`).
 * The applier's forced-colors contract was therefore plausible but
 * unverified. This spec exercises a real Chromium under
 * `page.emulateMedia({ forcedColors: 'active' })` for each of the six
 * themes and asserts that the rendered overlay surfaces resolve to
 * system colors regardless of the theme's hex palette.
 *
 * Target choice (option b from the dispatch): mount the overlay via
 * `dist-e2e/core-overlay-bundle.js` exactly as `overlay.spec.ts` does.
 * Loading the unpacked extension would add no coverage value — the
 * forced-colors substitution happens at the CSS engine level, not at
 * the extension-loader level, and the mounted bundle uses the same
 * `OVERLAY_CSS` (which holds the `@media (forced-colors: active)`
 * block) via `adoptedStyleSheets`.
 *
 * Discriminating signal — non-tautology check (red→green):
 * Chromium under `forced-colors: active` ALREADY substitutes a default
 * high-contrast palette automatically, with or without the `@media`
 * block — `.modal { background: Canvas }` is therefore a refinement,
 * not a gate. A test that only asserts "modal bg becomes a system
 * color" passes even when the `@media` block is deleted, which makes
 * it useless as a regression guard.
 *
 * The block IS load-bearing for non-default substitutions. Concretely,
 * `.word-region .focus { color: Highlight; }` distinguishes the
 * progress-focus character from surrounding text — under
 * forced-colors:active without the block, Chromium substitutes the
 * focus color to plain text color (same as the surrounding text),
 * losing the visual distinction. The discriminating assertion below
 * is therefore: under forced-colors:active, the `.focus` character's
 * color MUST differ from the modal text color, proving the
 * `color: Highlight` rule in the `@media` block applied. This
 * assertion failed when the `@media` query selector was mutated to
 * never match (verified during test authoring); restoring the
 * `(forced-colors: active)` selector flipped it green.
 *
 * Note on contract location: the applier JSDoc names a pattern where
 * `@media (forced-colors: active)` overrides `--bg`, `--text`,
 * `--accent` themselves. The actual implementation in
 * `src/core/overlay/styles.ts` instead overrides component selectors
 * directly. Both patterns achieve the same user-visible behavior; this
 * spec asserts the user-visible behavior on the rendered shadow tree.
 */
import { test, expect, type Page } from '@playwright/test';
import { THEME_IDS } from '../../src/core/theme/tokens';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

async function mountOverlayWithTheme(page: Page, theme: (typeof THEME_IDS)[number]): Promise<void> {
  await page.goto('about:blank');
  await page.addScriptTag({ path: BUNDLE_PATH });
  await page.evaluate(
    ({ t }) => {
      const overlayMod = (
        window as unknown as {
          __speedreader_overlay__: { createOverlay: (o: unknown) => { mount(): void } };
        }
      ).__speedreader_overlay__;
      const rsvpMod = (
        window as unknown as {
          __speedreader_rsvp__: { createRsvpEngine: (o: unknown) => unknown };
        }
      ).__speedreader_rsvp__;
      const overlay = overlayMod.createOverlay({
        doc: document,
        words: ['hello', 'world', 'reader'],
        initialSettings: { theme: t, wpm: 300 },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
    },
    { t: theme },
  );
}

/**
 * Pull computed-style values from a set of shadow-rooted overlay
 * elements in a single page.evaluate round-trip. Returns the
 * resolved CSS color strings (e.g. `rgb(...)`, or a system color
 * keyword that Chromium has substituted with a concrete sRGB triple
 * under forced-colors).
 */
async function readOverlayColors(page: Page): Promise<{
  modalBg: string;
  modalColor: string;
  focusColor: string;
}> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-speedreader-overlay]');
    if (!host) throw new Error('Overlay host not found');
    const shadow = (host as HTMLElement).shadowRoot;
    if (!shadow) throw new Error('Overlay shadow root not found');
    const modal = shadow.querySelector('.modal');
    const focus = shadow.querySelector('.word-region .focus');
    if (!modal) throw new Error('.modal not found in overlay shadow root');
    if (!focus) throw new Error('.word-region .focus not found in overlay shadow root');
    return {
      modalBg: getComputedStyle(modal as Element).backgroundColor,
      modalColor: getComputedStyle(modal as Element).color,
      focusColor: getComputedStyle(focus as Element).color,
    };
  });
}

test.describe('Theme forced-colors fallback (#116)', () => {
  for (const theme of THEME_IDS) {
    test(`theme "${theme}" honors forced-colors:active substitutions`, async ({ page }) => {
      // Baseline (forced-colors: none): the theme's hex palette is in
      // effect. We capture this mostly so a broken mount fails LOUD —
      // empty strings here mean the bundle/markup is wrong before we
      // even reach the forced-colors assertions.
      await page.emulateMedia({ forcedColors: 'none' });
      await mountOverlayWithTheme(page, theme);
      const baseline = await readOverlayColors(page);
      expect(baseline.modalBg, `theme=${theme} baseline modal bg`).toMatch(/^(rgb|rgba|color)\(/);
      expect(baseline.modalColor, `theme=${theme} baseline modal text`).toMatch(
        /^(rgb|rgba|color)\(/,
      );
      expect(baseline.focusColor, `theme=${theme} baseline focus color`).toMatch(
        /^(rgb|rgba|color)\(/,
      );

      // Forced-colors:active on a fresh mount.
      await page.emulateMedia({ forcedColors: 'active' });
      await mountOverlayWithTheme(page, theme);
      const forced = await readOverlayColors(page);

      // Sanity: forced values are non-empty resolved colors.
      expect(forced.modalBg, `theme=${theme} forced modal bg`).toMatch(/^(rgb|rgba|color)\(/);
      expect(forced.modalColor, `theme=${theme} forced modal text`).toMatch(/^(rgb|rgba|color)\(/);
      expect(forced.focusColor, `theme=${theme} forced focus color`).toMatch(/^(rgb|rgba|color)\(/);

      // Cross-theme convergence — under forced-colors:active, every
      // theme MUST resolve the modal surface to the SAME system
      // palette. If two themes diverged, the cascade would still be
      // theme-conditional. We compare to a fresh `light`-theme
      // control mount on the same page (same Chromium forced-colors
      // palette).
      await mountOverlayWithTheme(page, 'light');
      const control = await readOverlayColors(page);
      expect(
        forced.modalBg,
        `theme=${theme}: forced modal bg should match cross-theme control (light)`,
      ).toBe(control.modalBg);
      expect(
        forced.modalColor,
        `theme=${theme}: forced modal text should match cross-theme control (light)`,
      ).toBe(control.modalColor);

      // Discriminating assertion — the `@media (forced-colors:
      // active)` block in OVERLAY_CSS is actually wired and applies.
      // Without the block, `.word-region .focus` color resolves to
      // the same forced text color as the surrounding modal (proven
      // during authoring by mutating the @media selector to never
      // match); with the block's `color: Highlight` rule, focus
      // diverges from modal text. This is the one assertion that
      // catches the regression of someone deleting the @media block.
      expect(
        forced.focusColor,
        `theme=${theme}: focus color must differ from modal text under forced-colors ` +
          `(proves @media (forced-colors: active) { .word-region .focus { color: Highlight } } applied)`,
      ).not.toBe(forced.modalColor);
    });
  }
});
