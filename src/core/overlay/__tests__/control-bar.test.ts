/**
 * control-bar.test.ts — issue #21 (with #16 / #23 / #24 / #213 scope)
 *
 * Persistent control-bar chrome:
 *  - prev-sentence button (⏮) — clicks call engine.seekToSentence('prev')
 *  - next-sentence button (⏭) — clicks call engine.seekToSentence('next')
 *  - WPM stepper (#213) — `[−] [num] [wpm] [+]` pill. Each button click
 *    commits a single WPM_STEP discrete change to the engine and fires
 *    onWpmChange. The numeric span carries the live value and exposes
 *    `role="spinbutton"` with aria-valuemin / aria-valuemax / aria-valuenow.
 *    Buttons are `disabled` at WPM_MIN / WPM_MAX (and visually distinguishable).
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
    // Number span is the spinbutton with bounds wired up.
    expect(num.getAttribute('role')).toBe('spinbutton');
    expect(num.getAttribute('aria-valuemin')).toBe(String(WPM_MIN));
    expect(num.getAttribute('aria-valuemax')).toBe(String(WPM_MAX));
    expect(num.getAttribute('aria-label')).toMatch(/reading speed/i);
    overlay.unmount();
  });

  test('numeric span shows initial WPM and exposes aria-valuenow', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 350, fontSize: 20 } }),
    );
    overlay.mount();
    const num = getStepperNum();
    expect(num.textContent).toBe('350');
    expect(num.getAttribute('aria-valuenow')).toBe('350');
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
    expect(getStepperNum().getAttribute('aria-valuenow')).toBe(String(300 - WPM_STEP));
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

  test('− is disabled at WPM_MIN (clamp + visible affordance)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: WPM_MIN, fontSize: 20 } }),
    );
    overlay.mount();
    expect(getStepperDec().disabled).toBe(true);
    expect(getStepperInc().disabled).toBe(false);
    overlay.unmount();
  });

  test('+ is disabled at WPM_MAX (clamp + visible affordance)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: WPM_MAX, fontSize: 20 } }),
    );
    overlay.mount();
    expect(getStepperInc().disabled).toBe(true);
    expect(getStepperDec().disabled).toBe(false);
    overlay.unmount();
  });

  test('disabled-at-bounds transitions live as the stepper is walked to MIN/MAX', () => {
    // Step − repeatedly from WPM_MIN + WPM_STEP — after one click the
    // value reaches WPM_MIN and the − button must flip disabled.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, {
        initialSettings: { theme: 'system', wpm: WPM_MIN + WPM_STEP, fontSize: 20 },
      }),
    );
    overlay.mount();
    expect(getStepperDec().disabled).toBe(false);
    getStepperDec().click();
    expect(getStepperNum().textContent).toBe(String(WPM_MIN));
    expect(getStepperDec().disabled).toBe(true);
    overlay.unmount();
  });

  test('− click at WPM_MIN does not fire onWpmChange (clamp short-circuit)', () => {
    // applyWpm short-circuits when the clamped delta lands on currentWpm.
    // The button is also disabled by syncWpmUi, but the contract should
    // hold even for programmatic .click() calls that bypass disabled
    // styling: no spurious engine.setWpm + no spurious persistence.
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
    expect(getStepperNum().getAttribute('aria-valuenow')).toBe(String(300 + WPM_STEP));
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
    expect(getStepperNum().getAttribute('aria-valuenow')).toBe('480');
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
