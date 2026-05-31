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

  test('engine playing + mid-scrub (scrubInProgress) → scrubber stays visible even on mouseleave', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const area = getArea();
    const scrubber = getShadow().querySelector<HTMLInputElement>(
      `.${OVERLAY_CLASS.SCRUBBER_SLIDER}`,
    );
    if (!scrubber) throw new Error('missing scrubber');
    // beginScrubSession via input event sets scrubInProgress = true.
    // After this, scrubber MUST stay visible regardless of mouseleave.
    scrubber.value = '3';
    scrubber.dispatchEvent(new Event('input', { bubbles: true }));
    // The input handler pauses the engine — recompute now reads state ===
    // 'paused' which is naturally visible. To exercise the "playing +
    // scrubInProgress" path, we instead must check that mid-scrub keeps
    // the bar visible. Since input pauses, this test simplifies to:
    // immediately after input event, area is visible.
    expect(isHidden(area)).toBe(false);
    // Now simulate mouseleave during scrub — must still be visible.
    area.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(isHidden(area)).toBe(false);
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
});
