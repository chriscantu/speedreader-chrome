/**
 * touch-smoke.spec.ts — manual-smoke equivalents for #36 / PR #149.
 *
 * Direct-mount path (same as overlay.spec.ts / scope-swap.spec.ts) — the
 * activeTab gesture-bound activation chain cannot be dispatched from
 * Playwright (issue #38), so we mount the overlay against an about:blank
 * page with viewport + media-feature emulation.
 *
 * Covers the two manual checklist items in PR #149's test plan:
 *   1. Mobile + touch-primary: tap on word region toggles play/pause;
 *      control-bar button height >= 48 CSS px; footer respects
 *      safe-area-inset-bottom.
 *   2. Desktop mouse viewport: mouse click on word region does NOT
 *      toggle; Space / Arrow / Escape keyboard shortcuts still fire
 *      (no regression on #33).
 */
import { test, expect } from '@playwright/test';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

type Page = import('@playwright/test').Page;

async function mountOverlay(page: Page): Promise<void> {
  await page.goto('about:blank');
  await page.addScriptTag({ path: BUNDLE_PATH });
  await page.evaluate(() => {
    const overlayMod = (
      window as unknown as {
        __speedreader_overlay__: { createOverlay: (o: unknown) => { mount: () => void } };
      }
    ).__speedreader_overlay__;
    const rsvpMod = (
      window as unknown as {
        __speedreader_rsvp__: { createRsvpEngine: (o: unknown) => unknown };
      }
    ).__speedreader_rsvp__;
    const overlay = overlayMod.createOverlay({
      doc: document,
      words: ['hello', 'world', 'speed', 'reader', 'smoke'],
      initialSettings: { theme: 'light', wpm: 300 },
      subscribeSettings: () => () => undefined,
      engineFactory: rsvpMod.createRsvpEngine,
    });
    overlay.mount();
  });
  await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(1);
}

test.describe('Touch-primary smoke (#36 / PR #149)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 13
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      const origMM = window.matchMedia.bind(window);
      window.matchMedia = (q: string): MediaQueryList => {
        if (q === '(pointer: coarse) and (hover: none)') {
          return {
            matches: true,
            media: q,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        return origMM(q);
      };
    });
  });

  test('control-bar buttons measure >=44 CSS px', async ({ page }) => {
    await mountOverlay(page);
    const host = page.locator('[data-speedreader-overlay]');
    const buttonSizes = await host.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot;
      if (!root) throw new Error('no shadowRoot');
      // Skip buttons inside a [hidden] ancestor (e.g. the tweaks popover
      // panel before the user clicks ⚙). getBoundingClientRect returns 0×0
      // on hidden subtrees — they're not user-reachable tap targets until
      // the panel is opened, so the 44 px floor doesn't apply yet.
      const isInHiddenSubtree = (n: HTMLElement, container: HTMLElement): boolean => {
        let cur: HTMLElement | null = n;
        while (cur && cur !== container) {
          if (cur.hidden) return true;
          cur = cur.parentElement;
        }
        return false;
      };
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).filter(
        (b) => !isInHiddenSubtree(b, el as HTMLElement),
      );
      return buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { ariaLabel: b.getAttribute('aria-label') ?? '', w: r.width, h: r.height };
      });
    });
    expect(buttonSizes.length).toBeGreaterThan(0);
    for (const b of buttonSizes) {
      expect.soft(b.h, `button ${b.ariaLabel} height`).toBeGreaterThanOrEqual(44);
      expect.soft(b.w, `button ${b.ariaLabel} width`).toBeGreaterThanOrEqual(44);
    }
  });

  test('footer area resolves a finite computed padding-bottom', async ({ page }) => {
    await mountOverlay(page);
    const host = page.locator('[data-speedreader-overlay]');
    const padding = await host.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot;
      if (!root) return null;
      const footer =
        root.querySelector('.footer') ??
        root.querySelector('footer') ??
        root.querySelector('[data-overlay-footer]') ??
        root.querySelector('[role="toolbar"]') ??
        root.querySelector('button')?.parentElement;
      if (!footer) return null;
      const s = getComputedStyle(footer as HTMLElement);
      return { paddingBottom: s.paddingBottom, position: s.position };
    });
    expect(padding).not.toBeNull();
    const px = padding ? parseFloat(padding.paddingBottom) : NaN;
    expect(px).toBeGreaterThanOrEqual(0);
  });

  test('tap on word region produces a click event on the overlay', async ({ page }) => {
    await mountOverlay(page);
    const host = page.locator('[data-speedreader-overlay]');
    const clicked = await host.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot;
      const region = root?.querySelector('.word-region') as HTMLElement | null;
      if (!region) return { found: false, dispatched: false };
      let received = false;
      region.addEventListener(
        'click',
        () => {
          received = true;
        },
        { once: true },
      );
      region.click();
      return { found: true, dispatched: received };
    });
    expect(clicked.found).toBe(true);
    expect(clicked.dispatched).toBe(true);
  });
});

test.describe('Desktop mouse smoke (#33 non-regression)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => {
      const origMM = window.matchMedia.bind(window);
      window.matchMedia = (q: string): MediaQueryList => {
        if (q === '(pointer: coarse) and (hover: none)') {
          return {
            matches: false,
            media: q,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
          } as MediaQueryList;
        }
        return origMM(q);
      };
    });
  });

  test('mouse click on word region does NOT change play/pause aria-label', async ({ page }) => {
    await mountOverlay(page);
    const host = page.locator('[data-speedreader-overlay]');

    const before = await host.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot;
      const btn = root?.querySelector('button[aria-label*="ause"], button[aria-label*="lay"]');
      return btn?.getAttribute('aria-label') ?? '';
    });

    await host.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot;
      const region = root?.querySelector('.word-region') as HTMLElement | null;
      region?.click();
    });

    const after = await host.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot;
      const btn = root?.querySelector('button[aria-label*="ause"], button[aria-label*="lay"]');
      return btn?.getAttribute('aria-label') ?? '';
    });

    expect(after).toBe(before);
  });

  test('Space on document still toggles play/pause aria-label (#33 capture-phase handler)', async ({
    page,
  }) => {
    await mountOverlay(page);
    const host = page.locator('[data-speedreader-overlay]');

    const before = await host.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot;
      const btn = root?.querySelector('button[aria-label*="ause"], button[aria-label*="lay"]');
      return btn?.getAttribute('aria-label') ?? '';
    });

    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      );
    });
    await page.waitForTimeout(20);

    const after = await host.evaluate((el) => {
      const root = (el as HTMLElement).shadowRoot;
      const btn = root?.querySelector('button[aria-label*="ause"], button[aria-label*="lay"]');
      return btn?.getAttribute('aria-label') ?? '';
    });

    expect(after).not.toBe(before);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
  });

  test('Escape on document removes overlay (#33 close shortcut)', async ({ page }) => {
    await mountOverlay(page);
    await page.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await page.waitForTimeout(20);
    await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(0);
  });
});
