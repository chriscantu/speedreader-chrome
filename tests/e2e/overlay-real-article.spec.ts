/**
 * overlay-real-article.spec.ts — manual-verification proxy (#19).
 *
 * Mounts the core/overlay against three real-world articles to verify
 * shadow-DOM CSS isolation in the wild, screenshots each result, and
 * runs axe-core in the live shadow subtree. NOT part of the standard
 * CI gate — network-dependent and may flake on third-party site
 * changes. Run on demand:
 *
 *   npm run build:e2e-bundle
 *   npx playwright test tests/e2e/overlay-real-article.spec.ts
 *
 * Screenshots land in test-results/. Review them to verify:
 *   - overlay centered on viewport, dim backdrop covers page
 *   - word region legible (host CSS not leaking in)
 *   - ORP letter visibly highlighted (--accent color)
 *   - Esc key tears down, returns focus
 *   - no horizontal scroll
 *
 * Restore activation-path coverage once the CDP gesture bridge lands (#38).
 */
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

// Network-dependent; opt-in only. Run locally with RUN_REAL_ARTICLE=1.
test.skip(
  !process.env.RUN_REAL_ARTICLE,
  'Network-dependent real-article spec — set RUN_REAL_ARTICLE=1 to run',
);

async function mountOnRealPage(page: Page, words: string[] | null = null): Promise<void> {
  // Use addInitScript so the bundle lands via CDP before any page scripts,
  // bypassing host CSP (which blocks addScriptTag on strict sites like MDN).
  // Production content scripts run in the isolated world and are exempt from
  // host CSP per MV3 spec; this matches that behaviour for the test proxy.
  await page.addInitScript({ path: BUNDLE_PATH });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate((w) => {
    const overlayMod = (
      window as unknown as { __speedreader_overlay__: { createOverlay: (o: unknown) => { mount(): void } } }
    ).__speedreader_overlay__;
    const rsvpMod = (
      window as unknown as { __speedreader_rsvp__: { createRsvpEngine: (o: unknown) => unknown } }
    ).__speedreader_rsvp__;

    // Use real article text if no words override; tokenize via split on
    // whitespace (good enough for visual verification — production uses
    // core/tokenize via content/index.ts).
    const text = w ?? (document.body?.innerText ?? '').split(/\s+/).filter(Boolean).slice(0, 200);
    if (text.length === 0) throw new Error('no words extracted from page');

    const overlay = overlayMod.createOverlay({
      doc: document,
      words: text,
      initialSettings: { theme: 'light', wpm: 200 },
      subscribeSettings: () => () => undefined,
      engineFactory: rsvpMod.createRsvpEngine,
    });
    overlay.mount();
  }, words);
  // Let the first tick render.
  await page.waitForTimeout(150);
}

const CASES = [
  {
    name: 'wikipedia-rsvp',
    url: 'https://en.wikipedia.org/wiki/Rapid_serial_visual_presentation',
  },
  {
    name: 'mdn-html',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTML',
  },
  {
    name: 'example-com',
    url: 'https://example.com',
  },
];

for (const c of CASES) {
  test(`overlay mounts cleanly on ${c.name}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await mountOnRealPage(page);

    // Host present, single instance.
    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(1);

    // Visual screenshot for review.
    await page.screenshot({
      path: `test-results/overlay-${c.name}-mounted.png`,
      fullPage: false,
    });

    // axe scan against the shadow subtree (open mode = pierceable).
    const results = await new AxeBuilder({ page })
      .include('[data-speedreader-overlay]')
      .analyze();
    if (results.violations.length > 0) {
      console.warn(
        `[${c.name}] axe violations:\n${JSON.stringify(results.violations, null, 2)}`,
      );
    }
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);

    // Esc teardown + screenshot of post-teardown page.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(0);
    await page.screenshot({
      path: `test-results/overlay-${c.name}-after-esc.png`,
      fullPage: false,
    });
  });
}
