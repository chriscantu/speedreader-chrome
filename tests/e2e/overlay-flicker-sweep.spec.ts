/**
 * overlay-flicker-sweep.spec.ts — visual confirmation sweep for issue #209.
 *
 * Issue #209 triage was a STATIC code trace: 8 candidate flicker/stability
 * areas audited, 1 confirmed bug (#218 resume-toast, since fixed + covered by
 * resume-toast-layout-shift.spec.ts), 7 declared clean. The triage method note
 * asked for a cheap visual pass before closing. This spec is that pass.
 *
 * Flicker proxy: a flicker that the user perceives as a "jump" is a layout
 * shift of the word region. For each live-update path we mount the overlay,
 * record `.word-region` bounding-box top, drive the change, and assert the
 * top does NOT move (<= 0.5px rounding tolerance). Before/after screenshots
 * are attached as the visual record. This confirms the static verdicts:
 * live settings updates mutate in place (class flip / attr write / atomic
 * replaceChildren) and never rebuild or reflow the word region's position.
 *
 * Coverage map vs the 8 triage areas:
 *   1 WPM live-update      -> wpm push test
 *   2 Theme switch         -> theme push test
 *   3 Font change          -> font push test
 *   4 chunkSize live-update -> chunkSize push test
 *   5 Scope-swap           -> covered by scope-swap.spec.ts (not duplicated)
 *   6 Resume-toast dismiss -> covered by resume-toast-layout-shift.spec.ts
 *   7 Scrubber visibility  -> play/pause transition test
 *   8 Mount / FOUC         -> synchronous-first-paint test
 *
 * Mount path mirrors overlay-polish.spec.ts: load the prebuilt core-overlay
 * bundle into about:blank, call createOverlay directly, and drive live
 * settings via a captured subscribeSettings listener (push holder).
 */
import { test, expect } from '@playwright/test';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

// 60 words so the engine has runway and a steady single-word render.
const WORDS = Array.from({ length: 60 }, (_, i) => `word${i}`);

type Settings = {
  theme: 'light' | 'dark' | 'system';
  wpm: number;
  fontSize: number;
  chunkSize: 1 | 2 | 3;
  alignment: 'orp' | 'center';
  font: 'system' | 'opendyslexic' | 'newYork' | 'georgia' | 'menlo';
};

const BASE: Settings = {
  theme: 'light',
  wpm: 300,
  fontSize: 20,
  chunkSize: 1,
  alignment: 'orp',
  font: 'system',
};

type Win = Window &
  typeof globalThis & {
    __speedreader_overlay__: {
      createOverlay: (o: Record<string, unknown>) => { mount(): void };
    };
    __speedreader_rsvp__: {
      createRsvpEngine: (o: Record<string, unknown>) => unknown;
    };
    __sr_push?: (s: Settings) => void;
  };

async function mount(
  page: import('@playwright/test').Page,
  overrides: Partial<Settings> = {},
): Promise<void> {
  await page.goto('about:blank');
  await page.addScriptTag({ path: BUNDLE_PATH });
  await page.evaluate(
    ({ words, settings }) => {
      const w = window as Win;
      const holder: { fn: ((s: unknown) => void) | null } = { fn: null };
      w.__sr_push = (s) => holder.fn?.(s);
      const overlay = w.__speedreader_overlay__.createOverlay({
        doc: document,
        words,
        initialSettings: settings,
        subscribeSettings: (listener: (s: unknown) => void) => {
          holder.fn = listener;
          return () => undefined;
        },
        engineFactory: w.__speedreader_rsvp__.createRsvpEngine,
      });
      overlay.mount();
    },
    { words: WORDS, settings: { ...BASE, ...overrides } },
  );
  await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(1);
}

// Pierce the shadow root and read `.word-region` box top. Null if absent.
async function wordRegionTop(page: import('@playwright/test').Page): Promise<number | null> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-speedreader-overlay]')?.shadowRoot ?? null;
    const wr = root?.querySelector('.word-region') as HTMLElement | null;
    return wr ? wr.getBoundingClientRect().top : null;
  });
}

async function push(page: import('@playwright/test').Page, next: Settings): Promise<void> {
  await page.evaluate((s) => {
    (window as Win).__sr_push?.(s as Settings);
  }, next);
}

// Shared shape: mount, measure top, screenshot, push change, measure top,
// screenshot, assert the word region did not move.
async function assertNoShiftOnPush(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  label: string,
  mountOverrides: Partial<Settings>,
  pushSettings: Settings,
): Promise<void> {
  await mount(page, mountOverrides);

  const before = await wordRegionTop(page);
  expect(before, 'word-region must exist before push').not.toBeNull();
  await page.screenshot({ path: `/tmp/flicker-${label}-before.png` });

  await push(page, pushSettings);
  // One frame for any CSS recalc / reflow to settle.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );

  const after = await wordRegionTop(page);
  expect(after, 'word-region must still exist after push').not.toBeNull();
  await page.screenshot({ path: `/tmp/flicker-${label}-after.png` });

  const shift = Math.abs((after as number) - (before as number));
  await testInfo.attach(`${label}-shift`, {
    body: JSON.stringify({ label, topBefore: before, topAfter: after, shiftPx: shift }, null, 2),
    contentType: 'application/json',
  });
  expect(shift, `${label}: word-region top must not move`).toBeLessThanOrEqual(0.5);
}

test.describe('Overlay flicker sweep (#209 visual confirmation)', () => {
  test('1 — WPM live-update does not shift the word region', async ({ page }, testInfo) => {
    await assertNoShiftOnPush(page, testInfo, 'wpm', { wpm: 300 }, { ...BASE, wpm: 600 });
  });

  test('2 — theme switch (light->dark) does not shift the word region', async ({
    page,
  }, testInfo) => {
    await assertNoShiftOnPush(
      page,
      testInfo,
      'theme',
      { theme: 'light' },
      { ...BASE, theme: 'dark' },
    );
  });

  test('3 — font change (system->opendyslexic) does not shift the word region', async ({
    page,
  }, testInfo) => {
    await assertNoShiftOnPush(
      page,
      testInfo,
      'font',
      { font: 'system' },
      { ...BASE, font: 'opendyslexic' },
    );
  });

  test('4 — chunkSize live-update (1->2) does not shift the word region', async ({
    page,
  }, testInfo) => {
    await assertNoShiftOnPush(
      page,
      testInfo,
      'chunksize',
      { chunkSize: 1 },
      { ...BASE, chunkSize: 2 },
    );
  });

  test('7 — scrubber visibility transition (play->pause) does not shift the word region', async ({
    page,
  }, testInfo) => {
    await mount(page);

    const before = await wordRegionTop(page);
    expect(before, 'word-region must exist before play').not.toBeNull();
    await page.screenshot({ path: '/tmp/flicker-scrubber-before.png' });

    // Drive the real play/pause path: the scrubber auto-hides on play and
    // returns on pause via an opacity transition. Click twice (play, pause).
    const clickPlayPause = async (): Promise<void> => {
      await page.evaluate(() => {
        const root = document.querySelector('[data-speedreader-overlay]')?.shadowRoot;
        const btn = root?.querySelector(
          'button.play-pause-btn, [aria-label]',
        ) as HTMLButtonElement | null;
        // The play/pause button is the footer control; prefer the explicit class.
        const explicit = root?.querySelector('.play-pause-btn') as HTMLButtonElement | null;
        (explicit ?? btn)?.click();
      });
    };
    await clickPlayPause(); // play -> scrubber begins auto-hide
    await page.waitForTimeout(400); // let the opacity transition run
    await clickPlayPause(); // pause -> scrubber returns
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    const after = await wordRegionTop(page);
    expect(after, 'word-region must still exist after pause').not.toBeNull();
    await page.screenshot({ path: '/tmp/flicker-scrubber-after.png' });

    const shift = Math.abs((after as number) - (before as number));
    await testInfo.attach('scrubber-shift', {
      body: JSON.stringify({ topBefore: before, topAfter: after, shiftPx: shift }, null, 2),
      contentType: 'application/json',
    });
    expect(shift, 'scrubber play/pause must not move the word region').toBeLessThanOrEqual(0.5);
  });

  test('8 — overlay mount paints the word region synchronously (no FOUC)', async ({ page }) => {
    // Mount, then in the SAME microtask window assert the word region and a
    // rendered glyph are already present — i.e. no empty/transient first paint.
    await page.goto('about:blank');
    await page.addScriptTag({ path: BUNDLE_PATH });
    const present = await page.evaluate((words) => {
      const w = window as unknown as {
        __speedreader_overlay__: {
          createOverlay: (o: Record<string, unknown>) => { mount(): void };
        };
        __speedreader_rsvp__: { createRsvpEngine: (o: Record<string, unknown>) => unknown };
      };
      const overlay = w.__speedreader_overlay__.createOverlay({
        doc: document,
        words,
        initialSettings: { theme: 'light', wpm: 300, fontSize: 20 },
        subscribeSettings: () => () => undefined,
        engineFactory: w.__speedreader_rsvp__.createRsvpEngine,
      });
      overlay.mount();
      // Read immediately after the synchronous mount() returns.
      const root = document.querySelector('[data-speedreader-overlay]')?.shadowRoot ?? null;
      const region = root?.querySelector('.word-region') as HTMLElement | null;
      const glyph = root?.querySelector('.word-region .word-run') as HTMLElement | null;
      return { hasRegion: !!region, hasGlyph: !!glyph };
    }, WORDS);
    await page.screenshot({ path: '/tmp/flicker-mount.png' });
    expect(present.hasRegion, 'word-region present synchronously after mount').toBe(true);
    expect(present.hasGlyph, 'a rendered glyph present synchronously after mount').toBe(true);
  });
});
