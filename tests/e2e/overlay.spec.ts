/**
 * overlay.spec.ts — axe-core scan against a programmatically-mounted overlay.
 *
 * The activeTab gesture-bound activation path (issue #38) cannot be
 * dispatched from Playwright, so we mount the overlay directly via the
 * core/overlay module loaded in a fixture page. This exercises the
 * shadow DOM, tokens, focus trap, and aria-live without depending on
 * the SW/CS activation handshake.
 *
 * Restore the activation-path coverage once the CDP activation bridge
 * lands (#38 / #142 follow-up).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

async function mountOverlay(page: import('@playwright/test').Page, words: string[]): Promise<void> {
  await page.goto('about:blank');
  await page.addScriptTag({ path: BUNDLE_PATH });
  await page.evaluate((w) => {
    const overlayMod = (window as unknown as { __speedreader_overlay__: { createOverlay: (o: unknown) => { mount(): void } } }).__speedreader_overlay__;
    const rsvpMod = (window as unknown as { __speedreader_rsvp__: { createRsvpEngine: (o: unknown) => unknown } }).__speedreader_rsvp__;
    const overlay = overlayMod.createOverlay({
      doc: document,
      words: w,
      initialSettings: { theme: 'light', wpm: 300 },
      subscribeSettings: () => () => undefined,
      engineFactory: rsvpMod.createRsvpEngine,
    });
    overlay.mount();
  }, words);
}

test.describe('Overlay MVP (#19)', () => {
  test('axe-core scan passes inside the shadow root', async ({ page }) => {
    await mountOverlay(page, ['hello', 'world', 'reader']);
    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(1);
    const results = await new AxeBuilder({ page })
      .include('[data-speedreader-overlay]')
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test('Escape teardown removes the host element', async ({ page }) => {
    await mountOverlay(page, ['x']);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(0);
  });
});
