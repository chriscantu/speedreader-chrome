/**
 * opendyslexic.test.ts — issue #27
 *
 * The OpenDyslexic font toggle binds the user setting to a class on the
 * overlay modal. The class flip activates the `.modal.opendyslexic` CSS
 * rule in `styles.ts` which switches `font-family` to the bundled
 * OpenDyslexic family with a system-ui fallback.
 *
 * The bundled font binary is loaded via an `@font-face` rule the overlay
 * injects into the shadow root at mount, parameterised by
 * `OverlayOptions.openDyslexicFontUrl` (since `core/` cannot call
 * `chrome.runtime.getURL`). Injection is scoped to the shadow root so the
 * declaration does NOT bleed to host-page CSS — the issue's "applies to
 * the overlay only" constraint.
 *
 * Coverage pins:
 *  - mount with `openDyslexic: false` → no `.opendyslexic` class
 *  - mount with `openDyslexic: true` → class present
 *  - mount with `openDyslexic` omitted (legacy callers) → no class
 *  - subscribeSettings flips toggle on/off without remount
 *  - `@font-face` rule injected into the shadow root when URL provided
 *  - `@font-face` NOT injected when URL omitted (toggle still works as
 *    a pure class flip — graceful degradation per the issue scope note
 *    that #173's binary may not yet exist)
 */
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';
import { OVERLAY_CLASS } from '../constants';

const STREAM = ['hello', 'world', 'foo', 'bar'];
const FONT_URL = 'chrome-extension://stub-extension-id/fonts/OpenDyslexic-Regular.woff2';

function defaultSettings(overrides: Partial<OverlaySettings> = {}): OverlaySettings {
  return { theme: 'system', wpm: 300, fontSize: 20, ...overrides };
}

function makeOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: STREAM,
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

function getModal(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.MODAL}`);
  if (!el) throw new Error('overlay shadow: missing modal');
  return el;
}

/**
 * Pull every stylesheet text the overlay attached to the shadow root,
 * concatenated. Works for both the adoptedStyleSheets path (real browsers,
 * modern jsdom) and the inline `<style>` fallback.
 */
function getShadowCss(): string {
  const shadow = getShadow();
  const adopted = (shadow as ShadowRoot & { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets;
  const adoptedCss =
    adopted && adopted.length > 0
      ? adopted
          .map((s) =>
            Array.from(s.cssRules ?? [])
              .map((r) => r.cssText)
              .join('\n'),
          )
          .join('\n')
      : '';
  const inlineCss = Array.from(shadow.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('\n');
  return `${adoptedCss}\n${inlineCss}`;
}

describe('createOverlay — OpenDyslexic toggle (#27)', () => {
  beforeEach(() => {
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });
  afterEach(() => {
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('mount with openDyslexic=false does NOT apply the modal class', () => {
    const overlay = createOverlay(
      makeOpts({ initialSettings: defaultSettings({ openDyslexic: false }) }),
    );
    overlay.mount();
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(false);
    overlay.unmount();
  });

  test('mount with openDyslexic=true applies the modal class', () => {
    const overlay = createOverlay(
      makeOpts({ initialSettings: defaultSettings({ openDyslexic: true }) }),
    );
    overlay.mount();
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(true);
    overlay.unmount();
  });

  test('mount with openDyslexic omitted (legacy callers) does NOT apply the modal class', () => {
    // Defaults intentionally omit `openDyslexic` to model older callers.
    const overlay = createOverlay(makeOpts());
    overlay.mount();
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(false);
    overlay.unmount();
  });

  test('subscribeSettings push flips the toggle ON without remount', () => {
    let listener: SettingsSubscriber | undefined;
    const subscribeSettings = (l: SettingsSubscriber): (() => void) => {
      listener = l;
      return () => undefined;
    };
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ openDyslexic: false }),
        subscribeSettings,
      }),
    );
    overlay.mount();
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(false);

    listener?.(defaultSettings({ openDyslexic: true }));
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(true);
    overlay.unmount();
  });

  test('subscribeSettings push flips the toggle OFF without remount', () => {
    let listener: SettingsSubscriber | undefined;
    const subscribeSettings = (l: SettingsSubscriber): (() => void) => {
      listener = l;
      return () => undefined;
    };
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ openDyslexic: true }),
        subscribeSettings,
      }),
    );
    overlay.mount();
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(true);

    listener?.(defaultSettings({ openDyslexic: false }));
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(false);
    overlay.unmount();
  });

  test('@font-face for OpenDyslexic is injected into the shadow root when URL provided', () => {
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ openDyslexic: true }),
        openDyslexicFontUrl: FONT_URL,
      }),
    );
    overlay.mount();
    const css = getShadowCss();
    expect(css).toContain('@font-face');
    expect(css).toContain('OpenDyslexic');
    expect(css).toContain(FONT_URL);
    overlay.unmount();
  });

  test('@font-face is NOT injected when openDyslexicFontUrl is omitted', () => {
    const overlay = createOverlay(
      makeOpts({ initialSettings: defaultSettings({ openDyslexic: true }) }),
    );
    overlay.mount();
    const css = getShadowCss();
    expect(css).not.toContain('@font-face');
    // Class still flips — toggle is a pure class flip independent of the
    // font binary. When #173 lands and the binary appears, the same class
    // flip starts applying the bundled face.
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(true);
    overlay.unmount();
  });
});

describe('OVERLAY_CSS — OpenDyslexic family stack (#27)', () => {
  test('`.modal.opendyslexic` declaration sets font-family with OpenDyslexic first and a system-ui fallback', async () => {
    const { OVERLAY_CSS } = await import('../styles');
    // Bound the assertion to the load-bearing selector AND the family-order
    // contract: OpenDyslexic must be the first family in the stack, and
    // system-ui must appear in the fallback list so a font-load failure
    // degrades gracefully. A bare `includes('OpenDyslexic')` would survive
    // someone reordering the stack to put system-ui first (which would
    // silently disable the toggle's visible effect on browsers that ship
    // system-ui).
    expect(OVERLAY_CSS).toMatch(
      /\.modal\.opendyslexic\s*\{[^}]*font-family:[\s\S]*?'OpenDyslexic'[^}]*system-ui/,
    );
  });
});

describe('buildOpenDyslexicFontFace — @font-face contract (#27)', () => {
  test('emits a single @font-face rule binding `OpenDyslexic` to the supplied URL with woff2 format', async () => {
    const { buildOpenDyslexicFontFace } = await import('../styles');
    const out = buildOpenDyslexicFontFace(FONT_URL);
    expect(out).toMatch(/@font-face\s*\{/);
    expect(out).toMatch(/font-family:\s*'OpenDyslexic'/);
    expect(out).toContain(FONT_URL);
    expect(out).toMatch(/format\('woff2'\)/);
  });
});
