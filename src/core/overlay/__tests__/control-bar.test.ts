/**
 * control-bar.test.ts — issue #21 (with #16 / #23 / #24 scope)
 *
 * Persistent control-bar chrome:
 *  - prev-sentence button (⏮) — clicks call engine.seekToSentence('prev')
 *  - next-sentence button (⏭) — clicks call engine.seekToSentence('next')
 *  - WPM slider (<input type="range" min=100 max=600 step=10>) — input events
 *    update engine cadence, snap/clamp at bounds, fire onWpmChange
 *  - WPM readout — text node ("300 wpm") that syncs with the slider,
 *    keyboard ArrowUp/Down, and subscribeSettings emissions
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
import { OVERLAY_CLASS } from '../constants';
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

function getSlider(): HTMLInputElement {
  const el = getShadow().querySelector<HTMLInputElement>(`.${OVERLAY_CLASS.WPM_SLIDER}`);
  if (!el) throw new Error('overlay shadow: missing wpm-slider');
  return el;
}

function getReadout(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.WPM_READOUT}`);
  if (!el) throw new Error('overlay shadow: missing wpm-readout');
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
    expect(prev.getAttribute('aria-label')).toMatch(/previous sentence/i);
    expect(next.tagName).toBe('BUTTON');
    expect(next.type).toBe('button');
    expect(next.getAttribute('aria-label')).toMatch(/next sentence/i);
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

describe('createOverlay — WPM slider + readout (#24, #16)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('renders slider with bounds [100, 600] and step 10 (issue #16)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const slider = getSlider();
    expect(slider.type).toBe('range');
    expect(slider.min).toBe(String(WPM_MIN));
    expect(slider.max).toBe(String(WPM_MAX));
    expect(slider.step).toBe(String(WPM_STEP));
    expect(slider.getAttribute('aria-label')).toMatch(/reading speed/i);
    overlay.unmount();
  });

  test('slider initial value reflects initialSettings.wpm', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 450, fontSize: 20 } }),
    );
    overlay.mount();
    expect(getSlider().value).toBe('450');
    overlay.unmount();
  });

  test('readout shows current WPM value at mount', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 350, fontSize: 20 } }),
    );
    overlay.mount();
    expect(getReadout().textContent).toMatch(/350/);
    expect(getReadout().textContent).toMatch(/wpm/i);
    overlay.unmount();
  });

  test('slider input event updates engine WPM and readout', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const slider = getSlider();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    slider.value = '420';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    expect(setWpmSpy).toHaveBeenCalledWith(420);
    expect(getReadout().textContent).toMatch(/420/);
    overlay.unmount();
  });

  test('slider invokes onWpmChange for persistence', () => {
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(defaultOpts(holder, { onWpmChange }));
    overlay.mount();
    const slider = getSlider();
    slider.value = '500';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onWpmChange).toHaveBeenCalledWith(500);
    overlay.unmount();
  });

  test('keyboard ArrowUp updates slider value and readout (sync)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    expect(getSlider().value).toBe('300');
    expect(getReadout().textContent).toMatch(/300/);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );

    expect(getSlider().value).toBe('310');
    expect(getReadout().textContent).toMatch(/310/);
    overlay.unmount();
  });

  test('keyboard ArrowDown updates slider value and readout (sync)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(getSlider().value).toBe('290');
    expect(getReadout().textContent).toMatch(/290/);
    overlay.unmount();
  });

  test('keyboard ArrowUp also invokes onWpmChange so it persists', () => {
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(defaultOpts(holder, { onWpmChange }));
    overlay.mount();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    expect(onWpmChange).toHaveBeenCalledWith(310);
    overlay.unmount();
  });

  test('subscribeSettings emission with new wpm updates slider and readout', () => {
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
    expect(getSlider().value).toBe('300');

    const next: OverlaySettings = { theme: 'system', wpm: 480, fontSize: 20 };
    notify(next);

    expect(getSlider().value).toBe('480');
    expect(getReadout().textContent).toMatch(/480/);
    overlay.unmount();
  });

  test('slider clamps to WPM_MIN if out-of-range value is set externally', () => {
    // The native <input type="range"> normally clamps on its own, but the
    // engine.setWpm path must also tolerate the (theoretical) escape — and
    // the on-input handler MUST always feed a clamped value to the engine.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const slider = getSlider();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    slider.value = '50'; // below WPM_MIN — browser will clamp to '100'
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    const calls = setWpmSpy.mock.calls;
    const calledWith = calls[calls.length - 1]?.[0];
    expect(calledWith).toBeGreaterThanOrEqual(WPM_MIN);
    expect(calledWith).toBeLessThanOrEqual(WPM_MAX);
    overlay.unmount();
  });

  test('mutation guard — onWpmChange wire from slider input is load-bearing', () => {
    // Without the wire, the assertion below would never be true; if a
    // contributor reverts the `opts.onWpmChange?.(next)` call inside the
    // slider input handler to a no-op, this test fails.
    const holder: Holder = { engine: null };
    const onWpmChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(defaultOpts(holder, { onWpmChange }));
    overlay.mount();
    const slider = getSlider();
    slider.value = '410';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onWpmChange).toHaveBeenCalledTimes(1);
    expect(onWpmChange).toHaveBeenCalledWith(410);
    overlay.unmount();
  });
});

describe('createOverlay — control-bar tap targets (#21)', () => {
  test('CSS sheet ensures prev/next/slider/font/play-pause meet 44px target-size at base', () => {
    // jsdom does not evaluate CSS — assert structural minimums in the
    // stylesheet bytes (mirrors touch-controls.test.ts pattern).
    expect(OVERLAY_CSS).toMatch(/\.prev-sentence-btn[\s\S]*?min-(width|height):\s*44px/);
    expect(OVERLAY_CSS).toMatch(/\.next-sentence-btn[\s\S]*?min-(width|height):\s*44px/);
    // Slider thumb / track wrapped in a hitbox ≥ 44px tall.
    expect(OVERLAY_CSS).toMatch(/\.wpm-slider[\s\S]*?min-height:\s*44px/);
  });

  test('CSS sheet bumps prev/next/slider to ≥48px on touch-primary viewports', () => {
    const blockMatch = OVERLAY_CSS.match(/@media\s*\(pointer:\s*coarse\)[^{]*\{([\s\S]*?)\n\}/);
    expect(blockMatch, 'coarse-pointer media block must exist').toBeTruthy();
    const blockBody = blockMatch?.[1] ?? '';
    expect(blockBody).toMatch(/\.prev-sentence-btn[\s\S]*?min-height:\s*48px/);
    expect(blockBody).toMatch(/\.next-sentence-btn[\s\S]*?min-height:\s*48px/);
    expect(blockBody).toMatch(/\.wpm-slider[\s\S]*?min-height:\s*48px/);
  });
});
