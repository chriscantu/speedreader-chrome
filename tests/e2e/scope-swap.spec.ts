/**
 * scope-swap.spec.ts — end-to-end behavioural coverage for the
 * scoped mini-modal contract from
 * `docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 * §"Scoped Mini-Modal Contract".
 *
 * Direct-mount path (same as `overlay.spec.ts`): the activeTab
 * gesture-bound activation chain cannot be dispatched from Playwright
 * (issue #38 / playpause.spec.ts), so we load the core overlay bundle
 * onto an about:blank page and drive `createOverlay` directly with
 * scope-aware options. This exercises the shadow DOM, the scope-swap
 * state machine, and the empty-selection fallback without depending
 * on the SW/CS handshake.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

type Page = import('@playwright/test').Page;

interface MountInput {
  scope: 'selection' | 'full';
  selectionWords: string[];
  fullWords: string[];
  articleTitle?: string;
  wpm?: number;
}

async function mountScopedOverlay(page: Page, input: MountInput): Promise<void> {
  await page.goto('about:blank');
  await page.addScriptTag({ path: BUNDLE_PATH });
  await page.evaluate((opts) => {
    const overlayMod = (
      window as unknown as {
        __speedreader_overlay__: { createOverlay: (o: unknown) => { mount(): void } };
      }
    ).__speedreader_overlay__;
    const rsvpMod = (
      window as unknown as { __speedreader_rsvp__: { createRsvpEngine: (o: unknown) => unknown } }
    ).__speedreader_rsvp__;
    const overlay = overlayMod.createOverlay({
      doc: document,
      words: opts.fullWords,
      scope: opts.scope,
      selectionWords: opts.selectionWords,
      fullWords: opts.fullWords,
      articleTitle: opts.articleTitle,
      initialSettings: { theme: 'light', wpm: opts.wpm ?? 300 },
      subscribeSettings: () => () => undefined,
      engineFactory: rsvpMod.createRsvpEngine,
    });
    overlay.mount();
  }, input);
}

function shadowHeaderText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-speedreader-overlay]') as HTMLElement | null;
    return host?.shadowRoot?.querySelector('#sr-scope-header')?.textContent ?? '';
  });
}

function shadowQuery(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const host = document.querySelector('[data-speedreader-overlay]') as HTMLElement | null;
    return !!host?.shadowRoot?.querySelector(sel);
  }, selector);
}

function shadowAttr(page: Page, selector: string, attr: string): Promise<string | null> {
  return page.evaluate(
    ({ sel, a }) => {
      const host = document.querySelector('[data-speedreader-overlay]') as HTMLElement | null;
      const el = host?.shadowRoot?.querySelector(sel);
      return el?.getAttribute(a) ?? null;
    },
    { sel: selector, a: attr },
  );
}

function shadowText(page: Page, selector: string): Promise<string> {
  return page.evaluate((sel) => {
    const host = document.querySelector('[data-speedreader-overlay]') as HTMLElement | null;
    return host?.shadowRoot?.querySelector(sel)?.textContent ?? '';
  }, selector);
}

async function clickInShadow(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const host = document.querySelector('[data-speedreader-overlay]') as HTMLElement | null;
    const el = host?.shadowRoot?.querySelector<HTMLButtonElement>(sel);
    el?.click();
  }, selector);
}

async function activeShadowElementClass(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-speedreader-overlay]') as HTMLElement | null;
    const active = host?.shadowRoot?.activeElement as HTMLElement | null;
    return active?.className ?? '';
  });
}

test.describe('Scoped mini-modal contract (#131)', () => {
  test('scope="selection" mount: SELECTION header + ← Full article + play/pause focused', async ({
    page,
  }) => {
    await mountScopedOverlay(page, {
      scope: 'selection',
      selectionWords: Array.from({ length: 42 }, (_, i) => `w${i}`),
      fullWords: Array.from({ length: 100 }, (_, i) => `f${i}`),
      articleTitle: 'How Bees Find Flowers',
      wpm: 300,
    });

    const header = await shadowHeaderText(page);
    expect(header).toMatch(/SELECTION · 42 words · ~8 sec/);
    expect(await shadowQuery(page, '.scope-swap-btn')).toBe(true);
    expect(await activeShadowElementClass(page)).toContain('play-pause-btn');
  });

  test('click ← Full article rewrites header, removes swap button, focuses play/pause, paused', async ({
    page,
  }) => {
    await mountScopedOverlay(page, {
      scope: 'selection',
      selectionWords: ['lorem', 'ipsum', 'dolor'],
      fullWords: Array.from({ length: 20 }, (_, i) => `full${i}`),
      articleTitle: 'How Bees Find Flowers',
      wpm: 300,
    });

    await clickInShadow(page, '.scope-swap-btn');

    expect(await shadowHeaderText(page)).toBe('How Bees Find Flowers');
    expect(await shadowQuery(page, '.scope-swap-btn')).toBe(false);
    expect(await shadowAttr(page, '.play-pause-btn', 'aria-pressed')).toBe('false');
    expect(await shadowText(page, '.play-pause-btn')).toMatch(/▶/);
    expect(await activeShadowElementClass(page)).toContain('play-pause-btn');
    expect(await shadowText(page, '.aria-live')).toBe(
      'Expanded to full article. Restarting from word 1 of 20. Paused.',
    );
  });

  test('empty selection fallback: subtitle visible, no swap button, polite announce', async ({
    page,
  }) => {
    await mountScopedOverlay(page, {
      scope: 'selection',
      selectionWords: [],
      fullWords: ['fa', 'fb', 'fc'],
      articleTitle: 'Title',
      wpm: 300,
    });

    expect(await shadowQuery(page, '.scope-swap-btn')).toBe(false);
    expect(await shadowText(page, '.scope-subtitle')).toBe(
      'No selection detected. Reading full article instead.',
    );
    expect(await shadowText(page, '.aria-live')).toBe(
      'No selection detected. Reading full article instead.',
    );
  });

  test('Space key toggles play/pause (initial playing → paused)', async ({ page }) => {
    await mountScopedOverlay(page, {
      scope: 'selection',
      selectionWords: ['a', 'b', 'c', 'd'],
      fullWords: ['x'],
      articleTitle: 'T',
      wpm: 300,
    });

    expect(await shadowAttr(page, '.play-pause-btn', 'aria-pressed')).toBe('true');
    await page.keyboard.press('Space');
    expect(await shadowAttr(page, '.play-pause-btn', 'aria-pressed')).toBe('false');
    await page.keyboard.press('Space');
    expect(await shadowAttr(page, '.play-pause-btn', 'aria-pressed')).toBe('true');
  });

  test('axe-core scan passes on the scoped modal', async ({ page }) => {
    await mountScopedOverlay(page, {
      scope: 'selection',
      selectionWords: ['lorem', 'ipsum'],
      fullWords: ['x', 'y', 'z'],
      articleTitle: 'Article Title',
      wpm: 300,
    });

    const results = await new AxeBuilder({ page })
      .include('[data-speedreader-overlay]')
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
});
