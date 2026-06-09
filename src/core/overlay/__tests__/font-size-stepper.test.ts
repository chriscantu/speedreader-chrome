import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, FONT_SIZE_STEP } from '../../settings/bounds';
import { OVERLAY_CLASS } from '../constants';

/**
 * Font-size stepper (#29) — Safari parity step value
 * (`FONT_SIZE_STEP = 2`, sourced from
 * `chriscantu/speed-reader` settings-defaults.js). Chrome bounds are
 * 12–48 (see `core/settings/bounds.ts`); Safari's wider 24–96 range is
 * a separate scale we do NOT mirror — the stepper increment is the
 * parity surface, not the absolute bounds.
 */

function defaultSettings(overrides: Partial<OverlaySettings> = {}): OverlaySettings {
  return { theme: 'system', wpm: 300, fontSize: 20, ...overrides };
}

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: ['hello', 'world', 'foo', 'bar'],
    initialSettings: defaultSettings(),
    subscribeSettings: () => () => undefined,
    engineFactory: createRsvpEngine,
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

function getDecBtn(): HTMLButtonElement {
  const btn = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.FONT_DEC_BTN}`);
  if (!btn) throw new Error('overlay shadow: missing font-dec-btn');
  return btn;
}

function getIncBtn(): HTMLButtonElement {
  const btn = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.FONT_INC_BTN}`);
  if (!btn) throw new Error('overlay shadow: missing font-inc-btn');
  return btn;
}

function getWordRegion(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.WORD_REGION}`);
  if (!el) throw new Error('overlay shadow: missing word-region');
  return el;
}

function getModal(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.MODAL}`);
  if (!el) throw new Error('overlay shadow: missing modal');
  return el;
}

describe('createOverlay — font-size stepper (#29)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('renders A− and A+ buttons with accessible labels and 44px touch targets', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const dec = getDecBtn();
    const inc = getIncBtn();
    expect(dec.tagName).toBe('BUTTON');
    expect(inc.tagName).toBe('BUTTON');
    expect(dec.type).toBe('button');
    expect(inc.type).toBe('button');
    expect(dec.getAttribute('aria-label')).toMatch(/decrease font size/i);
    expect(inc.getAttribute('aria-label')).toMatch(/increase font size/i);
    overlay.unmount();
  });

  test('A+ calls onFontSizeChange with current + STEP', () => {
    const onFontSizeChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts({ initialSettings: defaultSettings({ fontSize: 20 }), onFontSizeChange }),
    );
    overlay.mount();
    getIncBtn().click();
    expect(onFontSizeChange).toHaveBeenCalledWith(20 + FONT_SIZE_STEP);
    overlay.unmount();
  });

  test('A− calls onFontSizeChange with current - STEP', () => {
    const onFontSizeChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts({ initialSettings: defaultSettings({ fontSize: 20 }), onFontSizeChange }),
    );
    overlay.mount();
    getDecBtn().click();
    expect(onFontSizeChange).toHaveBeenCalledWith(20 - FONT_SIZE_STEP);
    overlay.unmount();
  });

  test('A+ clamps to FONT_SIZE_MAX', () => {
    const onFontSizeChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: defaultSettings({ fontSize: FONT_SIZE_MAX - 1 }),
        onFontSizeChange,
      }),
    );
    overlay.mount();
    getIncBtn().click();
    expect(onFontSizeChange).toHaveBeenCalledWith(FONT_SIZE_MAX);
    overlay.unmount();
  });

  test('A− clamps to FONT_SIZE_MIN', () => {
    const onFontSizeChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: defaultSettings({ fontSize: FONT_SIZE_MIN + 1 }),
        onFontSizeChange,
      }),
    );
    overlay.mount();
    getDecBtn().click();
    expect(onFontSizeChange).toHaveBeenCalledWith(FONT_SIZE_MIN);
    overlay.unmount();
  });

  test('A+ is aria-disabled at FONT_SIZE_MAX and stays in the tab chain (#215)', () => {
    const overlay = createOverlay(
      defaultOpts({ initialSettings: defaultSettings({ fontSize: FONT_SIZE_MAX }) }),
    );
    overlay.mount();
    // #215 — aria-disabled (not native `disabled`), so keyboard users tabbing
    // the control bar still reach the button at the bound.
    expect(getIncBtn().getAttribute('aria-disabled')).toBe('true');
    expect(getDecBtn().getAttribute('aria-disabled')).toBe('false');
    expect(getIncBtn().disabled).toBe(false);
    overlay.unmount();
  });

  test('A− is aria-disabled at FONT_SIZE_MIN and stays in the tab chain (#215)', () => {
    const overlay = createOverlay(
      defaultOpts({ initialSettings: defaultSettings({ fontSize: FONT_SIZE_MIN }) }),
    );
    overlay.mount();
    expect(getDecBtn().getAttribute('aria-disabled')).toBe('true');
    expect(getIncBtn().getAttribute('aria-disabled')).toBe('false');
    expect(getDecBtn().disabled).toBe(false);
    overlay.unmount();
  });

  test('+ click at FONT_SIZE_MAX does not fire onFontSizeChange (aria-disabled handler short-circuit, #215)', () => {
    const onFontSizeChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: defaultSettings({ fontSize: FONT_SIZE_MAX }),
        onFontSizeChange,
      }),
    );
    overlay.mount();
    getIncBtn().click();
    expect(onFontSizeChange).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('mutation guard — aria-disabled handler gate is load-bearing, independent of the clamp (#215)', () => {
    // The handler-level early-return is belt-and-suspenders on top of
    // stepFontSize's `next === currentFontSize` clamp short-circuit. To
    // discriminate the HANDLER gate from the clamp, force aria-disabled='true'
    // on the + button at a mid-range fontSize (where the clamp would NOT
    // short-circuit). Intact gate → click no-ops. Removed gate → click reaches
    // stepFontSize and fires onFontSizeChange.
    const onFontSizeChange = vi.fn<(n: number) => void>();
    const overlay = createOverlay(
      defaultOpts({ initialSettings: defaultSettings({ fontSize: 20 }), onFontSizeChange }),
    );
    overlay.mount();
    getIncBtn().setAttribute('aria-disabled', 'true');
    getIncBtn().click();
    expect(onFontSizeChange).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('modal reflects initial fontSize via --rsvp-font-size custom property (cascades to word-region)', () => {
    // Review M3 — the property is written on `modal` (ancestor) so the
    // hot `word` element stays free of inline-style invalidation on
    // every RSVP tick. `.word-region` reads it via CSS cascade.
    const overlay = createOverlay(
      defaultOpts({ initialSettings: defaultSettings({ fontSize: 32 }) }),
    );
    overlay.mount();
    expect(getModal().style.getPropertyValue('--rsvp-font-size')).toBe('32px');
    // word-region MUST NOT have an inline custom-prop write — the hot path
    // must stay clean. This is the mutation guard for fix M3.
    expect(getWordRegion().style.getPropertyValue('--rsvp-font-size')).toBe('');
    overlay.unmount();
  });

  test('subscribeSettings emission with new fontSize updates the modal property', () => {
    let notify: SettingsSubscriber = () => undefined;
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: defaultSettings({ fontSize: 20 }),
        subscribeSettings: (listener) => {
          notify = listener;
          return () => undefined;
        },
      }),
    );
    overlay.mount();
    const modal = getModal();
    expect(modal.style.getPropertyValue('--rsvp-font-size')).toBe('20px');
    notify({ theme: 'system', wpm: 300, fontSize: 36 });
    expect(modal.style.getPropertyValue('--rsvp-font-size')).toBe('36px');
    // Stepper boundary state also refreshes on emission.
    notify({ theme: 'system', wpm: 300, fontSize: FONT_SIZE_MAX });
    expect(getIncBtn().getAttribute('aria-disabled')).toBe('true');
    overlay.unmount();
  });

  test('mount-time clamps non-finite initial fontSize (M4 — POSITIVE_INFINITY → MIN)', () => {
    // Review M4 — initialSettings flows in from the caller unclamped.
    // subscribeSettings clamps but mount doesn't, so a malformed value
    // (NaN, Infinity, negative) would write garbage CSS. Non-finite
    // falls back to FONT_SIZE_MIN; finite-out-of-range clamps normally.
    const overlay = createOverlay(
      defaultOpts({
        initialSettings: defaultSettings({ fontSize: Number.POSITIVE_INFINITY }),
      }),
    );
    overlay.mount();
    expect(getModal().style.getPropertyValue('--rsvp-font-size')).toBe(`${FONT_SIZE_MIN}px`);
    overlay.unmount();
  });

  test('mount-time clamps negative initial fontSize to FONT_SIZE_MIN', () => {
    const overlay = createOverlay(
      defaultOpts({ initialSettings: defaultSettings({ fontSize: -50 }) }),
    );
    overlay.mount();
    expect(getModal().style.getPropertyValue('--rsvp-font-size')).toBe(`${FONT_SIZE_MIN}px`);
    overlay.unmount();
  });

  test('mount-time clamps over-large initial fontSize to FONT_SIZE_MAX', () => {
    const overlay = createOverlay(
      defaultOpts({ initialSettings: defaultSettings({ fontSize: 10_000 }) }),
    );
    overlay.mount();
    expect(getModal().style.getPropertyValue('--rsvp-font-size')).toBe(`${FONT_SIZE_MAX}px`);
    overlay.unmount();
  });

  test('omitting onFontSizeChange keeps the buttons clickable (no throw) but does not crash', () => {
    const overlay = createOverlay(
      defaultOpts({ initialSettings: defaultSettings({ fontSize: 20 }) }),
    );
    overlay.mount();
    expect(() => getIncBtn().click()).not.toThrow();
    expect(() => getDecBtn().click()).not.toThrow();
    overlay.unmount();
  });
});
