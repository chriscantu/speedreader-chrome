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

  test('PART C — chunk mode emission renders one .focus span per chunk word (with run count + ORP chars)', async ({
    page,
  }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ path: BUNDLE_PATH });
    // Stream starts with a non-sentence-end token so the first chunkSize=2
    // emission groups two words together ("The" + "quick") — a stream like
    // ['Hello.', …] would force a sentence-boundary chunk break and the
    // first chunk would be the single token "Hello.".
    const CHUNK_STREAM = ['The', 'quick', 'brown', 'fox.', 'Stop.'];
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
        initialSettings: { theme: 'light', wpm: 60, fontSize: 20, chunkSize: 2 },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
      const host = document.querySelector('[data-speedreader-overlay]');
      const region = host?.shadowRoot?.querySelector('.word-region');
      const runs = region?.querySelectorAll('.word-run') ?? [];
      const focusChars: string[] = [];
      runs.forEach((run) => {
        const focus = run.querySelector('.focus');
        focusChars.push(focus?.textContent ?? '');
      });
      return {
        runCount: runs.length,
        focusCount: region?.querySelectorAll('.focus').length ?? 0,
        focusChars,
      };
    }, CHUNK_STREAM);
    // LOW #7 — strengthened assertions. chunkSize=2 over ['The', 'quick', …]
    // → first chunk = ['The', 'quick'] → 2 .word-run wrappers → 2 .focus
    // spans (one per word). Per-word ORP via splitWordAtFocus:
    //   - "The" (stripped len 3) → orp() returns 0 → focus char "T"
    //   - "quick" (stripped len 5) → orp() returns floor(5*0.3)=1 → focus "u"
    expect(observed.runCount).toBe(2);
    expect(observed.focusCount).toBe(2);
    expect(observed.focusChars[0]).toBe('T');
    expect(observed.focusChars[1]).toBe('u');
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

  test('axe-core is clean in chunk-mode-paused state (A11y MED #5)', async ({ page }) => {
    // Chunk mode emits multi-word .word-run siblings; axe must still pass
    // (color contrast on focus chars, ARIA on aria-live, role="dialog", etc).
    await page.goto('about:blank');
    await page.addScriptTag({ path: BUNDLE_PATH });
    const CHUNK_STREAM = ['The', 'quick', 'brown', 'fox.', 'Stop.'];
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
        initialSettings: { theme: 'light', wpm: 60, fontSize: 20, chunkSize: 2 },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
      const host = document.querySelector('[data-speedreader-overlay]');
      const playPause = host?.shadowRoot?.querySelector(
        '.play-pause-btn',
      ) as HTMLButtonElement | null;
      playPause?.click();
    }, CHUNK_STREAM);
    const results = await new AxeBuilder({ page }).include('[data-speedreader-overlay]').analyze();
    expect(results.violations).toEqual([]);
  });

  test('axe-core is clean in center-alignment-paused state (A11y MED #5)', async ({ page }) => {
    // Center alignment uses display: block on .word-run (no grid). Verify
    // the reverted-layout state passes axe — color/contrast on the
    // .focus span should still meet AA against the modal background.
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
        initialSettings: { theme: 'light', wpm: 300, fontSize: 20, alignment: 'center' },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
      const host = document.querySelector('[data-speedreader-overlay]');
      const playPause = host?.shadowRoot?.querySelector(
        '.play-pause-btn',
      ) as HTMLButtonElement | null;
      playPause?.click();
    }, ARTICLE_WORDS);
    const results = await new AxeBuilder({ page }).include('[data-speedreader-overlay]').analyze();
    expect(results.violations).toEqual([]);
  });

  test('axe-core is clean in playing-state with hidden scrubber (A11y MED #5)', async ({
    page,
  }) => {
    // During playback the scrubber-area is visibility:hidden — it MUST
    // not surface in the AT rotor (visibility:hidden removes from
    // accessible tree). Axe should be clean: the hidden region's labels
    // do not create unreachable-name violations because the entire
    // subtree is excluded.
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
      // Engine starts playing by default; the auto-hide recompute runs
      // synchronously inside mount() so the scrubber-area is already in
      // its hidden state when we scan.
    }, ARTICLE_WORDS);
    // Sanity-check scrubber is in hidden state before axe.
    const hidden = await page.evaluate(() => {
      const host = document.querySelector('[data-speedreader-overlay]');
      const area = host?.shadowRoot?.querySelector('.scrubber-area') as HTMLElement | null;
      return area?.dataset.hidden ?? null;
    });
    expect(hidden).toBe('true');
    const results = await new AxeBuilder({ page }).include('[data-speedreader-overlay]').analyze();
    expect(results.violations).toEqual([]);
  });

  test('#211 — scrubberAutoHide:false keeps the scrubber VISIBLE during playback (ADHD anchor)', async ({
    page,
  }) => {
    // Acceptance #211: with the opt-out, the position bar stays visible
    // while the engine is playing so ADHD readers retain a position anchor.
    // Mirrors the hidden-state scan above but flips the gate to false and
    // asserts the scrubber-area is NOT in its hidden state on mount.
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
        initialSettings: {
          theme: 'light',
          wpm: 300,
          fontSize: 20,
          alignment: 'orp',
          scrubberAutoHide: false,
        },
        subscribeSettings: () => () => undefined,
        engineFactory: rsvpMod.createRsvpEngine,
      });
      overlay.mount();
    }, ARTICLE_WORDS);
    const state = await page.evaluate(() => {
      const host = document.querySelector('[data-speedreader-overlay]');
      const area = host?.shadowRoot?.querySelector('.scrubber-area') as HTMLElement | null;
      return { hidden: area?.dataset.hidden ?? null, opacity: area?.style.opacity ?? null };
    });
    // Engine plays on mount, but the opt-out keeps the bar visible: dataset
    // flag is NOT 'true' and opacity is not forced to '0'.
    expect(state.hidden).not.toBe('true');
    expect(state.opacity).not.toBe('0');
  });

  test('touch-primary viewport — chunk-mode .word-run siblings render inline, do NOT overlap (architect H1 SHIP BLOCKER)', async ({
    browser,
  }) => {
    // Re-creates the multi-run-overlap regression: the touch-primary
    // (pointer: coarse) and (hover: none) media block previously OVERRODE
    // .word-region with `display: grid; place-items: center`, causing
    // multiple .word-run siblings inside a chunk to stack on top of each
    // other inside a single grid cell. The fix restores flex+wrap inside
    // the touch-primary block. We verify by measuring bounding-box x +
    // width on the two runs: run 0 must end (x + width) at or before run
    // 1's start x (inline flow), with NO overlap.
    const context = await browser.newContext({
      viewport: { width: 375, height: 667 },
      hasTouch: true,
      isMobile: true,
    });
    const mobilePage = await context.newPage();
    await mobilePage.goto('about:blank');
    await mobilePage.addScriptTag({ path: BUNDLE_PATH });
    const CHUNK_STREAM = ['The', 'quick', 'brown', 'fox.', 'Stop.'];
    const measurements = await mobilePage.evaluate((words) => {
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
      const runs = region?.querySelectorAll('.word-run') ?? [];
      const rects: { x: number; width: number }[] = [];
      runs.forEach((run) => {
        const r = (run as HTMLElement).getBoundingClientRect();
        rects.push({ x: r.x, width: r.width });
      });
      // Also check the resolved layout to confirm we're in flex, not grid.
      const computed = region ? getComputedStyle(region as HTMLElement) : null;
      return {
        runCount: runs.length,
        rects,
        display: computed?.display ?? '',
      };
    }, CHUNK_STREAM);
    // 2 runs from chunkSize=2.
    expect(measurements.runCount).toBe(2);
    // Resolved layout under touch-primary media query MUST be flex (the
    // SHIP BLOCKER fix); a regression to grid would surface here.
    expect(measurements.display).toBe('flex');
    // Non-overlapping: run[0] ends before or exactly at run[1] starts.
    // The space between runs comes from the base rule's `gap: 0 0.4ch`
    // which makes run[0].x + run[0].width <= run[1].x in inline flow.
    const [r0, r1] = measurements.rects;
    expect(r0.x + r0.width).toBeLessThanOrEqual(r1.x + 0.5);
    // And both runs have non-zero width (would be a degenerate guard if
    // a regression collapsed them).
    expect(r0.width).toBeGreaterThan(0);
    expect(r1.width).toBeGreaterThan(0);
    await context.close();
  });
});
