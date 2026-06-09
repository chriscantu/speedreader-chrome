/**
 * resume-toast-layout-shift.spec.ts — verification for issue #218 / PR #219.
 *
 * The resume toast (#48) was changed from in-flow to `position: absolute`
 * so its 5 s auto-dismiss / "Start over" removal no longer reflows the
 * word region mid-read. This spec asserts the two contracts:
 *
 *   1. NO LAYOUT SHIFT — `.word-region` bounding-box top (Y) is identical
 *      before the toast goes away and after, on BOTH the auto-dismiss and
 *      Start Over paths. This is the core bug fix.
 *
 *   2. NO VISUAL OVERLAP — while the toast is shown, the toast chip's box
 *      bottom does NOT cover the rendered word glyph's box top. The word
 *      region has 36px top padding; the toast sits over that padding.
 *
 * Mount path mirrors overlay.spec.ts: load the prebuilt core-overlay bundle
 * into about:blank and call createOverlay directly. We pass `initialIndex`
 * + `resumeToast` so the toast renders without seeding chrome.storage.
 */
import { test, expect } from '@playwright/test';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

// 60 words so initialIndex:5 is a valid resumed position with margin.
const WORDS = Array.from({ length: 60 }, (_, i) => `word${i}`);

type Rects = {
  wordRegion: { top: number; bottom: number; left: number; height: number } | null;
  toast: { top: number; bottom: number; left: number; right: number } | null;
  glyph: { top: number; bottom: number } | null;
};

async function mountResumed(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('about:blank');
  await page.addScriptTag({ path: BUNDLE_PATH });
  await page.evaluate((w) => {
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
      words: w,
      initialSettings: { theme: 'light', wpm: 300 },
      subscribeSettings: () => () => undefined,
      engineFactory: rsvpMod.createRsvpEngine,
      // Resume at word 5 of 60 -> toast renders.
      initialIndex: 5,
      resumeToast: { totalWords: w.length },
    });
    overlay.mount();
  }, WORDS);
}

// Pierce the shadow root and read getBoundingClientRect() for the three
// elements of interest.
async function measure(page: import('@playwright/test').Page): Promise<Rects> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-speedreader-overlay]');
    const root = host?.shadowRoot ?? null;
    if (!root) return { wordRegion: null, toast: null, glyph: null };
    const wr = root.querySelector('.word-region') as HTMLElement | null;
    const toast = root.querySelector('[data-sr-resume-toast]') as HTMLElement | null;
    // The rendered word lives in .word-run inside .word-region.
    const glyph = root.querySelector('.word-region .word-run') as HTMLElement | null;
    const r = (el: HTMLElement | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        top: b.top,
        bottom: b.bottom,
        left: b.left,
        right: b.right,
        height: b.height,
      };
    };
    return {
      wordRegion: r(wr),
      toast: r(toast),
      glyph: r(glyph),
    };
  });
}

test.describe('Resume toast layout shift (#218)', () => {
  test('auto-dismiss path: no word-region shift, no glyph overlap', async ({ page }, testInfo) => {
    await mountResumed(page);
    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(1);

    // Toast must be present at this point (mounted-with-resume).
    const before = await measure(page);
    expect(before.wordRegion, 'word-region must exist').not.toBeNull();
    expect(before.toast, 'toast must render on resumed mount').not.toBeNull();
    expect(before.glyph, 'word glyph must render').not.toBeNull();

    await page.screenshot({ path: '/tmp/resume-toast-before-autodismiss.png' });

    // --- OVERLAP CHECK (contract 2) ---
    // The toast box bottom must NOT extend past the glyph box top.
    const clearance =
      (before.glyph as { top: number }).top - (before.toast as { bottom: number }).bottom;

    // Wait out the 5 s auto-dismiss (+ buffer) and confirm the toast is gone.
    await page.waitForFunction(
      () => {
        const root = document.querySelector('[data-speedreader-overlay]')?.shadowRoot;
        return !root?.querySelector('[data-sr-resume-toast]');
      },
      { timeout: 8_000 },
    );

    const after = await measure(page);
    expect(after.toast, 'toast must be gone after auto-dismiss').toBeNull();
    await page.screenshot({ path: '/tmp/resume-toast-after-autodismiss.png' });

    // --- SHIFT CHECK (contract 1) ---
    const beforeTop = (before.wordRegion as { top: number }).top;
    const afterTop = (after.wordRegion as { top: number }).top;
    const shift = Math.abs(afterTop - beforeTop);

    // Emit measured numbers into the test report for the verification record.
    await testInfo.attach('auto-dismiss-measurements', {
      body: JSON.stringify(
        {
          path: 'auto-dismiss',
          wordRegionTopBefore: beforeTop,
          wordRegionTopAfter: afterTop,
          shiftPx: shift,
          toastBottom: (before.toast as { bottom: number }).bottom,
          glyphTop: (before.glyph as { top: number }).top,
          clearancePx: clearance,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    // Sub-pixel tolerance for rounding.
    expect(shift, 'word-region top must not move on auto-dismiss').toBeLessThanOrEqual(0.5);
    expect(clearance, 'toast bottom must not overlap glyph top').toBeGreaterThanOrEqual(0);
  });

  test('Start Over path: no word-region shift, no glyph overlap', async ({ page }, testInfo) => {
    await mountResumed(page);
    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(1);

    const before = await measure(page);
    expect(before.toast, 'toast must render on resumed mount').not.toBeNull();
    expect(before.glyph, 'word glyph must render').not.toBeNull();

    await page.screenshot({ path: '/tmp/resume-toast-before-startover.png' });

    const clearance =
      (before.glyph as { top: number }).top - (before.toast as { bottom: number }).bottom;

    // Click Start Over -> toast removed synchronously.
    const startOver = page.locator('[data-speedreader-overlay]');
    await page.evaluate(() => {
      const root = document.querySelector('[data-speedreader-overlay]')?.shadowRoot;
      const btn = root?.querySelector('[data-sr-start-over]') as HTMLButtonElement | null;
      btn?.click();
    });
    await expect(startOver).toHaveCount(1); // overlay still mounted

    await page.waitForFunction(() => {
      const root = document.querySelector('[data-speedreader-overlay]')?.shadowRoot;
      return !root?.querySelector('[data-sr-resume-toast]');
    });

    const after = await measure(page);
    expect(after.toast, 'toast must be gone after Start Over').toBeNull();
    await page.screenshot({ path: '/tmp/resume-toast-after-startover.png' });

    const beforeTop = (before.wordRegion as { top: number }).top;
    const afterTop = (after.wordRegion as { top: number }).top;
    const shift = Math.abs(afterTop - beforeTop);

    await testInfo.attach('start-over-measurements', {
      body: JSON.stringify(
        {
          path: 'start-over',
          wordRegionTopBefore: beforeTop,
          wordRegionTopAfter: afterTop,
          shiftPx: shift,
          toastBottom: (before.toast as { bottom: number }).bottom,
          glyphTop: (before.glyph as { top: number }).top,
          clearancePx: clearance,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    expect(shift, 'word-region top must not move on Start Over').toBeLessThanOrEqual(0.5);
    expect(clearance, 'toast bottom must not overlap glyph top').toBeGreaterThanOrEqual(0);
  });
});
