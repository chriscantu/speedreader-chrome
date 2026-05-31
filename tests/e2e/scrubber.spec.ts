/**
 * scrubber.spec.ts — issue #47
 *
 * Browser-realistic coverage for the progress scrubber. Same programmatic
 * mount pattern as `chunk-mode.spec.ts` (`createOverlay` + the test
 * bundle); we drive the scrubber via DOM events and assert the visible
 * word region + time labels update, then run axe-core for a11y regression
 * coverage on the new control.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BUNDLE_PATH = 'dist-e2e/core-overlay-bundle.js';

const ARTICLE_WORDS = [
  'Hello.',
  'How',
  'are',
  'you?',
  'I',
  'am',
  'fine.',
  'Bye!',
  'See',
  'you.',
];

test.describe('Overlay scrubber (#47)', () => {
  test('input event jumps engine to the new index and updates word region + time labels', async ({
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
        // wpm=60 ⇒ msPerWord=1000ms so we have time to settle without
        // the engine ticking past our target before the input event lands.
        initialSettings: { theme: 'light', wpm: 60, fontSize: 20 },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
    }, ARTICLE_WORDS);

    // Drive the scrubber via JS to ensure the `input` event fires inside
    // the shadow root. Playwright's high-level locators can't see into
    // closed shadow trees uniformly across browsers, but `dispatchEvent`
    // from an explicit shadowRoot.querySelector works in every engine.
    const sliderObserved = await page.evaluate(() => {
      const host = document.querySelector('[data-speedreader-overlay]');
      const root = (host as HTMLElement | null)?.shadowRoot ?? null;
      if (!root) return null;
      const slider = root.querySelector('input.scrubber-slider') as HTMLInputElement | null;
      const region = root.querySelector('.word-region') as HTMLElement | null;
      const elapsed = root.querySelector('.scrubber-elapsed') as HTMLElement | null;
      const remaining = root.querySelector('.scrubber-remaining') as HTMLElement | null;
      if (!slider || !region || !elapsed || !remaining) return null;
      slider.value = '4';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        sliderValue: slider.value,
        sliderAria: slider.getAttribute('aria-valuetext') ?? '',
        wordText: region.textContent ?? '',
        elapsedText: elapsed.textContent ?? '',
        remainingText: remaining.textContent ?? '',
      };
    });

    expect(sliderObserved).not.toBeNull();
    // scrubber value reflects the just-emitted word's raw position
    // (see overlay scrubber.test.ts engine-quirk note). target=4 in
    // paused-state seekTo emits at nextIndex=4, value=max(0,4-1)=3.
    expect(sliderObserved?.sliderValue).toBe('3');
    expect(sliderObserved?.wordText).toBe(ARTICLE_WORDS[4]);
    // wpm=60 ⇒ 1s per word. progress.index=4 ⇒ elapsed=4s, remaining=6s.
    expect(sliderObserved?.elapsedText).toBe('0:04');
    expect(sliderObserved?.remainingText).toBe('-0:06');
    expect(sliderObserved?.sliderAria).toBe('0:04 elapsed, 0:06 remaining');
  });

  test('axe-core finds no a11y violations on the mounted overlay with scrubber', async ({
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
        initialSettings: { theme: 'light', wpm: 300, fontSize: 20 },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
    }, ARTICLE_WORDS);

    const results = await new AxeBuilder({ page })
      .include('[data-speedreader-overlay]')
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
