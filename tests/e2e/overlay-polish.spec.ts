/**
 * overlay-polish.spec.ts — issue #52 (PART A + C + D bundle)
 *
 * Browser-realistic coverage for the overlay polish bundle:
 *   - PART A: alignment setting wired to host data-alignment attribute,
 *     live-switchable via subscribeSettings.
 *   - PART C: chunk-mode renders per-word ORP markers (.focus per word,
 *     not one per joined chunk-text).
 *   - PART D: scrubber auto-hides on play, returns on pause / hover /
 *     focus, AND axe-core scan is clean across all states.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

const ARTICLE_WORDS = ['Hello.', 'How', 'are', 'you?', 'I', 'am', 'fine.', 'Bye!'];

test.describe('Overlay polish bundle (#52)', () => {
  test('PART A — alignment setting drives data-alignment host attribute and live-updates', async ({
    page,
  }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: BUNDLE_PATH });
    const observed = await page.evaluate((words) => {
      type OverlayMod = {
        createOverlay: (o: Record<string, unknown>) => { mount(): void; unmount(): void };
      };
      type RsvpMod = { createRsvpEngine: (o: Record<string, unknown>) => unknown };
      const overlayMod = (window as unknown as { __speedreader_overlay__: OverlayMod })
        .__speedreader_overlay__;
      const rsvpMod = (window as unknown as { __speedreader_rsvp__: RsvpMod }).__speedreader_rsvp__;
      type Pusher = (s: Record<string, unknown>) => void;
      const pushHolder: { fn: Pusher | null } = { fn: null };
      const overlay = overlayMod.createOverlay({
        doc: document,
        words,
        initialSettings: { theme: 'light', wpm: 300, fontSize: 20, alignment: 'orp' },
        subscribeSettings: (listener: Pusher) => {
          pushHolder.fn = listener;
          return () => undefined;
        },
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
      const host = document.querySelector('[data-speedreader-overlay]');
      const mountAttr = host?.getAttribute('data-alignment') ?? null;
      // Live push: flip to center.
      pushHolder.fn?.({ theme: 'light', wpm: 300, fontSize: 20, alignment: 'center' });
      const afterPushAttr = host?.getAttribute('data-alignment') ?? null;
      return { mountAttr, afterPushAttr };
    }, ARTICLE_WORDS);
    expect(observed.mountAttr).toBe('orp');
    expect(observed.afterPushAttr).toBe('center');
  });

  test('PART C — chunk mode emission renders one .focus span per chunk word', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: BUNDLE_PATH });
    // Stream starts with a non-sentence-end token so the first chunkSize=2
    // emission groups two words together ("The" + "quick") — a stream like
    // ['Hello.', …] would force a sentence-boundary chunk break and the
    // first chunk would be the single token "Hello.".
    const CHUNK_STREAM = ['The', 'quick', 'brown', 'fox.', 'Stop.'];
    const focusCount = await page.evaluate((words) => {
      type OverlayMod = {
        createOverlay: (o: Record<string, unknown>) => { mount(): void };
      };
      type RsvpMod = { createRsvpEngine: (o: Record<string, unknown>) => unknown };
      const overlayMod = (window as unknown as { __speedreader_overlay__: OverlayMod })
        .__speedreader_overlay__;
      const rsvpMod = (window as unknown as { __speedreader_rsvp__: RsvpMod }).__speedreader_rsvp__;
      const overlay = overlayMod.createOverlay({
        doc: document,
        words,
        initialSettings: { theme: 'light', wpm: 60, fontSize: 20, chunkSize: 2 },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
      const host = document.querySelector('[data-speedreader-overlay]');
      const region = host?.shadowRoot?.querySelector('.word-region');
      return region?.querySelectorAll('.focus').length ?? 0;
    }, CHUNK_STREAM);
    // chunkSize=2 over ['The', 'quick', …] → first chunk = ['The', 'quick']
    // → 2 .word-run wrappers → 2 .focus spans (one per word).
    expect(focusCount).toBe(2);
  });

  test('PART D — scrubber auto-hides on play and becomes visible on pause', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: BUNDLE_PATH });
    const observed = await page.evaluate((words) => {
      type OverlayMod = {
        createOverlay: (o: Record<string, unknown>) => { mount(): void };
      };
      type RsvpMod = { createRsvpEngine: (o: Record<string, unknown>) => unknown };
      const overlayMod = (window as unknown as { __speedreader_overlay__: OverlayMod })
        .__speedreader_overlay__;
      const rsvpMod = (window as unknown as { __speedreader_rsvp__: RsvpMod }).__speedreader_rsvp__;
      const overlay = overlayMod.createOverlay({
        doc: document,
        words,
        initialSettings: { theme: 'light', wpm: 60, fontSize: 20 },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
      const host = document.querySelector('[data-speedreader-overlay]');
      const root = (host as HTMLElement | null)?.shadowRoot;
      const area = root?.querySelector('.scrubber-area') as HTMLElement | null;
      const playPause = root?.querySelector('.play-pause-btn') as HTMLButtonElement | null;
      if (!area || !playPause) return null;
      const playingHidden = area.dataset.hidden;
      playPause.click(); // pause
      const pausedHidden = area.dataset.hidden;
      return { playingHidden, pausedHidden };
    }, ARTICLE_WORDS);
    expect(observed).not.toBeNull();
    expect(observed?.playingHidden).toBe('true');
    expect(observed?.pausedHidden).toBe('false');
  });

  test('axe-core is clean across all states (orp, paused with scrubber visible)', async ({
    page,
  }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: BUNDLE_PATH });
    await page.evaluate((words) => {
      type OverlayMod = {
        createOverlay: (o: Record<string, unknown>) => { mount(): void };
      };
      type RsvpMod = { createRsvpEngine: (o: Record<string, unknown>) => unknown };
      const overlayMod = (window as unknown as { __speedreader_overlay__: OverlayMod })
        .__speedreader_overlay__;
      const rsvpMod = (window as unknown as { __speedreader_rsvp__: RsvpMod }).__speedreader_rsvp__;
      const overlay = overlayMod.createOverlay({
        doc: document,
        words,
        initialSettings: { theme: 'light', wpm: 300, fontSize: 20, alignment: 'orp' },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
      // Pause so scrubber is visible for axe.
      const host = document.querySelector('[data-speedreader-overlay]');
      const playPause = host?.shadowRoot?.querySelector(
        '.play-pause-btn',
      ) as HTMLButtonElement | null;
      playPause?.click();
    }, ARTICLE_WORDS);
    const results = await new AxeBuilder({ page }).include('[data-speedreader-overlay]').analyze();
    expect(results.violations).toEqual([]);
  });
});
