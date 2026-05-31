/**
 * scrubber.test.ts — issue #47
 *
 * Progress scrubber (Safari-parity time-labeled position control) wired
 * to the engine via the existing subscribe handler.
 *
 * Coverage:
 *  - DOM renders with `<input type="range">`, accessible label, numeric
 *    min/max/value/step, time labels visible at mount with pre-start values
 *  - subscribe handler updates scrubber value + labels + aria-valuetext on
 *    each `word` emission (Q4 — per-emission)
 *  - WPM subscribeSettings push refreshes time labels (timer math is
 *    WPM-dependent) without touching scrubber value/max
 *  - input event drives engine.seekTo with the integer value and pauses
 *    a playing engine
 *  - mousedown/touchstart pause a playing engine (interaction priming)
 *  - keyboard guard: ArrowLeft/Right on the scrubber does NOT fire
 *    engine.seekToSentence (native <input type="range"> owns the keys)
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine, type RsvpEngine, type RsvpEngineOptions } from '../../rsvp-engine';
import { OVERLAY_CLASS, OVERLAY_TEXT } from '../constants';

const STREAM = ['Hello.', 'How', 'are', 'you?', 'I', 'am', 'fine.', 'Bye!'];

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

function getScrubber(): HTMLInputElement {
  const el = getShadow().querySelector<HTMLInputElement>(`.${OVERLAY_CLASS.SCRUBBER_SLIDER}`);
  if (!el) throw new Error('overlay shadow: missing scrubber-slider');
  return el;
}

function getElapsedLabel(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.SCRUBBER_ELAPSED}`);
  if (!el) throw new Error('overlay shadow: missing scrubber-elapsed');
  return el;
}

function getRemainingLabel(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.SCRUBBER_REMAINING}`);
  if (!el) throw new Error('overlay shadow: missing scrubber-remaining');
  return el;
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

describe('createOverlay — scrubber DOM (#47)', () => {
  test('renders <input type="range"> with accessible label + numeric attrs', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    expect(s.tagName).toBe('INPUT');
    expect(s.type).toBe('range');
    expect(s.getAttribute('aria-label')).toBe(OVERLAY_TEXT.SCRUBBER_LABEL);
    expect(s.min).toBe('0');
    expect(s.max).toBe(String(STREAM.length - 1));
    expect(s.step).toBe('1');
    expect(s.value).toBe('0');
    overlay.unmount();
  });

  test('mounts above the footer so visual order is word → preview → scrubber → controls', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const shadow = getShadow();
    const scrubberArea = shadow.querySelector(`.${OVERLAY_CLASS.SCRUBBER_AREA}`);
    const footer = shadow.querySelector(`.${OVERLAY_CLASS.FOOTER}`);
    if (!scrubberArea) throw new Error('expected scrubber-area in shadow');
    if (!footer) throw new Error('expected footer in shadow');
    // DOCUMENT_POSITION_FOLLOWING (4) ⇒ footer comes AFTER scrubber-area.
    const order = scrubberArea.compareDocumentPosition(footer);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    overlay.unmount();
  });

  test('post-mount labels reflect engine state after the synchronous first-word emission', () => {
    // engine.start() fires synchronously inside mount() and emits word[0],
    // so by the time we observe, progress.index === 1.
    //   wpm=300 ⇒ msPerWord=200; elapsed = 1*200=200ms → round → 0 → "0:00".
    //   remaining = 7*200=1400ms → round(1.4)=1 → "-0:01".
    //   value = max(0, 1-1) = 0.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(getScrubber().value).toBe('0');
    expect(getElapsedLabel().textContent).toBe('0:00');
    expect(getRemainingLabel().textContent).toBe('-0:01');
    expect(getScrubber().getAttribute('aria-valuetext')).toBe(OVERLAY_TEXT.scrubberValueText(0, 1));
    overlay.unmount();
  });
});

describe('createOverlay — scrubber engine wiring (#47)', () => {
  test('word emission advances scrubber value + updates labels + aria-valuetext', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    // First tick fires synchronously inside engine.start(); subsequent
    // ticks are setTimeout-scheduled. Pause after the first emission so
    // we can read a deterministic state.
    engineOf(holder).pause();
    // value = max(0, progress.index - 1) → 0 after the first emission
    const s = getScrubber();
    expect(s.value).toBe('0');
    // Advance to the third word programmatically via seekTo so we exercise
    // the paused-state replacement word emission's effect on the scrubber.
    //
    // Engine quirk worth pinning: in word mode, the paused-state seekTo
    // emits the replacement word event with `nextIndex === target`, then
    // bumps to `target + 1` AFTER the emit returns. The subscribe
    // handler reads `progress().index` DURING the emit, so it sees
    // `target` (here: 2), not `target + 1`. The scrubber formula
    // `value = max(0, index - 1)` therefore yields `1` on paused-seek
    // to 2 — the value reflects the raw position of the just-emitted
    // word, which is what we want visually anyway (thumb sits at the
    // token the user can see). A mutation that swapped the formula to
    // `value = index` would surface as scrubber-by-one drift across
    // both tick and paused-seek paths.
    engineOf(holder).seekTo(2);
    expect(s.value).toBe('1');
    // Elapsed at progress.index === 2 is 2 * 200ms = 400ms → "0:00"
    // (Math.round(0.4) === 0). Remaining: 6 * 200ms = 1200ms → "-0:01".
    expect(getElapsedLabel().textContent).toBe('0:00');
    expect(getRemainingLabel().textContent).toBe('-0:01');
    expect(s.getAttribute('aria-valuetext')).toBe(OVERLAY_TEXT.scrubberValueText(0, 1));
    overlay.unmount();
  });

  test('subscribeSettings wpm push refreshes time labels without touching value/max', () => {
    const holder: Holder = { engine: null };
    let notify: SettingsSubscriber = () => undefined;
    const overlay = createOverlay(
      defaultOpts(holder, {
        subscribeSettings: (cb) => {
          notify = cb;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    engineOf(holder).pause();
    const beforeValue = getScrubber().value;
    const beforeMax = getScrubber().max;
    const next: OverlaySettings = { theme: 'system', wpm: 60, fontSize: 20 };
    notify(next);
    // After mount + pause, engine.progress().index === 1 (the first word
    // was emitted synchronously inside start()). wpm=60 → 1000ms/word.
    // remaining = (8 - 1) * 1000 = 7000ms → "-0:07".
    expect(getRemainingLabel().textContent).toBe('-0:07');
    expect(getScrubber().value).toBe(beforeValue);
    expect(getScrubber().max).toBe(beforeMax);
    overlay.unmount();
  });
});

describe('createOverlay — scrubber interaction (#47)', () => {
  test('input event invokes engine.seekTo with the integer value', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    const seekToSpy = vi.spyOn(engineOf(holder), 'seekTo');
    s.value = '4';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(seekToSpy).toHaveBeenCalledWith(4, { snapToSentence: false });
    overlay.unmount();
  });

  test('input event pauses a playing engine (Safari spec — pause-on-scrub)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    const s = getScrubber();
    s.value = '3';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(engineOf(holder).state).toBe('paused');
    overlay.unmount();
  });

  test('mousedown pauses a playing engine (interaction priming)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    const s = getScrubber();
    s.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(engineOf(holder).state).toBe('paused');
    overlay.unmount();
  });

  test('touchstart pauses a playing engine (interaction priming)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(engineOf(holder).state).toBe('playing');
    const s = getScrubber();
    s.dispatchEvent(new Event('touchstart', { bubbles: true }));
    expect(engineOf(holder).state).toBe('paused');
    overlay.unmount();
  });

  test('non-finite input value is a no-op — does not corrupt engine state', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    const seekToSpy = vi.spyOn(engineOf(holder), 'seekTo');
    // Force-bypass the native input clamp by setting a value the browser
    // wouldn't normally surface, then dispatch. Since `s.value` is always
    // a string and Number('') === 0, simulate via setAttribute hack —
    // BUT the realistic mutation here is the Number guard's no-op path.
    // The contract is: even if the value is empty / garbage, we never
    // call seekTo with a NaN.
    Object.defineProperty(s, 'value', { configurable: true, get: () => 'not-a-number' });
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(seekToSpy).not.toHaveBeenCalled();
    overlay.unmount();
  });
});

describe('createOverlay — scrubber keyboard guard (#47)', () => {
  test('ArrowLeft with scrubber focused does NOT call engine.seekToSentence', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    s.focus();
    const spy = vi.spyOn(engineOf(holder), 'seekToSentence');
    s.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(spy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('ArrowRight with scrubber focused does NOT call engine.seekToSentence', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const s = getScrubber();
    s.focus();
    const spy = vi.spyOn(engineOf(holder), 'seekToSentence');
    s.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    expect(spy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('ArrowLeft on document body STILL calls engine.seekToSentence (guard is scrubber-scoped)', () => {
    // Mutation guard: a naive guard that ignores ALL ArrowLeft (not just
    // when target === scrubber) would silently break the global keyboard
    // shortcut. This test pins the scope of the guard.
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    engineOf(holder).pause();
    const spy = vi.spyOn(engineOf(holder), 'seekToSentence');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }),
    );
    expect(spy).toHaveBeenCalledWith('prev');
    overlay.unmount();
  });
});
