/**
 * scrubber-autohide.test.ts — issue #52 PART D (#47 deferred + #206)
 *
 * Auto-hide chrome during active playback so the user's eye stays on the
 * word region (matches Safari spec). Visibility state machine:
 *
 *   Hidden: engine.state === 'playing' AND no hover AND no focus-within
 *           AND not mid-scrub
 *   Visible: otherwise (paused, idle, done, hover, focus-within, mid-scrub)
 *
 * Mutation guards:
 *   - Forgetting to hide on play fails the play-state assertion.
 *   - Hiding while paused fails the paused-state assertion.
 *   - display:none usage (instead of visibility/opacity) is detected via
 *     computed-style check on opacity / pointer-events.
 *   - Hiding while mid-scrub fails the scrub-active assertion (lose
 *     scrubber while user is dragging = catastrophic UX).
 *   - Hiding while focus-within fails the focus-retention assertion
 *     (user tabbed to scrubber and lost focus on play).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions } from '../types';
import { createRsvpEngine, type RsvpEngine, type RsvpEngineOptions } from '../../rsvp-engine';
import { OVERLAY_CLASS } from '../constants';

const STREAM = ['Hello.', 'How', 'are', 'you?', 'I', 'am', 'fine.', 'Bye!'];

type Holder = { engine: RsvpEngine | null };

function defaultOpts(holder: Holder, overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: STREAM.slice(),
    initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
    subscribeSettings: () => () => undefined,
    engineFactory: (o: RsvpEngineOptions) => {
      holder.engine = createRsvpEngine(o);
      return holder.engine;
    },
    ...overrides,
  };
}

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

function getArea(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.SCRUBBER_AREA}`);
  if (!el) throw new Error('overlay shadow: missing scrubber-area');
  return el;
}

function isHidden(area: HTMLElement): boolean {
  // The contract: opacity 0 + visibility hidden + pointer-events none
  // (NEVER display:none — would collapse the layout slot and reflow).
  // Reads the dataset flag we toggle (more reliable than computed style
  // in jsdom which doesn't compute :host transitions). The flag mirrors
  // the visible-state computation.
  return area.dataset.hidden === 'true';
}

function engineOf(holder: Holder): RsvpEngine {
  if (!holder.engine) throw new Error('engine not yet created');
  return holder.engine;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
});

describe('createOverlay — scrubber visibility state machine (#52 PART D)', () => {
  test('engine playing + no hover + no focus → scrubber hidden', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    expect(isHidden(getArea())).toBe(true);
    overlay.unmount();
  });

  test('engine paused → scrubber visible', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    engineOf(holder).pause();
    // togglePlayPause / pause via the play/pause btn drives the
    // visibility recomputation. Calling pause() directly does too via
    // the reflectEngineState → recomputeScrubberVisibility path.
    const playPauseBtn = getShadow().querySelector<HTMLButtonElement>(
      `.${OVERLAY_CLASS.PLAY_PAUSE_BTN}`,
    );
    if (!playPauseBtn) throw new Error('expected play-pause-btn');
    // Synthesise the click path that the user would take (also exercises
    // the recompute call inside togglePlayPause).
    // engine.pause() above already moved state to paused; click would
    // resume. So just call recompute via a state-driven event: trigger
    // a no-op input on the scrubber to land in beginScrubSession, then
    // step out. Simpler: rely on the post-pause recompute that the
    // mounted overlay performs via reflectEngineState. The play/pause
    // btn handler calls reflectEngineState after pause/resume which in
    // turn triggers visibility recomputation.
    // We already paused via engineOf().pause(); the engine state is now
    // 'paused'. The visibility computation must read engine.state and
    // surface visible. Force a recompute by dispatching mouseenter then
    // mouseleave (cheap and deterministic).
    const area = getArea();
    area.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    area.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(isHidden(area)).toBe(false);
    overlay.unmount();
  });

  test('engine playing + hover → scrubber visible', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    const area = getArea();
    expect(isHidden(area)).toBe(true);
    area.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(isHidden(area)).toBe(false);
    overlay.unmount();
  });

  test('engine playing + hover then mouseleave → scrubber hidden again', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const area = getArea();
    area.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(isHidden(area)).toBe(false);
    area.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(isHidden(area)).toBe(true);
    overlay.unmount();
  });

  test('engine playing + scrubber focus → scrubber visible (focus retention)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const area = getArea();
    expect(isHidden(area)).toBe(true);
    const scrubber = getShadow().querySelector<HTMLInputElement>(
      `.${OVERLAY_CLASS.SCRUBBER_SLIDER}`,
    );
    if (!scrubber) throw new Error('missing scrubber');
    // focusin bubbles, focus does not — use focusin to match the listener
    // we bind on .scrubber-area.
    scrubber.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(isHidden(area)).toBe(false);
    overlay.unmount();
  });

  test('engine playing + focus then focusout → scrubber hidden again', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const area = getArea();
    const scrubber = getShadow().querySelector<HTMLInputElement>(
      `.${OVERLAY_CLASS.SCRUBBER_SLIDER}`,
    );
    if (!scrubber) throw new Error('missing scrubber');
    scrubber.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(isHidden(area)).toBe(false);
    scrubber.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(isHidden(area)).toBe(true);
    overlay.unmount();
  });

  test('engine playing + mid-scrub via mousedown (scrubInProgress) → scrubber stays visible on mouseleave', async () => {
    // Real mid-scrub assertion (kills the previous tautology). The prior
    // test fired `input` which pauses the engine before recompute runs, so
    // `shouldHide`'s `playing && scrubInProgress && !hovered` path was
    // never exercised. Here we fire `mousedown` (which calls
    // beginScrubSession AND scrubFromPause — but scrubFromPause only
    // pauses when state IS 'playing'; the engine state IS still
    // 'playing' BEFORE the pause runs, so the resulting state after
    // mousedown is 'paused' regardless).
    //
    // The honest way to exercise the playing+scrubInProgress branch is
    // to: (a) start playing, (b) flip scrubInProgress = true via a
    // mousedown (this happens BEFORE scrubFromPause inside the same
    // listener — beginScrubSession's recompute call observes
    // engine.state === 'playing' AND scrubInProgress === true and
    // therefore must NOT hide). We assert two things:
    //   1. AFTER mousedown, the engine has transitioned to paused (which
    //      itself keeps the bar visible — separate path).
    //   2. BEFORE the input event arrives, the bar is visible because of
    //      the scrubInProgress flag, not because of pause.
    //
    // To pin the scrubInProgress contribution specifically, we use the
    // hover-then-leave sequence with engine still playing: prime
    // scrubInProgress directly by hovering+mousedown, mouseleave, assert
    // visible. The engine pause is a side-effect of scrubFromPause but
    // the recompute fired inside beginScrubSession (BEFORE scrubFromPause)
    // observes `playing && scrubInProgress && !hovered` — that recompute
    // proves the path.
    //
    // Mutation guard (verified locally): dropping `&& !scrubInProgress`
    // from `shouldHide` in overlay.ts causes this test to fail because
    // the recompute inside beginScrubSession would hide the bar (the
    // engine is still 'playing' at that exact moment, hover is false,
    // focus is false).
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const area = getArea();
    const scrubber = getShadow().querySelector<HTMLInputElement>(
      `.${OVERLAY_CLASS.SCRUBBER_SLIDER}`,
    );
    if (!scrubber) throw new Error('missing scrubber');
    expect(engineOf(holder).state).toBe('playing');
    expect(isHidden(area)).toBe(true);
    // Spy on every direct write to area.style.opacity. The mousedown
    // handler runs synchronously:
    //   1. beginScrubSession() → recompute (engine still 'playing',
    //      scrubInProgress now true). With the guard, shouldHide=false,
    //      opacity is written to '1'. Without the guard (mutation),
    //      shouldHide=true, opacity is written to '0' — the mutation
    //      reveal.
    //   2. scrubFromPause() → engine.pause() → reflectEngineState →
    //      recompute (engine now 'paused', shouldHide=false), opacity
    //      written to '1'.
    //
    // With guard: observed opacity writes = ['1', '1']
    // Without guard: observed opacity writes = ['0', '1']
    //
    // Asserting that no '0' write happens during the mousedown handler
    // proves the scrubInProgress guard is present.
    const opacityWrites: string[] = [];
    // Save original style descriptor so we can restore it later.
    const styleObj = area.style;
    const origOpacityDescriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(styleObj),
      'opacity',
    );
    Object.defineProperty(styleObj, 'opacity', {
      configurable: true,
      get() {
        return origOpacityDescriptor?.get?.call(this);
      },
      set(v: string) {
        opacityWrites.push(v);
        origOpacityDescriptor?.set?.call(this, v);
      },
    });
    scrubber.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    // Restore the original descriptor so subsequent test cleanup is
    // unaffected.
    delete (styleObj as unknown as { opacity?: string }).opacity;
    if (origOpacityDescriptor) {
      Object.defineProperty(styleObj, 'opacity', origOpacityDescriptor);
    }
    // Final state: visible (paused).
    expect(isHidden(area)).toBe(false);
    expect(engineOf(holder).state).toBe('paused');
    // No '0' write during the mousedown handler — the scrubInProgress
    // guard kept the first recompute on the visible branch even though
    // engine.state was still 'playing'. A regression that drops the
    // `&& !scrubInProgress` check would write '0' first, then '1'.
    expect(opacityWrites).not.toContain('0');
    // At least one '1' write (the second recompute after pause).
    expect(opacityWrites).toContain('1');
    // Mouseleave during scrub session — paused state keeps it visible
    // regardless, but the scrubInProgress flag also independently does.
    area.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(isHidden(area)).toBe(false);
    overlay.unmount();
  });

  test('focus-driven reveal during playback is instant (no fade) — A11y MED #3', () => {
    // WCAG SC 2.4.7 — focus indicator must be visible at the moment focus
    // is received. The auto-hide fade (200ms) would leave the focus
    // indicator at < 100% opacity during the fade. recomputeScrubberVisibility
    // skips the transition specifically for hidden→visible transitions
    // driven by focus.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const area = getArea();
    expect(engineOf(holder).state).toBe('playing');
    expect(isHidden(area)).toBe(true);
    const scrubber = getShadow().querySelector<HTMLInputElement>(
      `.${OVERLAY_CLASS.SCRUBBER_SLIDER}`,
    );
    if (!scrubber) throw new Error('missing scrubber');
    scrubber.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // After focusin: visible AND inline transition must be 'none' so the
    // opacity is honored at 1 immediately, not animated over 200ms.
    expect(isHidden(area)).toBe(false);
    expect(area.style.opacity).toBe('1');
    expect(area.style.visibility).toBe('visible');
    expect(area.style.transition).toBe('none');
    overlay.unmount();
  });

  test('rapid play/pause/play state thrash settles to a consistent final visibility', () => {
    // Synchronous play/pause sequences must NOT desync the visibility
    // state from the engine state. A regression that batched visibility
    // writes via RAF (or a stale closure capturing engine.state) would
    // leave the bar in an outdated state after the last toggle.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const area = getArea();
    const playPauseBtn = getShadow().querySelector<HTMLButtonElement>(
      `.${OVERLAY_CLASS.PLAY_PAUSE_BTN}`,
    );
    if (!playPauseBtn) throw new Error('missing play-pause-btn');
    // Sequence A: pause/resume/pause → final state paused → bar visible.
    playPauseBtn.click(); // pause
    playPauseBtn.click(); // resume
    playPauseBtn.click(); // pause
    expect(engineOf(holder).state).toBe('paused');
    expect(isHidden(area)).toBe(false);
    // Sequence B: resume/pause/resume → final state playing → bar hidden
    // (assuming no hover/focus, which is the default in jsdom).
    playPauseBtn.click(); // resume
    playPauseBtn.click(); // pause
    playPauseBtn.click(); // resume
    expect(engineOf(holder).state).toBe('playing');
    expect(isHidden(area)).toBe(true);
    overlay.unmount();
  });

  test('scrubberArea resolves to a .scrubber-area-classed element on mount (markup sanity)', () => {
    // LOW #6 — guard against future markup refactors that reparent the
    // scrubber under a non-.scrubber-area wrapper. The recompute reads
    // scrubber.parentElement, so this sanity check catches both a missing
    // class AND a missing parent.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const area = getArea();
    expect(area).toBeInstanceOf(HTMLElement);
    expect(area.classList.contains(OVERLAY_CLASS.SCRUBBER_AREA)).toBe(true);
    overlay.unmount();
  });

  test('engine done → scrubber visible (terminal state)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder, { words: ['Solo.'] }));
    overlay.mount();
    // Engine on a single-word stream emits the word then 'done' on the
    // next tick. Drain timers to reach 'done'.
    vi.runAllTimers();
    expect(engineOf(holder).state).toBe('done');
    expect(isHidden(getArea())).toBe(false);
    overlay.unmount();
  });

  test('scrubber uses opacity/visibility (NOT display:none) to prevent layout reflow', () => {
    // Mutation guard: a regression that used display:none would collapse
    // the margin-block-start slot (12-24px) and reflow the word region
    // vertical-center on each toggle. Assert via the inline style we
    // write — the visibility flip MUST go through opacity + visibility,
    // NOT display.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const area = getArea();
    // Engine is playing, area is hidden — assert the hidden-state inline
    // style does NOT mention display.
    expect(area.style.display).not.toBe('none');
    // Must use opacity 0 + visibility hidden + pointer-events none.
    expect(area.style.opacity).toBe('0');
    expect(area.style.visibility).toBe('hidden');
    expect(area.style.pointerEvents).toBe('none');
    overlay.unmount();
  });

  test('OVERLAY_CSS includes opacity transition on .scrubber-area for the auto-hide animation', async () => {
    const { OVERLAY_CSS } = await import('../styles');
    // Mutation guard: the transition is what makes the auto-hide feel
    // smooth. A regression that dropped the transition would produce a
    // jarring instant flip. The selector-bound assertion catches it.
    expect(OVERLAY_CSS).toMatch(/\.scrubber-area\s*\{[^}]*transition:[^}]*opacity/);
  });

  test('prefers-reduced-motion disables the scrubber-area transition', async () => {
    const { OVERLAY_CSS } = await import('../styles');
    // The reduced-motion media block must override .scrubber-area's
    // transition to none. The block also gates backdrop/modal transitions.
    expect(OVERLAY_CSS).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^]*\.scrubber-area[^}]*transition:\s*none/,
    );
  });

  test('touch-primary .word-region uses flex+wrap layout (chunk-mode regression guard — architect H1)', async () => {
    // SHIP BLOCKER for #52. The base .word-region rule uses
    // `display: flex; flex-wrap: wrap; justify-content: center` so multiple
    // .word-run siblings inside a chunk flow inline. The touch-primary
    // (pointer: coarse) and (hover: none) media block previously OVERRODE
    // .word-region with `display: grid; place-items: center`, causing
    // multi-run chunks to stack/overlap inside a single grid cell on
    // phones. The fix restores flex+wrap inside the touch-primary block.
    //
    // A regression that reintroduces `display: grid` (or any non-flex
    // layout) inside the touch-primary .word-region rule fails this test.
    const { OVERLAY_CSS } = await import('../styles');
    // Extract the touch-primary media block. The /s flag (dotAll) lets `.`
    // match across newlines inside the media block.
    const blockMatch = OVERLAY_CSS.match(
      /@media\s*\(pointer:\s*coarse\)\s*and\s*\(hover:\s*none\)\s*\{([^]*?)\n\}/,
    );
    if (!blockMatch) throw new Error('touch-primary media block missing');
    const block = blockMatch[1];
    // Extract the .word-region rule from inside the block. Strip CSS
    // comments BEFORE the substantive assertions — a developer comment
    // mentioning "display: grid" (e.g. when documenting the regression)
    // would otherwise create a false negative.
    const wordRegionMatch = block.match(/\.word-region\s*\{([^}]*)\}/);
    if (!wordRegionMatch) throw new Error('.word-region rule missing inside touch-primary block');
    const wordRegionRule = wordRegionMatch[1].replace(/\/\*[^]*?\*\//g, '');
    // Must declare display: flex (NOT grid) so multi-run chunks render
    // inline. Must declare flex-wrap so long chunks at handset widths
    // break gracefully rather than overflowing the modal.
    expect(wordRegionRule).toMatch(/display:\s*flex/);
    expect(wordRegionRule).not.toMatch(/display:\s*grid/);
    expect(wordRegionRule).toMatch(/flex-wrap:\s*wrap/);
    // place-items is a grid/flex shorthand; the regression we're guarding
    // against had place-items: center which the old display: grid
    // honored to overlap runs in one cell. After the fix, place-items
    // MUST NOT appear inside this rule (the base flex justify-content +
    // align-items already centers the runs).
    expect(wordRegionRule).not.toMatch(/place-items/);
  });
});
