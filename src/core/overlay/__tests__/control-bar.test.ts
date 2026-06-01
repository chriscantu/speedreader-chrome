/**
 * control-bar.test.ts — issue #21 (with #16 / #23 / #24 / #213 scope)
 *
 * Persistent control-bar chrome:
 *  - prev-sentence button (⏮) — clicks call engine.seekToSentence('prev')
 *  - next-sentence button (⏭) — clicks call engine.seekToSentence('next')
 *  - WPM stepper (#213, with PR #214 a11y revisions) — `[−] [num] [wpm] [+]`
 *    pill. Each button click commits a single WPM_STEP discrete change to
 *    the engine, fires onWpmChange, and writes a polite-live-region
 *    announcement (#214 BLOCK 1). The numeric span is a pure display
 *    element with a dynamic `aria-label` rewritten on every commit
 *    (#214 BLOCK 2 — replaces the broken `role="spinbutton"` shape).
 *    Buttons use `aria-disabled="true"` at WPM_MIN / WPM_MAX (#214 HOLD 1
 *    — native `disabled` removes the element from the tab chain) with a
 *    visible affordance via `--text-muted` + `cursor: not-allowed`
 *    (#214 HOLD 2 — opacity 0.4 failed 1.4.11 non-text contrast).
 *  - Keyboard ArrowUp/Down: still updates engine cadence (non-persisting)
 *    via the global hotkey wired in mount().
 *
 * The close button, play/pause, font-size stepper and ArrowLeft/Right /
 * ArrowUp/Down keyboard shortcuts are covered by their own specs
 * (close-snapshot, play-pause, font-size-stepper, keyboard-shortcuts).
 * This file adds coverage for the NEW visible affordances.
 *
 * 44×44 CSS-px minimum tap target is asserted at the stylesheet level
 * (jsdom does not evaluate CSS) — mirrors the touch-controls.test.ts
 * pattern for the play-pause + close buttons.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine, type RsvpEngine, type RsvpEngineOptions } from '../../rsvp-engine';
import { WPM_MAX, WPM_MIN, WPM_STEP } from '../../settings/bounds';
import { OVERLAY_CLASS, OVERLAY_TEXT } from '../constants';
import { OVERLAY_CSS } from '../styles';

const STREAM = ['Hi.', 'How', 'are', 'you?', 'I', 'am', 'fine.', 'Bye!'];

type Holder = { engine: RsvpEngine | null };

function defaultOpts(holder: Holder, overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: STREAM.slice(),
    initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
    subscribeSettings: () => () => undefined,
    engineFactory: (engineOpts: RsvpEngineOptions) => {
      holder.engine = createRsvpEngine(engineOpts);
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

function getPrevBtn(): HTMLButtonElement {
  const btn = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.PREV_SENTENCE_BTN}`);
  if (!btn) throw new Error('overlay shadow: missing prev-sentence-btn');
  return btn;
}

function getNextBtn(): HTMLButtonElement {
  const btn = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.NEXT_SENTENCE_BTN}`);
  if (!btn) throw new Error('overlay shadow: missing next-sentence-btn');
  return btn;
}

function getStepperDec(): HTMLButtonElement {
  const el = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.WPM_STEPPER_DEC}`);
  if (!el) throw new Error('overlay shadow: missing wpm-stepper-dec');
  return el;
}

function getStepperInc(): HTMLButtonElement {
  const el = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.WPM_STEPPER_INC}`);
  if (!el) throw new Error('overlay shadow: missing wpm-stepper-inc');
  return el;
}

function getStepperNum(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.WPM_STEPPER_NUM}`);
  if (!el) throw new Error('overlay shadow: missing wpm-stepper-num');
  return el;
}

function getAriaLive(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
  if (!el) throw new Error('overlay shadow: missing aria-live region');
  return el;
}

function engineOf(holder: Holder): RsvpEngine {
  if (!holder.engine) throw new Error('engine not yet created');
  return holder.engine;
}

describe('createOverlay — prev/next sentence buttons (#23)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('renders prev/next buttons with accessible labels', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const prev = getPrevBtn();
    const next = getNextBtn();
    expect(prev.tagName).toBe('BUTTON');
    expect(prev.type).toBe('button');
    expect(prev.getAttribute('aria-label')).toBe(OVERLAY_TEXT.PREV_SENTENCE_LABEL);
    expect(next.tagName).toBe('BUTTON');
    expect(next.type).toBe('button');
    expect(next.getAttribute('aria-label')).toBe(OVERLAY_TEXT.NEXT_SENTENCE_LABEL);
    overlay.unmount();
  });

  test('prev button click calls engine.seekToSentence("prev")', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    // Pause so seekToSentence's paused-state branch is exercised
    // deterministically (matches the keyboard-shortcuts.test.ts pattern).
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    const spy = vi.spyOn(engineOf(holder), 'seekToSentence');
    getPrevBtn().click();
    expect(spy).toHaveBeenCalledWith('prev');
    overlay.unmount();
  });

  test('next button click calls engine.seekToSentence("next")', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
    );
    const spy = vi.spyOn(engineOf(holder), 'seekToSentence');
    getNextBtn().click();
    expect(spy).toHaveBeenCalledWith('next');
    overlay.unmount();
  });
});

describe('createOverlay — WPM stepper (#213, supersedes #24 slider)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('renders [−] [num] [wpm] [+] stepper shape with accessible labels', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const dec = getStepperDec();
    const inc = getStepperInc();
    const num = getStepperNum();
    expect(dec.tagName).toBe('BUTTON');
    expect(dec.type).toBe('button');
    expect(dec.getAttribute('aria-label')).toBe('Decrease reading speed');
    expect(inc.tagName).toBe('BUTTON');
    expect(inc.type).toBe('button');
    expect(inc.getAttribute('aria-label')).toBe('Increase reading speed');
    // Visible glyphs match the mockup.
    expect(dec.textContent).toBe('−');
    expect(inc.textContent).toBe('+');
    // #214 BLOCK 2 — number span is a pure display element. No `role`
    // (spinbutton would lie to AT since the span isn't focusable / has
    // no ArrowUp/Down handlers); no aria-valuemin/max/now. A dynamic
    // `aria-label` carries the current value instead.
    expect(num.getAttribute('role')).toBeNull();
    expect(num.getAttribute('aria-valuemin')).toBeNull();
    expect(num.getAttribute('aria-valuemax')).toBeNull();
    expect(num.getAttribute('aria-valuenow')).toBeNull();
    expect(num.getAttribute('aria-label')).toMatch(/reading speed/i);
    overlay.unmount();
  });

  test('numeric span shows initial WPM and exposes it via dynamic aria-label', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 350, fontSize: 20 } }),
    );
    overlay.mount();
    const num = getStepperNum();
    expect(num.textContent).toBe('350');
    // #214 BLOCK 2 — aria-label carries the value, not aria-valuenow.
    expect(num.getAttribute('aria-label')).toBe('Reading speed, 350 words per minute');
    overlay.unmount();
  });

  test('unit-label "wpm" renders next to the number (Hi-Fi parity)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const lbl = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.WPM_STEPPER_LBL}`);
    expect(lbl?.textContent).toBe('wpm');
    expect(lbl?.getAttribute('aria-hidden')).toBe('true');
    overlay.unmount();
  });

  test('− click decrements by WPM_STEP, commits to engine and onWpmChange', () => {
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
        onWpmChange,
      }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    getStepperDec().click();

    expect(setWpmSpy).toHaveBeenCalledTimes(1);
    expect(setWpmSpy).toHaveBeenCalledWith(300 - WPM_STEP);
    expect(onWpmChange).toHaveBeenCalledTimes(1);
    expect(onWpmChange).toHaveBeenCalledWith(300 - WPM_STEP);
    expect(getStepperNum().textContent).toBe(String(300 - WPM_STEP));
    expect(getStepperNum().getAttribute('aria-label')).toBe(
      `Reading speed, ${300 - WPM_STEP} words per minute`,
    );
    overlay.unmount();
  });

  test('+ click increments by WPM_STEP, commits to engine and onWpmChange', () => {
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
        onWpmChange,
      }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    getStepperInc().click();

    expect(setWpmSpy).toHaveBeenCalledTimes(1);
    expect(setWpmSpy).toHaveBeenCalledWith(300 + WPM_STEP);
    expect(onWpmChange).toHaveBeenCalledTimes(1);
    expect(onWpmChange).toHaveBeenCalledWith(300 + WPM_STEP);
    expect(getStepperNum().textContent).toBe(String(300 + WPM_STEP));
    overlay.unmount();
  });

  test('− is aria-disabled at WPM_MIN, stays in tab chain (#214 HOLD 1)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: WPM_MIN, fontSize: 20 } }),
    );
    overlay.mount();
    // #214 HOLD 1 — aria-disabled (not native `disabled`) so keyboard
    // users tabbing right at MIN still land on the button. Native
    // `disabled` would silently remove it from the tab chain.
    expect(getStepperDec().getAttribute('aria-disabled')).toBe('true');
    expect(getStepperInc().getAttribute('aria-disabled')).toBe('false');
    // Belt-and-suspenders: native `disabled` MUST stay off so the
    // button remains focusable.
    expect(getStepperDec().disabled).toBe(false);
    overlay.unmount();
  });

  test('+ is aria-disabled at WPM_MAX, stays in tab chain (#214 HOLD 1)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: WPM_MAX, fontSize: 20 } }),
    );
    overlay.mount();
    expect(getStepperInc().getAttribute('aria-disabled')).toBe('true');
    expect(getStepperDec().getAttribute('aria-disabled')).toBe('false');
    expect(getStepperInc().disabled).toBe(false);
    overlay.unmount();
  });

  test('aria-disabled bounds transitions live as the stepper is walked to MIN/MAX', () => {
    // Step − from WPM_MIN + WPM_STEP — after one click the value
    // reaches WPM_MIN and the − button must flip aria-disabled='true'.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: WPM_MIN + WPM_STEP, fontSize: 20 },
      }),
    );
    overlay.mount();
    expect(getStepperDec().getAttribute('aria-disabled')).toBe('false');
    getStepperDec().click();
    expect(getStepperNum().textContent).toBe(String(WPM_MIN));
    expect(getStepperDec().getAttribute('aria-disabled')).toBe('true');
    overlay.unmount();
  });

  test('− click at WPM_MIN does not fire onWpmChange (aria-disabled handler short-circuit)', () => {
    // #214 HOLD 1 — the click handler now checks aria-disabled and
    // early-returns BEFORE entering applyWpm. This protects against
    // a refactor of applyWpm's clamp short-circuit + ensures programmatic
    // .click() calls (which bypass any pointer-events styling) still
    // no-op. The mutation guard below confirms this gate is load-bearing.
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: WPM_MIN, fontSize: 20 },
        onWpmChange,
      }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');
    getStepperDec().click();
    expect(setWpmSpy).not.toHaveBeenCalled();
    expect(onWpmChange).not.toHaveBeenCalled();
    expect(getStepperNum().textContent).toBe(String(WPM_MIN));
    overlay.unmount();
  });

  test('mutation guard — aria-disabled handler gate is load-bearing (independent of applyWpm clamp)', () => {
    // The handler-level early-return is belt-and-suspenders on top of
    // applyWpm's `clamped === currentWpm` short-circuit. To discriminate
    // the HANDLER gate from the applyWpm gate, force aria-disabled="true"
    // on the + button at a mid-range WPM (where applyWpm would NOT
    // short-circuit because clampedDelta !== currentWpm). If the handler
    // gate is intact, the click no-ops. If a refactor removes it, the
    // click reaches applyWpm and fires onWpmChange.
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
        onWpmChange,
      }),
    );
    overlay.mount();
    // Force aria-disabled='true' at a non-bound value. syncWpmUi will
    // overwrite this on the next legitimate state change, but we click
    // BEFORE any sync runs.
    getStepperInc().setAttribute('aria-disabled', 'true');
    getStepperInc().click();
    expect(onWpmChange).not.toHaveBeenCalled();
    expect(getStepperNum().textContent).toBe('300');
    overlay.unmount();
  });

  test('keyboard ArrowUp updates stepper readout (global hotkey, no regression)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    expect(getStepperNum().textContent).toBe('300');

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );

    expect(getStepperNum().textContent).toBe(String(300 + WPM_STEP));
    // #214 BLOCK 2 — value flows through aria-label (replaces the
    // broken aria-valuenow on a non-spinbutton span).
    expect(getStepperNum().getAttribute('aria-label')).toBe(
      `Reading speed, ${300 + WPM_STEP} words per minute`,
    );
    overlay.unmount();
  });

  test('keyboard ArrowDown updates stepper readout (global hotkey, no regression)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(getStepperNum().textContent).toBe(String(300 - WPM_STEP));
    overlay.unmount();
  });

  test('keyboard ArrowUp/Down do NOT persist (issue #24 contract still holds)', () => {
    // The − / + stepper IS the persistence surface; ArrowUp/Down keeps
    // the session-only contract that's been in place since #24.
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(defaultOpts(holder, { onWpmChange }));
    overlay.mount();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(onWpmChange).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('keyboard ArrowUp still updates engine cadence (non-persisting)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    expect(setWpmSpy).toHaveBeenCalledWith(300 + WPM_STEP);
    overlay.unmount();
  });

  test('subscribeSettings emission with new wpm updates stepper readout', () => {
    const holder: Holder = { engine: null };
    let notify: SettingsSubscriber = () => undefined;
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
        subscribeSettings: (cb) => {
          notify = cb;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    expect(getStepperNum().textContent).toBe('300');

    const next: OverlaySettings = { theme: 'system', wpm: 480, fontSize: 20 };
    notify(next);

    expect(getStepperNum().textContent).toBe('480');
    expect(getStepperNum().getAttribute('aria-label')).toBe('Reading speed, 480 words per minute');
    overlay.unmount();
  });

  test('mutation guard — onWpmChange wire from + click is load-bearing', () => {
    // Without the wire, the assertion below would never be true; if a
    // contributor reverts the `opts.onWpmChange?.(clamped)` call inside
    // applyWpm (or flips persist:true to persist:false in the click
    // handler) this test fails.
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: 400, fontSize: 20 },
        onWpmChange,
      }),
    );
    overlay.mount();
    getStepperInc().click();
    expect(onWpmChange).toHaveBeenCalledTimes(1);
    expect(onWpmChange).toHaveBeenCalledWith(400 + WPM_STEP);
    overlay.unmount();
  });

  test('multiple − / + clicks walk the stepper in WPM_STEP increments', () => {
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
        onWpmChange,
      }),
    );
    overlay.mount();
    getStepperInc().click();
    getStepperInc().click();
    getStepperInc().click();
    expect(getStepperNum().textContent).toBe(String(300 + 3 * WPM_STEP));
    expect(onWpmChange).toHaveBeenCalledTimes(3);
    expect(onWpmChange).toHaveBeenLastCalledWith(300 + 3 * WPM_STEP);
    getStepperDec().click();
    expect(getStepperNum().textContent).toBe(String(300 + 2 * WPM_STEP));
    expect(onWpmChange).toHaveBeenCalledTimes(4);
    expect(onWpmChange).toHaveBeenLastCalledWith(300 + 2 * WPM_STEP);
    overlay.unmount();
  });

  // #214 a11y BLOCK 1 — polite-live-region announcements on stepper
  // commits. Updating aria-valuenow on a non-focused sibling does NOT
  // reliably trigger NVDA/JAWS/VoiceOver announcements; the .aria-live
  // region is the existing, AT-tested channel for status updates.
  test('+ click writes the new WPM value to the polite aria-live region', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    getStepperInc().click();
    expect(getAriaLive().textContent).toBe(`${300 + WPM_STEP} wpm`);
    overlay.unmount();
  });

  test('− click writes the new WPM value to the polite aria-live region', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    getStepperDec().click();
    expect(getAriaLive().textContent).toBe(`${300 - WPM_STEP} wpm`);
    overlay.unmount();
  });

  test('successive ± clicks each refresh the aria-live region with the latest value', () => {
    // Polite live-region writes replace prior content (the region is
    // aria-atomic=true); each commit's announcement must reflect the
    // CURRENT value, not stack/concatenate.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    getStepperInc().click();
    expect(getAriaLive().textContent).toBe(`${300 + WPM_STEP} wpm`);
    getStepperInc().click();
    expect(getAriaLive().textContent).toBe(`${300 + 2 * WPM_STEP} wpm`);
    getStepperDec().click();
    expect(getAriaLive().textContent).toBe(`${300 + WPM_STEP} wpm`);
    overlay.unmount();
  });

  test('keyboard ArrowUp/ArrowDown do NOT announce to aria-live (cadence probe stays quiet)', () => {
    // #214 BLOCK 1 carve-out — only persist:true commits announce.
    // ArrowUp/Down is the live-cadence probe path (persist:false);
    // announcing on every keypress would be deafening. The aria-live
    // region may carry other content (e.g., the current RSVP word when
    // playing) — we only assert it does NOT carry the wpm announcement.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    const ariaLiveBefore = getAriaLive().textContent;
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    // ArrowUp advanced the stepper to 310, but the wpm announcement
    // must NOT have been written. The text is either unchanged from
    // before (idle state) or whatever RSVP/other path writes — but it
    // must NOT match the wpm-commit format.
    expect(getAriaLive().textContent).not.toBe(`${300 + WPM_STEP} wpm`);
    expect(getAriaLive().textContent).toBe(ariaLiveBefore);
    overlay.unmount();
  });

  test('mutation guard — removing the live-region write makes BLOCK 1 regress detectable', () => {
    // If a future refactor drops `ariaLive.textContent = ...` from the
    // persist:true branch of applyWpm, this test fails because the
    // region stays at its pre-click value. Confirms the announcement
    // IS the load-bearing wire (not e.g. a side-effect of syncWpmUi).
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    const before = getAriaLive().textContent;
    getStepperInc().click();
    const after = getAriaLive().textContent;
    expect(after).not.toBe(before);
    expect(after).toBe(`${300 + WPM_STEP} wpm`);
    overlay.unmount();
  });
});

describe('createOverlay — control-bar tap targets (#21, #213)', () => {
  test('CSS sheet ensures prev/next/stepper-buttons/font/play-pause meet 44px target-size at base', () => {
    // jsdom does not evaluate CSS — assert structural minimums in the
    // stylesheet bytes (mirrors touch-controls.test.ts pattern).
    expect(OVERLAY_CSS).toMatch(/\.prev-sentence-btn[\s\S]*?min-(width|height):\s*44px/);
    expect(OVERLAY_CSS).toMatch(/\.next-sentence-btn[\s\S]*?min-(width|height):\s*44px/);
    // WPM stepper buttons (#213) — `.wpm-display button` rule wraps both
    // − and + with a 44px floor even though the painted circle is 22px.
    expect(OVERLAY_CSS).toMatch(/\.wpm-display button[\s\S]*?min-height:\s*44px/);
  });

  test('CSS sheet bumps prev/next/stepper-buttons to ≥48px on touch-primary viewports', () => {
    const blockMatch = OVERLAY_CSS.match(/@media\s*\(pointer:\s*coarse\)[^{]*\{([\s\S]*?)\n\}/);
    expect(blockMatch, 'coarse-pointer media block must exist').toBeTruthy();
    const blockBody = blockMatch?.[1] ?? '';
    expect(blockBody).toMatch(/\.prev-sentence-btn[\s\S]*?min-height:\s*48px/);
    expect(blockBody).toMatch(/\.next-sentence-btn[\s\S]*?min-height:\s*48px/);
    expect(blockBody).toMatch(/\.wpm-display button[\s\S]*?min-height:\s*48px/);
  });
});
