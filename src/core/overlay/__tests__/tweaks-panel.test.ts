/**
 * tweaks-panel.test.ts — Step 3 of the Hi-Fi overhaul.
 *
 * Covers the in-overlay Tweaks popover wired to the modal-header ⚙
 * button: open/close, focus management, click-outside dismissal,
 * Escape routing (panel-close-first, then overlay-close), theme
 * picker invocation, and stub-section disabled rendering.
 *
 * The OUTER overlay focus-trap is exercised by focus-trap.test.ts and
 * mount-focus.test.ts; this file adds a regression guard ensuring those
 * paths continue to work alongside the new panel-scoped inner trap.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine } from '../../rsvp-engine';
import { OVERLAY_CLASS } from '../constants';
import { THEME_IDS, type ThemeId } from '../../theme';

const STREAM = ['hello', 'world', 'speed', 'reader'];

function defaultOpts(overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: STREAM.slice(),
    initialSettings: { theme: 'system', wpm: 300, fontSize: 20 },
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

function getSettingsBtn(shadow: ShadowRoot): HTMLButtonElement {
  const btn = shadow.querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.SETTINGS_BTN}`);
  if (!btn) throw new Error('overlay shadow: missing .settings-btn');
  return btn;
}

function getPanel(shadow: ShadowRoot): HTMLElement {
  const panel = shadow.querySelector<HTMLElement>(`.${OVERLAY_CLASS.TWEAKS_PANEL}`);
  if (!panel) throw new Error('overlay shadow: missing .tweaks-panel');
  return panel;
}

function getThemeButtons(shadow: ShadowRoot): HTMLButtonElement[] {
  return Array.from(
    shadow.querySelectorAll<HTMLButtonElement>(
      `.${OVERLAY_CLASS.TWEAKS_PANEL} .${OVERLAY_CLASS.TWEAKS_SEG_BTN}[data-theme-id]`,
    ),
  );
}

describe('createOverlay — Tweaks popover (#step-3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('panel is hidden on initial mount; settingsBtn aria-expanded is "false"', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    expect(getPanel(shadow).hidden).toBe(true);
    expect(getSettingsBtn(shadow).getAttribute('aria-expanded')).toBe('false');
    overlay.unmount();
  });

  test('clicking ⚙ opens the panel: hidden=false, aria-expanded="true", focus moves to first theme button', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    getSettingsBtn(shadow).click();
    expect(getPanel(shadow).hidden).toBe(false);
    expect(getSettingsBtn(shadow).getAttribute('aria-expanded')).toBe('true');
    const first = getThemeButtons(shadow)[0];
    expect(shadow.activeElement).toBe(first);
    overlay.unmount();
  });

  test('clicking ⚙ again closes the panel; focus returns to ⚙', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const settingsBtn = getSettingsBtn(shadow);
    settingsBtn.click();
    settingsBtn.click();
    expect(getPanel(shadow).hidden).toBe(true);
    expect(settingsBtn.getAttribute('aria-expanded')).toBe('false');
    expect(shadow.activeElement).toBe(settingsBtn);
    overlay.unmount();
  });

  test('Escape while panel open closes ONLY the panel; overlay remains mounted; focus returns to ⚙', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const settingsBtn = getSettingsBtn(shadow);
    settingsBtn.click();
    expect(getPanel(shadow).hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.status).toBe('mounted');
    expect(getPanel(shadow).hidden).toBe(true);
    expect(shadow.activeElement).toBe(settingsBtn);
    overlay.unmount();
  });

  test('Escape while panel closed closes the overlay (regression guard)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlay.status).toBe('unmounted');
  });

  test('pointerdown outside the panel (on the backdrop) closes the panel', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    getSettingsBtn(shadow).click();
    expect(getPanel(shadow).hidden).toBe(false);
    const backdrop = shadow.querySelector<HTMLElement>(`.${OVERLAY_CLASS.BACKDROP}`);
    if (!backdrop) throw new Error('shadow: missing .backdrop');
    // pointerdown covers mouse + touch + pen; the production listener is
    // pointerdown so touch-primary users can also dismiss
    // (security-adversary FIX #4).
    backdrop.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(getPanel(shadow).hidden).toBe(true);
    overlay.unmount();
  });

  test('clicking a theme button invokes onThemeChange and flips .active synchronously', () => {
    const onThemeChange = vi.fn();
    const overlay = createOverlay(defaultOpts({ onThemeChange }));
    overlay.mount();
    const shadow = getShadow();
    getSettingsBtn(shadow).click();
    const buttons = getThemeButtons(shadow);
    const darkBtn = buttons.find((b) => b.dataset.themeId === 'dark');
    if (!darkBtn) throw new Error('missing dark theme button');
    darkBtn.click();
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(darkBtn.classList.contains(OVERLAY_CLASS.TWEAKS_SEG_BTN_ACTIVE)).toBe(true);
    expect(darkBtn.getAttribute('aria-pressed')).toBe('true');
    // Other buttons must drop the active state.
    const others = buttons.filter((b) => b !== darkBtn);
    for (const b of others) {
      expect(b.classList.contains(OVERLAY_CLASS.TWEAKS_SEG_BTN_ACTIVE)).toBe(false);
      expect(b.getAttribute('aria-pressed')).toBe('false');
    }
    overlay.unmount();
  });

  test('the System theme button invokes onThemeChange with "system"', () => {
    const onThemeChange = vi.fn();
    const overlay = createOverlay(
      defaultOpts({
        onThemeChange,
        initialSettings: { theme: 'light', wpm: 300, fontSize: 20 },
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    getSettingsBtn(shadow).click();
    const systemBtn = getThemeButtons(shadow).find((b) => b.dataset.themeId === 'system');
    if (!systemBtn) throw new Error('missing system button');
    systemBtn.click();
    expect(onThemeChange).toHaveBeenCalledWith('system');
    overlay.unmount();
  });

  test('active theme on mount matches initialSettings.theme', () => {
    const overlay = createOverlay(
      defaultOpts({ initialSettings: { theme: 'sepia', wpm: 300, fontSize: 20 } }),
    );
    overlay.mount();
    const shadow = getShadow();
    const active = getThemeButtons(shadow).find((b) =>
      b.classList.contains(OVERLAY_CLASS.TWEAKS_SEG_BTN_ACTIVE),
    );
    expect(active?.dataset.themeId).toBe('sepia');
    overlay.unmount();
  });

  test('stub sections (Focus style / Accent / Modal dim) render with disabled controls', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const panel = getPanel(shadow);
    // Three stub sections + the theme section = 4 .tweaks-section nodes.
    const sections = panel.querySelectorAll(`.${OVERLAY_CLASS.TWEAKS_SECTION}`);
    expect(sections.length).toBe(4);
    // Disabled buttons in focus-style section.
    const stubButtons = panel.querySelectorAll<HTMLButtonElement>(
      `.${OVERLAY_CLASS.TWEAKS_SEG_BTN}[disabled]`,
    );
    // Two focus-style stubs + the accent swatch (also a button) — three disabled buttons total.
    // The accent swatch uses a distinct class; check it separately.
    expect(stubButtons.length).toBeGreaterThanOrEqual(2);
    const accentSwatch = panel.querySelector<HTMLButtonElement>(
      `.${OVERLAY_CLASS.TWEAKS_ACCENT_SWATCH}`,
    );
    expect(accentSwatch?.disabled).toBe(true);
    const dimRange = panel.querySelector<HTMLInputElement>(`.${OVERLAY_CLASS.TWEAKS_DIM_RANGE}`);
    expect(dimRange?.disabled).toBe(true);
    expect(dimRange?.type).toBe('range');
    overlay.unmount();
  });

  test('Disclosure pattern — panel does NOT carry role="dialog"/aria-haspopup', () => {
    // Switched from dialog→Disclosure (ARIA-APG) per a11y-extension-
    // designer findings #2/#6: dialog implied modality the panel does
    // not provide, and the prior inner focus trap was escapable via
    // Shift+Tab from the ⚙ button. The Disclosure pattern uses only
    // aria-expanded + aria-controls on the trigger; no role on the panel.
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const panel = getPanel(shadow);
    expect(panel.getAttribute('role')).toBeNull();
    expect(getSettingsBtn(shadow).getAttribute('aria-haspopup')).toBeNull();
    overlay.unmount();
  });

  test('theme buttons exist for every ThemeId plus a System sentinel', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const ids = getThemeButtons(shadow).map((b) => b.dataset.themeId);
    for (const t of THEME_IDS) {
      expect(ids).toContain(t);
    }
    expect(ids).toContain('system');
    overlay.unmount();
  });

  /*
   * Ring-review post-fix coverage (test-gap adversary findings #1/#2/#4/#5
   * + security-adversary #1/#5). The earlier tests verified callback
   * invocation + visual class flip but did NOT pin the click's full
   * side-effect surface (applyTheme on the modal, runtime validation of
   * dataset.themeId, ARIA contract, outer-trap exclusion of the hidden
   * panel, unmount-while-open safety). A future refactor dropping any
   * of those side effects would have silently passed the original suite.
   */
  test('clicking a theme button calls applyTheme — modal --surface flips synchronously', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const modal = shadow.querySelector<HTMLElement>(`.${OVERLAY_CLASS.MODAL}`);
    if (!modal) throw new Error('shadow: missing .modal');
    getSettingsBtn(shadow).click();
    const darkBtn = getThemeButtons(shadow).find((b) => b.dataset.themeId === 'dark');
    if (!darkBtn) throw new Error('panel: missing dark theme button');
    darkBtn.click();
    // applyTheme writes --surface inline on the modal. Dark surface
    // (#292a2d) is verifiable; we just check the value is dark-non-default.
    expect(modal.style.getPropertyValue('--surface')).toBe('#292a2d');
    overlay.unmount();
  });

  test('theme button click with onThemeChange omitted still applies theme locally (session-only contract)', () => {
    const overlay = createOverlay(defaultOpts()); // onThemeChange undefined
    overlay.mount();
    const shadow = getShadow();
    const modal = shadow.querySelector<HTMLElement>(`.${OVERLAY_CLASS.MODAL}`);
    if (!modal) throw new Error('shadow: missing .modal');
    getSettingsBtn(shadow).click();
    const darkBtn = getThemeButtons(shadow).find((b) => b.dataset.themeId === 'dark');
    if (!darkBtn) throw new Error('panel: missing dark theme button');
    darkBtn.click();
    expect(modal.style.getPropertyValue('--surface')).toBe('#292a2d');
    expect(darkBtn.classList.contains(OVERLAY_CLASS.TWEAKS_SEG_BTN_ACTIVE)).toBe(true);
    overlay.unmount();
  });

  test('settingsBtn carries aria-controls; panel labelled by tweaks-heading (Disclosure)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const panel = getPanel(shadow);
    const settingsBtn = getSettingsBtn(shadow);
    // ARIA-APG Disclosure: no role on panel, only the trigger carries the
    // expanded-state contract. The panel still names itself via the
    // heading id for AT users that surface the panel content.
    expect(settingsBtn.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe('sr-tweaks-heading');
    const heading = panel.querySelector<HTMLElement>(`.${OVERLAY_CLASS.TWEAKS_HEADING}`);
    expect(heading?.id).toBe('sr-tweaks-heading');
    overlay.unmount();
  });

  test('dataset.themeId injected with a non-allowlisted value is a no-op (defense-in-depth)', () => {
    const onThemeChange = vi.fn();
    const overlay = createOverlay(defaultOpts({ onThemeChange }));
    overlay.mount();
    const shadow = getShadow();
    const modal = shadow.querySelector<HTMLElement>(`.${OVERLAY_CLASS.MODAL}`);
    if (!modal) throw new Error('shadow: missing .modal');
    const beforeSurface = modal.style.getPropertyValue('--surface');
    getSettingsBtn(shadow).click();
    const lightBtn = getThemeButtons(shadow).find((b) => b.dataset.themeId === 'light');
    if (!lightBtn) throw new Error('panel: missing light theme button');
    // Attacker-style injection — open shadow lets a sibling content script
    // mutate dataset before clicking. Validator must reject.
    lightBtn.dataset.themeId = 'evil-injected-theme';
    lightBtn.click();
    expect(onThemeChange).not.toHaveBeenCalled();
    expect(modal.style.getPropertyValue('--surface')).toBe(beforeSurface);
    overlay.unmount();
  });

  test('outer focus trap excludes focusables inside the hidden tweaks panel', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    expect(getPanel(shadow).hidden).toBe(true);
    // installFocusTrap filters hidden subtrees via isInHiddenSubtree.
    // Programmatic focus-bounce from the top sentinel must NOT land
    // inside the hidden panel — that was the focus-thrash vector flagged
    // by security-adversary #1.
    const sentinels = shadow.querySelectorAll<HTMLElement>(`.${OVERLAY_CLASS.TRAP_SENTINEL}`);
    const [outerTop] = Array.from(sentinels);
    outerTop.focus();
    outerTop.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    const active = shadow.activeElement;
    expect(active).not.toBeNull();
    expect(getPanel(shadow).contains(active as Node)).toBe(false);
    overlay.unmount();
  });

  test('panel has no inner trap sentinels — Disclosure pattern relies on outer trap', () => {
    // Removed when switching from dialog→Disclosure. The outer focus
    // trap's hidden-subtree filter excludes panel buttons while
    // collapsed; when expanded, Tab flows naturally through panel
    // buttons within the modal's existing trap. No inner sentinels.
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const panel = getPanel(shadow);
    expect(panel.querySelectorAll('.tweaks-trap-sentinel').length).toBe(0);
    overlay.unmount();
  });

  test('theme switch writes a polite live-region announcement (WCAG 4.1.3)', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    const ariaLive = shadow.querySelector<HTMLElement>(`.${OVERLAY_CLASS.ARIA_LIVE}`);
    if (!ariaLive) throw new Error('shadow: missing .aria-live');
    getSettingsBtn(shadow).click();
    const darkBtn = getThemeButtons(shadow).find((b) => b.dataset.themeId === 'dark');
    if (!darkBtn) throw new Error('panel: missing dark theme button');
    darkBtn.click();
    expect(ariaLive.textContent).toBe('Theme: Dark');
    overlay.unmount();
  });

  test('sanitizeHostname strips bidi controls + caps to 60 chars', async () => {
    // Direct unit test on the exported helper — stubbing doc.location
    // on a real Document object invalidates jsdom's EventTarget
    // plumbing, so we test the sanitizer in isolation and rely on its
    // contract being preserved at the call site in createOverlay.
    const { sanitizeHostname } = await import('../overlay');
    // Bidi RTL override (U+202E) between letters spoofs the visual order.
    expect(sanitizeHostname('paypa‮l.com')).toBe('paypal.com');
    // Embedding marks (U+202A-U+202E), isolates (U+2066-U+2069), LRM/RLM.
    expect(sanitizeHostname('‎example.com⁩')).toBe('example.com');
    // C0/C1 control bytes.
    expect(sanitizeHostname('hostname.com')).toBe('hostname.com');
    // 60-char cap.
    expect(sanitizeHostname('a'.repeat(120) + '.com').length).toBe(60);
    // Clean hostnames pass through unchanged.
    expect(sanitizeHostname('en.wikipedia.org')).toBe('en.wikipedia.org');
  });

  test('unmount while panel is open is safe — no throw, listeners torn down', () => {
    const overlay = createOverlay(defaultOpts());
    overlay.mount();
    const shadow = getShadow();
    getSettingsBtn(shadow).click();
    expect(getPanel(shadow).hidden).toBe(false);
    expect(() => overlay.unmount()).not.toThrow();
    // After unmount, the host is gone; firing a pointerdown on the now-
    // detached shadow must not throw or otherwise re-enter overlay code.
    expect(() => {
      shadow.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    }).not.toThrow();
  });

  test('subscribeSettings echo flips the active theme button without a panel click', () => {
    const ref: { current: SettingsSubscriber | null } = { current: null };
    const overlay = createOverlay(
      defaultOpts({
        subscribeSettings: (cb) => {
          ref.current = cb;
          return () => {
            ref.current = null;
          };
        },
      }),
    );
    overlay.mount();
    const shadow = getShadow();
    const next: OverlaySettings = { theme: 'nord' as ThemeId, wpm: 300, fontSize: 20 };
    ref.current?.(next);
    const active = getThemeButtons(shadow).find((b) =>
      b.classList.contains(OVERLAY_CLASS.TWEAKS_SEG_BTN_ACTIVE),
    );
    expect(active?.dataset.themeId).toBe('nord');
    overlay.unmount();
  });
});
