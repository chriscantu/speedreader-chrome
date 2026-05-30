/**
 * font-picker.test.ts — issue #28
 *
 * Expands the #27 OpenDyslexic toggle into a 5-font picker matching the
 * Safari extension's `ReaderFont` enum. Coverage:
 *
 *  - resolveFontId() — `font` literal wins, legacy `openDyslexic: true`
 *    promotes, unknown values fall back to 'system'
 *  - mount with each picker ID applies the matching `.modal.<font-id>` class
 *  - subscribeSettings push swaps between picker IDs without remount
 *  - @font-face for OpenDyslexic is injected only when a URL is supplied
 *    (graceful fallback when the binary is missing per #173)
 *  - @font-face URL is validated against the chrome-extension:// shape
 *    (XSS guard preserved from #27)
 *  - opendyslexic fallback: when the URL is omitted and the user selects
 *    OpenDyslexic, the modal class still flips so the family stack
 *    degrades to system-ui rather than throwing
 */
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';
import { OVERLAY_CLASS } from '../constants';
import { FONT_IDS, resolveFontId, type FontId } from '../font-ids';

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

describe('resolveFontId (#28 migration)', () => {
  test('returns the picker ID when font is a known FontId', () => {
    for (const id of FONT_IDS) {
      expect(resolveFontId({ font: id })).toBe(id);
    }
  });

  test('promotes legacy openDyslexic=true to opendyslexic when font is absent', () => {
    expect(resolveFontId({ openDyslexic: true })).toBe('opendyslexic');
  });

  test('font picker ID wins over legacy openDyslexic flag', () => {
    expect(resolveFontId({ font: 'georgia', openDyslexic: true })).toBe('georgia');
  });

  test('unknown font literal falls back to system', () => {
    expect(resolveFontId({ font: 'Comic Sans' })).toBe('system');
    expect(resolveFontId({ font: '' })).toBe('system');
    expect(resolveFontId({ font: null })).toBe('system');
  });

  test('absent inputs fall back to system', () => {
    expect(resolveFontId({})).toBe('system');
  });
});

describe('createOverlay — font picker (#28)', () => {
  beforeEach(() => {
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });
  afterEach(() => {
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test.each(FONT_IDS)('mount with font=%s applies the matching modal class', (fontId: FontId) => {
    const overlay = createOverlay(makeOpts({ initialSettings: defaultSettings({ font: fontId }) }));
    overlay.mount();
    const modal = getModal();
    // 'system' is the no-op default: NO font class is applied (the default
    // family stack at :host already wins). Every other ID gets its
    // matching class and only that one — picker IDs are mutually exclusive.
    for (const id of FONT_IDS) {
      const expected = id !== 'system' && id === fontId;
      expect(modal.classList.contains(id)).toBe(expected);
    }
    overlay.unmount();
  });

  test('mount with no font setting defaults to system (no font class applied)', () => {
    const overlay = createOverlay(makeOpts());
    overlay.mount();
    const modal = getModal();
    for (const id of FONT_IDS) {
      // 'system' is the no-op default — modal carries no font class.
      expect(modal.classList.contains(id)).toBe(false);
    }
    overlay.unmount();
  });

  test('mount with legacy openDyslexic=true (no font) applies opendyslexic class', () => {
    const overlay = createOverlay(
      makeOpts({ initialSettings: defaultSettings({ openDyslexic: true }) }),
    );
    overlay.mount();
    expect(getModal().classList.contains('opendyslexic')).toBe(true);
    overlay.unmount();
  });

  test('subscribeSettings push swaps between picker IDs without remount', () => {
    let listener: SettingsSubscriber | undefined;
    const subscribeSettings = (l: SettingsSubscriber): (() => void) => {
      listener = l;
      return () => undefined;
    };
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ font: 'system' }),
        subscribeSettings,
      }),
    );
    overlay.mount();
    const modal = getModal();
    expect(modal.classList.contains('system')).toBe(false);

    listener?.(defaultSettings({ font: 'georgia' }));
    expect(modal.classList.contains('georgia')).toBe(true);
    expect(modal.classList.contains('opendyslexic')).toBe(false);

    listener?.(defaultSettings({ font: 'menlo' }));
    expect(modal.classList.contains('menlo')).toBe(true);
    expect(modal.classList.contains('georgia')).toBe(false);

    listener?.(defaultSettings({ font: 'opendyslexic' }));
    expect(modal.classList.contains('opendyslexic')).toBe(true);
    expect(modal.classList.contains('menlo')).toBe(false);

    listener?.(defaultSettings({ font: 'system' }));
    expect(modal.classList.contains('opendyslexic')).toBe(false);

    overlay.unmount();
  });

  test('@font-face for OpenDyslexic is injected when URL provided', () => {
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ font: 'opendyslexic' }),
        openDyslexicFontUrl: FONT_URL,
      }),
    );
    overlay.mount();
    const css = getShadowCss();
    expect(css).toContain('@font-face');
    expect(css).toContain('OpenDyslexic');
    expect(css).toContain(FONT_URL);
    expect(css).toMatch(/format\('woff2'\)/);
    overlay.unmount();
  });

  test('missing OpenDyslexic binary falls back to system-ui without throwing', () => {
    // No openDyslexicFontUrl — the binary is missing per #173 sourcing gap.
    // Mount must succeed and the modal class still flips so the family stack
    // in styles.ts degrades to system-ui (the fallback list ends in sans-serif).
    const overlay = createOverlay(
      makeOpts({ initialSettings: defaultSettings({ font: 'opendyslexic' }) }),
    );
    expect(() => overlay.mount()).not.toThrow();
    expect(getModal().classList.contains('opendyslexic')).toBe(true);
    const css = getShadowCss();
    // No @font-face — the URL was omitted.
    expect(css).not.toMatch(/@font-face\s*\{[^}]*OpenDyslexic/);
    overlay.unmount();
  });

  test('mount rejects a malicious openDyslexicFontUrl that tries to escape the url("…") wrapper', () => {
    const malicious = 'a") format("woff2"); } body { background: url("https://evil/';
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ font: 'opendyslexic' }),
        openDyslexicFontUrl: malicious,
      }),
    );
    expect(() => overlay.mount()).toThrow(/untrusted URL/);
  });

  // #27 regression cases restored from the deleted opendyslexic.test.ts.
  // These pin behaviour that the picker generalisation must not silently
  // swallow: legacy callers omitting `font` and `openDyslexic`, live
  // toggle-off via subscribeSettings, and the @font-face injection gate.

  test('subscribeSettings push flips the OpenDyslexic class OFF without remount', () => {
    let listener: SettingsSubscriber | undefined;
    const subscribeSettings = (l: SettingsSubscriber): (() => void) => {
      listener = l;
      return () => undefined;
    };
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ font: 'opendyslexic' }),
        subscribeSettings,
      }),
    );
    overlay.mount();
    const modal = getModal();
    expect(modal.classList.contains('opendyslexic')).toBe(true);

    listener?.(defaultSettings({ font: 'system' }));
    expect(modal.classList.contains('opendyslexic')).toBe(false);

    overlay.unmount();
  });

  test('mount with openDyslexic omitted (legacy callers) does NOT apply the modal class', () => {
    // Legacy callers pre-#27 / pre-#28 omit both `font` and `openDyslexic`
    // from initialSettings. resolveFontId returns `'system'` and the
    // modal must NOT carry the opendyslexic class.
    const overlay = createOverlay(makeOpts());
    overlay.mount();
    expect(getModal().classList.contains('opendyslexic')).toBe(false);
    overlay.unmount();
  });

  test('@font-face is NOT injected when openDyslexicFontUrl is omitted', () => {
    // Strict mutation guard: a contributor swapping `if (opts.openDyslexicFontUrl)`
    // for `if (true)` would re-introduce a hard-coded @font-face. The
    // strict not.toContain('@font-face') assertion bites that mutation
    // deterministically.
    const overlay = createOverlay(
      makeOpts({ initialSettings: defaultSettings({ font: 'opendyslexic' }) }),
    );
    overlay.mount();
    const css = getShadowCss();
    expect(css).not.toContain('@font-face');
    overlay.unmount();
  });

  test('@font-face rule binds OpenDyslexic to the supplied URL with woff2 format', () => {
    // Standalone assertion that the rule shape — family, src URL, format —
    // is intact end-to-end. Mutation guard: swapping the family literal,
    // dropping format('woff2'), or substituting the URL all fail here.
    const overlay = createOverlay(
      makeOpts({
        initialSettings: defaultSettings({ font: 'opendyslexic' }),
        openDyslexicFontUrl: FONT_URL,
      }),
    );
    overlay.mount();
    const css = getShadowCss();
    expect(css).toMatch(/font-family:\s*'OpenDyslexic'/);
    expect(css).toMatch(/format\('woff2'\)/);
    expect(css).toContain(FONT_URL);
    overlay.unmount();
  });
});

describe('OVERLAY_CSS — font picker family stacks (#28)', () => {
  test.each([
    ['opendyslexic', /'OpenDyslexic'[^}]*system-ui/],
    ['newYork', /'New York'[^}]*'Iowan Old Style'[^}]*Georgia[^}]*serif/],
    ['georgia', /Georgia[^}]*'Times New Roman'[^}]*serif/],
    ['menlo', /Menlo[^}]*'Courier New'[^}]*monospace/],
  ])('binds font ID "%s" to the expected family stack', async (fontId, expectedFamily) => {
    const { OVERLAY_CSS } = await import('../styles');
    // Bound to the reading-surface selector list (Safari parity: UI chrome
    // stays in system font; whole-modal font swap is a future extension).
    const selectorBlock = new RegExp(
      `\\.modal\\.${fontId}\\s+\\.word-region[\\s\\S]*?\\.context-current[\\s\\S]*?\\.context-preview\\s*\\{[\\s\\S]*?font-family:[\\s\\S]*?\\}`,
    );
    const match = OVERLAY_CSS.match(selectorBlock);
    expect(match, `missing .modal.${fontId} reading-surface rule`).not.toBeNull();
    expect(match?.[0]).toMatch(expectedFamily);
  });
});
