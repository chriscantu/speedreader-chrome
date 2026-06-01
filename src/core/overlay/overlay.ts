import { applyTheme, THEME_IDS } from '../theme';
import type { ThemeId } from '../theme';
import { OVERLAY_CSS } from './styles';
import { OVERLAY_ATTR, OVERLAY_CLASS, OVERLAY_ID, OVERLAY_TEXT } from './constants';
import { FONT_IDS, resolveFontId, type FontId } from './font-ids';
import type {
  OverlayCloseSnapshot,
  OverlayHandle,
  OverlayOptions,
  OverlayScope,
  OverlayStatus,
} from './types';
import type { RsvpEngine } from '../rsvp-engine';
import { renderChunk, renderWord } from './word';
import { buildSentenceContext } from './sentence-context';
import { installFocusTrap } from './focus-trap';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  WPM_MAX,
  WPM_MIN,
  WPM_STEP,
} from '../settings/bounds';

/**
 * Snapshot of the scope-aware view at mount time. The CS pre-tokenizes both
 * selection and full streams, so building the header text and choosing the
 * active engine words is purely local.
 */
interface ScopeView {
  /** Resolved scope: 'selection' or 'full'. */
  readonly scope: OverlayScope;
  /** Engine word stream chosen by the resolved scope. */
  readonly activeWords: string[];
  /** Text rendered inside the scoped header h2. */
  readonly headerText: string;
  /** True when the `← Full article` scope-swap button should be rendered. */
  readonly showSwapBtn: boolean;
  /**
   * Non-null when an empty-selection fallback fired. Drives the visible
   * subtitle and one-shot aria-live announcement (AC #15).
   */
  readonly fallback: 'empty-selection' | null;
}

function buildScopeView(opts: OverlayOptions): ScopeView | null {
  if (!opts.scope) return null;

  const wpm = opts.initialSettings.wpm;
  const selectionWords = opts.selectionWords ?? [];
  const fullWords = opts.fullWords ?? [];
  const formatSec = (n: number): number => Math.round((n * 60) / wpm);

  if (opts.scope === 'selection' && selectionWords.length > 0) {
    return {
      scope: 'selection',
      activeWords: selectionWords,
      headerText: OVERLAY_TEXT.scopedHeader(
        selectionWords.length,
        formatSec(selectionWords.length),
      ),
      showSwapBtn: true,
      fallback: null,
    };
  }

  const title = opts.articleTitle?.trim();
  // Empty-selection fallback: user requested 'selection' but the selection
  // text was empty (cleared between menu open and click, or never present
  // on a non-text context-menu invocation). Resolve to full-article scope
  // and flag the fallback so the overlay surfaces an explanatory subtitle
  // and a one-shot polite announcement (spec §"Selection cleared between
  // menu open and click", AC #15).
  const fallback = opts.scope === 'selection' ? 'empty-selection' : null;
  return {
    scope: 'full',
    activeWords: fullWords,
    headerText:
      title && title.length > 0 ? title : OVERLAY_TEXT.fullHeaderFallback(fullWords.length),
    showSwapBtn: false,
    fallback,
  };
}

/**
 * Resolve the 'system' sentinel to a concrete ThemeId using
 * prefers-color-scheme. Falls back to 'light' in environments that do not
 * support matchMedia (e.g. jsdom without a media-query stub).
 */
function resolveTheme(theme: ThemeId | 'system', win: Window & typeof globalThis): ThemeId {
  if (theme !== 'system') return theme;
  try {
    return win.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const HOST_ATTR = OVERLAY_ATTR.HOST;

/**
 * Build the @font-face rule for the bundled OpenDyslexic woff2 (#27).
 *
 * Validates the URL shape before interpolation so an unexpected caller
 * cannot inject CSS via crafted strings. Only `chrome-extension://` URLs
 * with a non-empty path and no quote/angle-bracket/whitespace characters
 * are accepted — anything else throws. The single legitimate caller is
 * `chrome.runtime.getURL()` for the bundled WAR font path.
 */
/**
 * Strip bidi-control + C0/C1 controls from a hostname and cap visible
 * length. Inputs flow from `document.location.hostname` — attacker-
 * reachable through any page the content script attaches to. Bidi
 * marks (RTL override, isolates) flip surrounding announcement order
 * and enable visual brand spoofing; C0/C1 controls disrupt screen
 * reader output. Cap at 60 chars so a long hostname does not dominate
 * the modal chrome (a11y + security review finding #7).
 */
export function sanitizeHostname(hostname: string): string {
  // C0 (0000-001F), DEL+C1 (007F-009F), bidi LRM/RLM (200E-200F),
  // embedding/override (202A-202E), isolates (2066-2069).
  // eslint-disable-next-line no-control-regex
  const UNSAFE = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
  return hostname.replace(UNSAFE, '').slice(0, 60);
}

function buildOpenDyslexicFontFace(url: string): string {
  if (!/^chrome-extension:\/\/[a-zA-Z0-9_-]+\/[^"<>\s]+$/.test(url)) {
    throw new Error(`buildOpenDyslexicFontFace: untrusted URL ${url}`);
  }
  return `@font-face {
  font-family: 'OpenDyslexic';
  src: url("${url}") format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}`;
}

export function createOverlay(opts: OverlayOptions): OverlayHandle {
  let status: OverlayStatus = 'unmounted';
  let host: HTMLElement | null = null;
  let engine: RsvpEngine | null = null;
  let unsubscribeSettings: (() => void) | null = null;
  let uninstallTrap: (() => void) | null = null;
  let onKeydown: ((e: KeyboardEvent) => void) | null = null;
  // #step-3 — symmetric teardown for the shadow-root pointerdown listener
  // installed for the panel's click-outside ergonomics. Every other shadow
  // listener add/remove pairs explicitly; this matches that pattern.
  let uninstallTweaksPointerDown: (() => void) | null = null;
  // #26 — live OS theme listener teardown. Attached during mount when
  // matchMedia is available; the same closure is invoked by
  // `subscribeSettings` to swap behaviour when the user toggles the
  // theme between `'system'` and an explicit override.
  let uninstallSystemThemeListener: (() => void) | null = null;
  let priorOverflow: string | null = null;
  // #48 — toast auto-dismiss timer. Hoisted so unmount can clear it if
  // the user closes the overlay inside the 5 s window (otherwise the
  // setTimeout pins the removed shadow root + toast node until it fires).
  let resumeToastTimer: ReturnType<typeof setTimeout> | null = null;
  // #47 ring-review FIX-6 / FIX-7 — scrub debounce timer. Hoisted so
  // unmount can clear a pending timer; otherwise it would reach into a
  // detached shadow when it fires and flip the scrub flag on a closure
  // that no longer matters.
  let scrubDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  // Lifted into the outer closure so `unmount()` can build the close
  // snapshot for `onClose` (#25). Reassigned on scope-swap so the
  // snapshot reflects the active stream at close time, not the mount
  // time scope. `null` when the caller used the legacy single-stream
  // form (no `scope` in OverlayOptions) — snapshot is suppressed in
  // that case since there's no scope key for the host to map under.
  let currentScope: OverlayScope | null = null;

  function buildShadowTree(
    shadow: ShadowRoot,
    scopeView: ScopeView | null,
  ): {
    modal: HTMLElement;
    header: HTMLElement;
    word: HTMLElement;
    closeBtn: HTMLButtonElement;
    playPauseBtn: HTMLButtonElement;
    swapBtn: HTMLButtonElement | null;
    fontDecBtn: HTMLButtonElement;
    fontIncBtn: HTMLButtonElement;
    prevSentenceBtn: HTMLButtonElement;
    nextSentenceBtn: HTMLButtonElement;
    wpmSlider: HTMLInputElement;
    wpmReadout: HTMLElement;
    ariaLive: HTMLElement;
    preview: HTMLElement;
    scrubber: HTMLInputElement;
    scrubberElapsed: HTMLElement;
    scrubberRemaining: HTMLElement;
    settingsBtn: HTMLButtonElement;
    tweaksPanel: HTMLElement;
    themeButtons: HTMLButtonElement[];
  } {
    const doc = opts.doc;

    const ctor = doc.defaultView?.CSSStyleSheet;
    if (typeof ctor === 'function') {
      const sheet = new ctor();
      sheet.replaceSync(OVERLAY_CSS);
      (shadow as ShadowRoot & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [sheet];
    } else {
      // Fallback for environments without constructable stylesheets (e.g. older
      // jsdom). Inline <style> achieves the same scoping inside the shadow root.
      const styleEl = doc.createElement('style');
      styleEl.textContent = OVERLAY_CSS;
      shadow.appendChild(styleEl);
    }

    // OpenDyslexic (#27) — when the chrome glue supplies the bundled
    // woff2 URL, inject the `@font-face` rule as an inline <style> sibling
    // inside the shadow root. The declaration is scoped to this shadow
    // (per CSS Scoping spec for shadow-root stylesheets) and does NOT
    // leak to host-page CSS, which satisfies the issue's "overlay only"
    // constraint. We use an inline <style> rather than an adoptedStyleSheet
    // entry because adoptedStyleSheets serialise `src: url(...)` through
    // the CSSOM round-trip, which jsdom drops — keeping the URL on a raw
    // <style> textContent preserves it for tests AND matches the
    // declaration shape browsers parse natively.
    //
    // Injection is unconditional on URL presence — the modal class governs
    // whether the family is actually applied — so toggling the setting
    // mid-session is a pure class flip, not a fresh font fetch.
    if (opts.openDyslexicFontUrl) {
      const fontStyle = doc.createElement('style');
      fontStyle.textContent = buildOpenDyslexicFontFace(opts.openDyslexicFontUrl);
      shadow.appendChild(fontStyle);
    }

    const backdrop = doc.createElement('div');
    backdrop.className = OVERLAY_CLASS.BACKDROP;
    const modal = doc.createElement('div');
    modal.className = OVERLAY_CLASS.MODAL;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', OVERLAY_ID.SCOPE_HEADER);

    const header = doc.createElement('h2');
    header.id = OVERLAY_ID.SCOPE_HEADER;
    header.className = OVERLAY_CLASS.SCOPE_HEADER;
    header.textContent = scopeView?.headerText ?? OVERLAY_TEXT.DEFAULT_HEADER;

    let subtitle: HTMLElement | null = null;
    if (scopeView?.fallback === 'empty-selection') {
      subtitle = doc.createElement('p');
      subtitle.className = OVERLAY_CLASS.SCOPE_SUBTITLE;
      subtitle.textContent = OVERLAY_TEXT.EMPTY_SELECTION_FALLBACK;
    }

    const topSentinel = doc.createElement('div');
    topSentinel.className = OVERLAY_CLASS.TRAP_SENTINEL;
    topSentinel.tabIndex = 0;

    // Modal header bar (mockup ".modal-header"). Houses the mini-logo + name
    // + hostname on the left and the actions group (bookmark, settings, close)
    // on the right. Hostname is derived from doc.location at mount; if
    // unavailable, the source span is omitted entirely so the header reads
    // "SpeedReader" alone.
    const modalHeader = doc.createElement('div');
    modalHeader.className = OVERLAY_CLASS.MODAL_HEADER;

    const modalTitle = doc.createElement('div');
    modalTitle.className = OVERLAY_CLASS.MODAL_TITLE;

    const miniLogo = doc.createElement('div');
    miniLogo.className = OVERLAY_CLASS.MINI_LOGO;
    miniLogo.textContent = OVERLAY_TEXT.MINI_LOGO_TEXT;
    miniLogo.setAttribute('aria-hidden', 'true');

    const titleText = doc.createElement('span');
    titleText.textContent = OVERLAY_TEXT.PRODUCT_NAME;

    modalTitle.append(miniLogo, titleText);

    // Hostname suffix — read from doc.location, sanitized for AT-safe
    // announcement and rendered with a length cap. Bidi-control marks
    // (RTL override, isolates) would flip the surrounding announcement
    // order and enable brand spoofing; C0/C1 controls disrupt screen
    // reader output. Strip both, then cap visible length so a very long
    // hostname doesn't dominate the chrome bar (a11y + security review
    // finding #7). Falsy / about:blank / data: URIs skip the separator
    // entirely so the header degrades cleanly.
    const hostname = doc.location?.hostname ?? '';
    const safeHost = sanitizeHostname(hostname);
    if (safeHost) {
      const sourceSpan = doc.createElement('span');
      sourceSpan.className = OVERLAY_CLASS.MODAL_SOURCE;
      sourceSpan.textContent = `${OVERLAY_TEXT.SOURCE_SEPARATOR}${safeHost}`;
      modalTitle.appendChild(sourceSpan);
    }

    const modalActions = doc.createElement('div');
    modalActions.className = OVERLAY_CLASS.MODAL_ACTIONS;

    // Bookmark + settings stubs — render now so the visual chrome matches
    // the Hi-Fi mockup. Click handlers wired in follow-up commits (bookmark
    // → reading-history, settings → tweaks panel). For Step 2 they are
    // no-op buttons with proper aria-labels so AT users still discover them.
    const bookmarkBtn = doc.createElement('button');
    bookmarkBtn.className = OVERLAY_CLASS.BOOKMARK_BTN;
    bookmarkBtn.type = 'button';
    bookmarkBtn.textContent = OVERLAY_TEXT.BOOKMARK_GLYPH;
    bookmarkBtn.setAttribute('aria-label', OVERLAY_TEXT.BOOKMARK_LABEL);

    const settingsBtn = doc.createElement('button');
    settingsBtn.className = OVERLAY_CLASS.SETTINGS_BTN;
    settingsBtn.type = 'button';
    settingsBtn.textContent = OVERLAY_TEXT.SETTINGS_GLYPH;
    settingsBtn.setAttribute('aria-label', OVERLAY_TEXT.SETTINGS_LABEL);

    const closeBtn = doc.createElement('button');
    closeBtn.className = OVERLAY_CLASS.CLOSE_BTN;
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', OVERLAY_TEXT.CLOSE_LABEL);
    closeBtn.textContent = OVERLAY_TEXT.CLOSE_GLYPH;

    modalActions.append(bookmarkBtn, settingsBtn, closeBtn);
    modalHeader.append(modalTitle, modalActions);

    // Tweaks popover (#step-3) — Disclosure pattern (ARIA-APG). Settings
    // button toggles `aria-expanded` + `aria-controls`; the panel itself
    // carries no role/aria-label. Tab traversal flows through the panel
    // as part of the modal's existing focus trap (outer-trap's hidden-
    // subtree filter skips the panel when collapsed). This replaces an
    // earlier `role="dialog"` + inner-trap implementation; the dialog
    // role implied modality the panel does not provide, and the inner
    // trap was escapable via Shift+Tab from the ⚙ button (a11y-extension-
    // designer findings #2/#6).
    const tweaksPanel = doc.createElement('div');
    tweaksPanel.className = OVERLAY_CLASS.TWEAKS_PANEL;
    tweaksPanel.id = 'sr-tweaks-panel';
    tweaksPanel.setAttribute('aria-labelledby', 'sr-tweaks-heading');
    tweaksPanel.hidden = true;

    settingsBtn.setAttribute('aria-expanded', 'false');
    settingsBtn.setAttribute('aria-controls', tweaksPanel.id);

    const tweaksHeading = doc.createElement('h3');
    tweaksHeading.className = OVERLAY_CLASS.TWEAKS_HEADING;
    tweaksHeading.id = 'sr-tweaks-heading';
    tweaksHeading.textContent = OVERLAY_TEXT.TWEAKS_HEADING;

    // Theme section — segmented row of buttons (one per ThemeId + a
    // System sentinel). The Active state is communicated via .active
    // class + aria-pressed="true"; clicking invokes onThemeChange and
    // flips the class synchronously so the user sees instant feedback
    // even when the host hasn't wired the callback.
    const themeSection = doc.createElement('div');
    themeSection.className = OVERLAY_CLASS.TWEAKS_SECTION;

    const themeLabel = doc.createElement('div');
    themeLabel.className = OVERLAY_CLASS.TWEAKS_SECTION_LABEL;
    themeLabel.textContent = OVERLAY_TEXT.TWEAKS_THEME_LABEL;
    themeLabel.id = 'sr-tweaks-theme-label';

    const themeSeg = doc.createElement('div');
    themeSeg.className = OVERLAY_CLASS.TWEAKS_SEG;
    themeSeg.setAttribute('role', 'group');
    themeSeg.setAttribute('aria-labelledby', themeLabel.id);

    const themeButtons: HTMLButtonElement[] = [];
    const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
    const themeChoices: ReadonlyArray<{ id: ThemeId | 'system'; label: string }> = [
      ...THEME_IDS.map((id) => ({ id, label: capitalize(id) })),
      { id: 'system' as const, label: OVERLAY_TEXT.TWEAKS_SYSTEM_LABEL },
    ];
    for (const choice of themeChoices) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = OVERLAY_CLASS.TWEAKS_SEG_BTN;
      btn.textContent = choice.label;
      btn.dataset.themeId = choice.id;
      btn.setAttribute('aria-label', OVERLAY_TEXT.themeButtonLabel(choice.label));
      btn.setAttribute('aria-pressed', 'false');
      themeSeg.appendChild(btn);
      themeButtons.push(btn);
    }
    themeSection.append(themeLabel, themeSeg);

    // Stub sections (Focus style / Accent / Modal dim) — render disabled
    // so the panel layout matches the mockup. Wired in later steps.
    const focusSection = doc.createElement('div');
    focusSection.className = OVERLAY_CLASS.TWEAKS_SECTION;
    const focusLabel = doc.createElement('div');
    focusLabel.className = OVERLAY_CLASS.TWEAKS_SECTION_LABEL;
    focusLabel.textContent = OVERLAY_TEXT.TWEAKS_FOCUS_STYLE_LABEL;
    focusLabel.id = 'sr-tweaks-focus-label';
    const focusSeg = doc.createElement('div');
    focusSeg.className = OVERLAY_CLASS.TWEAKS_SEG;
    focusSeg.setAttribute('role', 'group');
    focusSeg.setAttribute('aria-labelledby', focusLabel.id);
    for (const stubLabel of [
      OVERLAY_TEXT.TWEAKS_FOCUS_LINE_LABEL,
      OVERLAY_TEXT.TWEAKS_FOCUS_BOLD_LABEL,
    ]) {
      const stubBtn = doc.createElement('button');
      stubBtn.type = 'button';
      stubBtn.className = OVERLAY_CLASS.TWEAKS_SEG_BTN;
      stubBtn.textContent = stubLabel;
      stubBtn.disabled = true;
      focusSeg.appendChild(stubBtn);
    }
    focusSection.append(focusLabel, focusSeg);

    const accentSection = doc.createElement('div');
    accentSection.className = OVERLAY_CLASS.TWEAKS_SECTION;
    const accentLabel = doc.createElement('div');
    accentLabel.className = OVERLAY_CLASS.TWEAKS_SECTION_LABEL;
    accentLabel.textContent = OVERLAY_TEXT.TWEAKS_ACCENT_LABEL;
    const accentSwatch = doc.createElement('button');
    accentSwatch.type = 'button';
    accentSwatch.className = OVERLAY_CLASS.TWEAKS_ACCENT_SWATCH;
    accentSwatch.setAttribute('aria-label', OVERLAY_TEXT.TWEAKS_ACCENT_LABEL);
    accentSwatch.disabled = true;
    accentSection.append(accentLabel, accentSwatch);

    const dimSection = doc.createElement('div');
    dimSection.className = OVERLAY_CLASS.TWEAKS_SECTION;
    const dimLabel = doc.createElement('div');
    dimLabel.className = OVERLAY_CLASS.TWEAKS_SECTION_LABEL;
    dimLabel.textContent = OVERLAY_TEXT.TWEAKS_DIM_LABEL;
    dimLabel.id = 'sr-tweaks-dim-label';
    const dimRange = doc.createElement('input');
    dimRange.type = 'range';
    dimRange.min = '0';
    dimRange.max = '100';
    dimRange.value = '50';
    dimRange.className = OVERLAY_CLASS.TWEAKS_DIM_RANGE;
    dimRange.disabled = true;
    dimRange.setAttribute('aria-labelledby', dimLabel.id);
    dimSection.append(dimLabel, dimRange);

    tweaksPanel.append(tweaksHeading, themeSection, focusSection, accentSection, dimSection);

    const word = doc.createElement('div');
    word.className = OVERLAY_CLASS.WORD_REGION;

    // Surrounding-sentence preview (#20). Hidden by default; the pause
    // hook in mount() shows it with before/<strong>current</strong>/after.
    // Built with textContent + a single appended <strong> (no innerHTML,
    // no XSS surface).
    const preview = doc.createElement('div');
    preview.className = OVERLAY_CLASS.CONTEXT_PREVIEW;
    preview.setAttribute('role', 'region');
    preview.setAttribute('aria-label', OVERLAY_TEXT.CONTEXT_LABEL);
    preview.hidden = true;

    const ariaLive = doc.createElement('div');
    ariaLive.className = OVERLAY_CLASS.ARIA_LIVE;
    ariaLive.setAttribute('aria-live', 'polite');
    ariaLive.setAttribute('aria-atomic', 'true');

    const footer = doc.createElement('div');
    footer.className = OVERLAY_CLASS.FOOTER;

    let swapBtn: HTMLButtonElement | null = null;
    if (scopeView?.showSwapBtn) {
      swapBtn = doc.createElement('button');
      swapBtn.className = OVERLAY_CLASS.SCOPE_SWAP_BTN;
      swapBtn.type = 'button';
      swapBtn.textContent = OVERLAY_TEXT.SWAP_GLYPH;
      swapBtn.setAttribute('aria-label', OVERLAY_TEXT.SWAP_LABEL);
      footer.appendChild(swapBtn);
    }

    // Font-size stepper (#29). Placed before play/pause so the visual
    // order in LTR reading is [A−] [A+] [Play/Pause]; tab order matches
    // DOM order. Both ≥44×44 px via the .font-step-btn CSS rules in
    // styles.ts (mirrors the close-btn dimensions to satisfy WCAG 2.5.5).
    const fontDecBtn = doc.createElement('button');
    fontDecBtn.className = OVERLAY_CLASS.FONT_DEC_BTN;
    fontDecBtn.type = 'button';
    fontDecBtn.textContent = OVERLAY_TEXT.FONT_DEC_GLYPH;
    fontDecBtn.setAttribute('aria-label', OVERLAY_TEXT.FONT_DEC_LABEL);
    footer.appendChild(fontDecBtn);

    const fontIncBtn = doc.createElement('button');
    fontIncBtn.className = OVERLAY_CLASS.FONT_INC_BTN;
    fontIncBtn.type = 'button';
    fontIncBtn.textContent = OVERLAY_TEXT.FONT_INC_GLYPH;
    fontIncBtn.setAttribute('aria-label', OVERLAY_TEXT.FONT_INC_LABEL);
    footer.appendChild(fontIncBtn);

    // Prev-sentence button (#23). Placed before play/pause so the visual
    // order in LTR reading is [⏮] [Play/Pause] [⏭]. Click handler is
    // wired in mount() so it can capture the engine reference.
    const prevSentenceBtn = doc.createElement('button');
    prevSentenceBtn.className = OVERLAY_CLASS.PREV_SENTENCE_BTN;
    prevSentenceBtn.type = 'button';
    prevSentenceBtn.textContent = OVERLAY_TEXT.PREV_SENTENCE_GLYPH;
    prevSentenceBtn.setAttribute('aria-label', OVERLAY_TEXT.PREV_SENTENCE_LABEL);
    footer.appendChild(prevSentenceBtn);

    const playPauseBtn = doc.createElement('button');
    playPauseBtn.className = OVERLAY_CLASS.PLAY_PAUSE_BTN;
    playPauseBtn.type = 'button';
    footer.appendChild(playPauseBtn);

    const nextSentenceBtn = doc.createElement('button');
    nextSentenceBtn.className = OVERLAY_CLASS.NEXT_SENTENCE_BTN;
    nextSentenceBtn.type = 'button';
    nextSentenceBtn.textContent = OVERLAY_TEXT.NEXT_SENTENCE_GLYPH;
    nextSentenceBtn.setAttribute('aria-label', OVERLAY_TEXT.NEXT_SENTENCE_LABEL);
    footer.appendChild(nextSentenceBtn);

    // WPM slider (#24) + readout. Bounds are [WPM_MIN, WPM_MAX] = [100, 600]
    // (#16). Slider value is set in mount() from currentWpm so the initial
    // position reflects initialSettings.wpm even when callers pass non-default
    // values.
    const wpmSlider = doc.createElement('input');
    wpmSlider.className = OVERLAY_CLASS.WPM_SLIDER;
    wpmSlider.type = 'range';
    wpmSlider.min = String(WPM_MIN);
    wpmSlider.max = String(WPM_MAX);
    wpmSlider.step = String(WPM_STEP);
    wpmSlider.setAttribute('aria-label', OVERLAY_TEXT.WPM_SLIDER_LABEL);
    footer.appendChild(wpmSlider);

    const wpmReadout = doc.createElement('span');
    wpmReadout.className = OVERLAY_CLASS.WPM_READOUT;
    // The slider already exposes its value via aria-label + role; the readout
    // is a visual companion. aria-hidden avoids duplicate announcements.
    wpmReadout.setAttribute('aria-hidden', 'true');
    footer.appendChild(wpmReadout);

    // Progress scrubber (#47). Mounted ABOVE the footer so visual order
    // reads: word → preview → scrubber → controls (matches Safari spec).
    // Q1 decision: above the existing control bar — the footer IS the
    // control bar in current Chrome architecture, so this is the natural
    // slot. Q2: visible from mount with pre-start labels (Safari spec
    // implies always-visible). Q3: new .scrubber-slider class sharing
    // base track/thumb rules with .wpm-slider via a selector list in
    // styles.ts. Q4: aria-valuetext updates per-emission (matches
    // user-perceived granularity).
    const scrubberArea = doc.createElement('div');
    scrubberArea.className = OVERLAY_CLASS.SCRUBBER_AREA;

    const scrubberLabels = doc.createElement('div');
    scrubberLabels.className = OVERLAY_CLASS.SCRUBBER_LABELS;

    const scrubberElapsed = doc.createElement('span');
    scrubberElapsed.className = OVERLAY_CLASS.SCRUBBER_ELAPSED;
    // aria-hidden: the scrubber's aria-valuetext carries the same
    // information for AT; the visible labels avoid double-announce.
    scrubberElapsed.setAttribute('aria-hidden', 'true');

    const scrubberRemaining = doc.createElement('span');
    scrubberRemaining.className = OVERLAY_CLASS.SCRUBBER_REMAINING;
    scrubberRemaining.setAttribute('aria-hidden', 'true');

    scrubberLabels.append(scrubberElapsed, scrubberRemaining);

    const scrubber = doc.createElement('input');
    scrubber.className = OVERLAY_CLASS.SCRUBBER_SLIDER;
    scrubber.type = 'range';
    scrubber.min = '0';
    // Max is words.length - 1 so the rightmost slider position addresses
    // the LAST raw token (per Safari spec). Empty-stream guard: a 0-word
    // stream yields max="-1" which the browser clamps to "0"; we clamp
    // explicitly so the attribute is honest.
    const scrubberMax = Math.max(
      0,
      (scopeView ? scopeView.activeWords.length : opts.words.length) - 1,
    );
    scrubber.max = String(scrubberMax);
    scrubber.step = '1';
    scrubber.value = '0';
    scrubber.setAttribute('aria-label', OVERLAY_TEXT.SCRUBBER_LABEL);

    scrubberArea.append(scrubberLabels, scrubber);

    const bottomSentinel = doc.createElement('div');
    bottomSentinel.className = OVERLAY_CLASS.TRAP_SENTINEL;
    bottomSentinel.tabIndex = 0;

    // Mockup append order: top-sentinel → modal-header (logo + actions
    // including close-btn) → scope-header (article-meta) → optional
    // subtitle → word → preview → aria-live → scrubber → footer →
    // bottom-sentinel. close-btn is now nested inside modalHeader.actions
    // so it is NOT a direct modal child.
    const children: Node[] = [topSentinel, modalHeader, header];
    if (subtitle) children.push(subtitle);
    children.push(word, preview, ariaLive, scrubberArea, footer, tweaksPanel, bottomSentinel);
    modal.append(...children);
    backdrop.appendChild(modal);
    shadow.appendChild(backdrop);

    return {
      modal,
      header,
      word,
      closeBtn,
      playPauseBtn,
      swapBtn,
      fontDecBtn,
      fontIncBtn,
      prevSentenceBtn,
      nextSentenceBtn,
      wpmSlider,
      wpmReadout,
      ariaLive,
      preview,
      scrubber,
      scrubberElapsed,
      scrubberRemaining,
      settingsBtn,
      tweaksPanel,
      themeButtons,
    };
  }

  function mount(): void {
    if (status === 'mounted') return;
    priorOverflow = opts.doc.documentElement.style.overflow;
    opts.doc.documentElement.style.overflow = 'hidden';
    host = opts.doc.createElement('div');
    host.setAttribute(HOST_ATTR, '');
    // #52 PART A — alignment attribute mirrors the user's `alignment`
    // setting on the host element. Styles in styles.ts consume via
    // `:host([data-alignment="orp"])` / `:host([data-alignment="center"])`
    // selectors. `subscribeSettings` updates the attribute on live push
    // (see below). Default `'orp'` matches the schema default and the
    // Safari upstream behaviour.
    host.setAttribute(OVERLAY_ATTR.ALIGNMENT, opts.initialSettings.alignment ?? 'orp');
    // Critical positioning styles inline with !important so external host-page
    // CSS targeting `div` cannot override them. `:host` selector specificity
    // is (0,0,0) which any outer-document `div` rule beats; inline !important
    // beats everything short of another inline !important. See real-article
    // verification on MDN (#19).
    host.style.cssText =
      'all: initial !important;' +
      'position: fixed !important;' +
      'top: 0 !important; right: 0 !important; bottom: 0 !important; left: 0 !important;' +
      'width: 100vw !important; height: 100vh !important;' +
      'z-index: 2147483647 !important;' +
      'display: block !important;' +
      'pointer-events: auto !important;';
    opts.doc.body.appendChild(host);
    const view = opts.doc.defaultView;
    if (!view) {
      throw new Error('createOverlay.mount: doc.defaultView is null (document is detached)');
    }
    let scopeView = buildScopeView(opts);
    currentScope = scopeView?.scope ?? null;
    const shadow = host.attachShadow({ mode: 'open' });
    const {
      modal,
      header,
      word,
      closeBtn,
      playPauseBtn,
      swapBtn,
      fontDecBtn,
      fontIncBtn,
      prevSentenceBtn,
      nextSentenceBtn,
      wpmSlider,
      wpmReadout,
      ariaLive,
      preview,
      scrubber,
      scrubberElapsed,
      scrubberRemaining,
      settingsBtn,
      tweaksPanel,
      themeButtons,
    } = buildShadowTree(shadow, scopeView);
    const resolvedTheme = resolveTheme(opts.initialSettings.theme, view);
    applyTheme(resolvedTheme, modal);

    // #26 — live re-apply when the user's effective theme is `'system'`
    // and the OS prefers-color-scheme flips. Track the current setting
    // in a closure so the matchMedia change handler can short-circuit
    // when the user has picked an explicit override (a user who chose
    // Light does NOT want the OS to override them).
    //
    // `currentTheme` reflects the SETTING value (`'system' | ThemeId`),
    // not the resolved value, so the gate stays accurate across
    // settings.theme → 'system' ↔ explicit transitions.
    let currentTheme: ThemeId | 'system' = opts.initialSettings.theme;
    const installSystemThemeListener = (): void => {
      if (uninstallSystemThemeListener) return;
      let mql: MediaQueryList;
      try {
        mql = view.matchMedia('(prefers-color-scheme: dark)');
      } catch {
        // No matchMedia (jsdom without a stub, very old WebView). The
        // mount-time resolveTheme already chose a sensible fallback;
        // there is nothing to subscribe to.
        return;
      }
      const onChange = (): void => {
        // Belt-and-braces: the settings push path also detaches the
        // listener when transitioning away from 'system', but if a
        // change arrives in the same microtask we don't want to
        // re-apply against an explicit override.
        if (currentTheme !== 'system') return;
        applyTheme(resolveTheme('system', view), modal);
      };
      mql.addEventListener('change', onChange);
      uninstallSystemThemeListener = () => mql.removeEventListener('change', onChange);
    };
    const removeSystemThemeListener = (): void => {
      uninstallSystemThemeListener?.();
      uninstallSystemThemeListener = null;
    };
    if (currentTheme === 'system') installSystemThemeListener();

    // #step-3 — flip the .active class + aria-pressed on the Tweaks
    // theme buttons. Declared up here so the subscribeSettings echo path
    // below can call it without a temporal-dead-zone hazard if a host
    // implementation fires the listener synchronously.
    const syncThemeButtons = (active: ThemeId | 'system'): void => {
      for (const btn of themeButtons) {
        const isActive = btn.dataset.themeId === active;
        btn.classList.toggle(OVERLAY_CLASS.TWEAKS_SEG_BTN_ACTIVE, isActive);
        btn.setAttribute('aria-pressed', String(isActive));
      }
    };

    // Local WPM is the source of truth for engine cadence while mounted.
    // Persisted settings updates push in via `subscribeSettings`; the
    // in-overlay ↑/↓ shortcut and slider input update `currentWpm` + the
    // engine and (when `onWpmChange` is wired) persist via the callback.
    let currentWpm = opts.initialSettings.wpm;
    // Local chunkSize cache so the subscribeSettings handler can
    // short-circuit no-op emissions and only call `engine.setChunkSize`
    // when the value actually changed (#51 architect MED #2).
    let currentChunkSize: 1 | 2 | 3 = opts.initialSettings.chunkSize ?? 1;
    // #52 PART A — local cache so the subscribeSettings handler can
    // short-circuit no-op echoes and only re-write the host attribute
    // when alignment actually changed. Default `'orp'` matches schema.
    let currentAlignment: 'orp' | 'center' = opts.initialSettings.alignment ?? 'orp';

    // Single point of truth for keeping the slider + readout in sync with
    // `currentWpm`. Called from mount-time init, the ArrowUp/Down keyboard
    // handler, slider input, and subscribeSettings emissions.
    const syncWpmUi = (n: number): void => {
      wpmSlider.value = String(n);
      wpmReadout.textContent = OVERLAY_TEXT.wpmReadout(n);
    };
    syncWpmUi(currentWpm);

    // Font-size stepper (#29). Local cache so the subscribeSettings
    // handler can short-circuit no-op emissions and so the A−/A+
    // buttons read+clamp from a single source. The applyFontSize helper
    // also updates the boundary-disabled state on the buttons.
    let currentFontSize = opts.initialSettings.fontSize;
    const clampFontSize = (n: number): number => {
      // Defend against NaN/Infinity/negatives from caller-supplied
      // initialSettings (review M4): Math.max/min propagate NaN, so a
      // bare clamp here would still emit garbage CSS. Fall back to MIN.
      if (!Number.isFinite(n)) return FONT_SIZE_MIN;
      return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, n));
    };
    const applyFontSize = (n: number): void => {
      currentFontSize = n;
      // Write the custom property on the modal ancestor rather than the
      // hot `word` element (review M3). `.word-region` reads
      // `var(--rsvp-font-size)` via CSS custom-property inheritance, so
      // moving the write up one level keeps the cascade working while
      // avoiding inline-style invalidation on every RSVP tick (~10 Hz
      // at 600 wpm).
      modal.style.setProperty('--rsvp-font-size', `${n}px`);
      fontDecBtn.disabled = n <= FONT_SIZE_MIN;
      fontIncBtn.disabled = n >= FONT_SIZE_MAX;
    };
    // Clamp at mount-time too (review M4) — subscribeSettings clamps but
    // initialSettings flows in unclamped from caller, so a bad value
    // (NaN, Infinity, negative) would otherwise write garbage CSS once.
    applyFontSize(clampFontSize(currentFontSize));

    // Font picker (#28). The active picker ID drives a `.modal.<font-id>`
    // class so the matching family-stack rule in styles.ts wins. `system`
    // intentionally applies no class — the default family stack on `.modal`
    // is system-ui, and adding a class would be a no-op rule that hides
    // the "no font selected" state from CSS inspection. resolveFontId
    // handles the #27 legacy: `openDyslexic: true` without a curated
    // `font` value promotes to `'opendyslexic'`.
    let currentFont: FontId = resolveFontId(opts.initialSettings);
    const applyFont = (next: FontId): void => {
      currentFont = next;
      for (const id of FONT_IDS) {
        modal.classList.toggle(id, id !== 'system' && id === next);
      }
    };
    applyFont(currentFont);

    unsubscribeSettings = opts.subscribeSettings((s) => {
      // Theme-side work runs only on a real change. The existing
      // wpm/fontSize/font/chunkSize/alignment branches below all guard
      // on `next !== current` to avoid CSS invalidation under hot-cadence
      // settings echoes (WPM slider drag); theme matches that pattern
      // (perf-adversary finding #2). applyTheme is idempotent so this is
      // a perf guard, not a correctness fix.
      if (s.theme !== currentTheme) {
        const resolved = resolveTheme(s.theme, view);
        applyTheme(resolved, modal);
        currentTheme = s.theme;
        if (s.theme === 'system') installSystemThemeListener();
        else removeSystemThemeListener();
        syncThemeButtons(s.theme);
      }
      if (s.wpm !== currentWpm) {
        currentWpm = s.wpm;
        engine?.setWpm(s.wpm);
        syncWpmUi(s.wpm);
        // #47 — scrubber time labels are wpm-dependent; refresh on push.
        // Position (value/max) is unchanged here, only the time math.
        updateScrubber();
      }
      if (s.fontSize !== currentFontSize) {
        applyFontSize(clampFontSize(s.fontSize));
      }
      const nextFont = resolveFontId(s);
      if (nextFont !== currentFont) {
        applyFont(nextFont);
      }
      // #51 architect MED #2 — live chunkSize update. Forward to the
      // engine so a user switching chunkSize mid-session sees the new
      // grouping immediately rather than only on next mount. Guarded
      // on a real change so a no-op echo doesn't churn the engine.
      const nextChunkSize: 1 | 2 | 3 = s.chunkSize ?? 1;
      if (nextChunkSize !== currentChunkSize) {
        currentChunkSize = nextChunkSize;
        engine?.setChunkSize(nextChunkSize);
      }
      // #52 PART A — live alignment update. Flip the host attribute so
      // the CSS `:host([data-alignment="…"])` selectors swap layout
      // mid-session without a remount. Guarded on a real change so a
      // no-op echo doesn't churn the attribute.
      const nextAlignment: 'orp' | 'center' = s.alignment ?? 'orp';
      if (nextAlignment !== currentAlignment) {
        currentAlignment = nextAlignment;
        host?.setAttribute(OVERLAY_ATTR.ALIGNMENT, nextAlignment);
      }
    });

    const engineWords = scopeView ? scopeView.activeWords : opts.words;
    // #51 — forward chunkSize when set. Engine treats undefined OR 1 as
    // word mode (back-compat); only 2 or 3 enable chunk emission.
    engine = opts.engineFactory({
      words: engineWords,
      wpm: currentWpm,
      chunkSize: opts.initialSettings.chunkSize,
    });

    // Scrub-session state (FIX-6 a11y MED #1 + FIX-7 a11y MED #2).
    //
    // FIX-6 — live-region storm suppression. During rapid scrub (mouse
    // drag, touch swipe, held Arrow key), the engine's paused-state
    // seekTo emits a replacement word/chunk event per position; each
    // emission would otherwise overwrite the polite `.aria-live` region,
    // queueing trailing speech the AT user hears AFTER releasing. The
    // flag below gates per-emission ariaLive writes. The slider's own
    // aria-valuetext still updates per emission (the slider IS the ARIA
    // surface during scrub), so position feedback is preserved.
    //
    // FIX-7 — one-shot polite announcement per scrub session ("Paused.
    // Scrubbing reading position.") so AT users get explicit state-
    // change confirmation. The `scrubAnnouncementFired` latch prevents
    // re-firing inside one session; the debounce timer resets the latch
    // alongside the flag.
    //
    // Debounce: 250ms after the most recent scrub event clears
    // `scrubInProgress` AND resets `scrubAnnouncementFired` so the next
    // discrete drag is a new session. Centralized cleanup runs from
    // unmount() so a pending timer cannot reach into a detached shadow.
    let scrubInProgress = false;
    let scrubAnnouncementFired = false;
    const SCRUB_DEBOUNCE_MS = 250;

    // Progress scrubber updater (#47). Reads engine.progress() + time
    // getters and writes value + labels + aria-valuetext. Centralized so
    // every emission branch (word / chunk / done) AND the
    // subscribeSettings wpm-push path call the same code.
    //
    // Scrubber `value` is the LAST emitted token's raw position (0-based).
    // Post-emit, engine.progress().index is the count of tokens consumed
    // (raw axis, mode-invariant per #51), so value = max(0, index - 1).
    // Pre-start (index === 0) ⇒ value = 0.
    //
    // FIX-1 (ring-review convergent HIGH — test-gap + extension-architect):
    // Resync `scrubber.max` here every emission. Originally set ONCE at
    // mount; after scope-swap (setWords full → selection or vice versa)
    // the engine's progress().total changes but the attribute stayed
    // stale, so drags clamped while aria-valuetext kept advancing past
    // the visible thumb. Reading rsvp-engine.ts progress() (lines 853-877)
    // confirms total === words.length in BOTH word and chunk modes, so
    // setChunkSize alone does NOT need a resync — but putting the guard
    // here makes the scrubber defensive against any future axis change
    // for free (one conditional write per emission). Empty-stream guard
    // (FIX-4 ring-review test-gap MED #3) — max never goes negative.
    const updateScrubber = (): void => {
      if (!engine) return;
      const p = engine.progress();
      const nextMax = String(Math.max(0, p.total - 1));
      if (scrubber.max !== nextMax) scrubber.max = nextMax;
      scrubber.value = String(Math.max(0, p.index - 1));
      const elapsedSec = Math.round(engine.timeElapsed() / 1000);
      const remainingSec = Math.round(engine.timeRemaining() / 1000);
      scrubberElapsed.textContent = OVERLAY_TEXT.formatTime(elapsedSec);
      // Leading `-` mirrors the Apple media-player convention captured in
      // the Safari spec ("-2:08" remaining).
      scrubberRemaining.textContent = `-${OVERLAY_TEXT.formatTime(remainingSec)}`;
      scrubber.setAttribute(
        'aria-valuetext',
        OVERLAY_TEXT.scrubberValueText(elapsedSec, remainingSec),
      );
    };

    // #52 PART D — scrubber visibility state machine.
    //
    // Hidden when ALL of:
    //   - engine.state === 'playing'
    //   - no hover on scrubber-area
    //   - no focus-within scrubber-area
    //   - not mid-scrub (scrubInProgress is false)
    // Visible otherwise.
    //
    // Uses opacity + visibility + pointer-events (NOT display:none) so
    // the layout slot stays reserved — display:none would collapse the
    // margin-block-start and reflow the word region's vertical center
    // every toggle, fighting RSVP cadence (FIX-5 ring-review guidance
    // in styles.ts at the .scrubber-area block).
    //
    // The CSS transition (`transition: opacity 200ms ease-out, visibility
    // 200ms`) is declared on .scrubber-area in styles.ts; prefers-reduced-
    // motion overrides it to `transition: none`.
    let scrubberHovered = false;
    let scrubberFocused = false;
    const scrubberArea = scrubber.parentElement;
    // visibility:hidden removes the element from the AT rotor during playback —
    // intentional reduction of noise; user can still discover via voice control
    // because the label is preserved.
    const recomputeScrubberVisibility = (): void => {
      if (!scrubberArea) return;
      const playing = engine?.state === 'playing';
      const shouldHide = playing && !scrubberHovered && !scrubberFocused && !scrubInProgress;
      const wasHidden = scrubberArea.dataset.hidden === 'true';
      if (shouldHide) {
        scrubberArea.style.opacity = '0';
        scrubberArea.style.visibility = 'hidden';
        scrubberArea.style.pointerEvents = 'none';
        scrubberArea.dataset.hidden = 'true';
      } else {
        // A11y MED #3 — focus-reveal race. When the bar transitions
        // hidden→visible because focus arrived (tab into the slider while
        // the engine is playing), the 200ms CSS opacity transition would
        // leave the focus indicator at < 100% opacity during the fade.
        // WCAG SC 2.4.7 requires the focus indicator be visible at the
        // moment focus is received. Skip the fade in this specific path
        // by inlining `transition: none`, forcing a reflow, writing the
        // visible state, then restoring the transition on the next frame
        // so subsequent hover-driven reveals still animate.
        if (wasHidden && scrubberFocused) {
          scrubberArea.style.transition = 'none';
          // Force reflow so the transition-none write takes effect before
          // the opacity write below — without this, the browser may batch
          // both writes and animate anyway.
          void scrubberArea.offsetHeight;
          scrubberArea.style.opacity = '1';
          scrubberArea.style.visibility = 'visible';
          scrubberArea.style.pointerEvents = '';
          scrubberArea.dataset.hidden = 'false';
          // Restore the CSS-declared transition on the next frame so
          // future fade-outs / hover reveals retain the 200ms animation.
          // requestAnimationFrame is preferred but fall back to setTimeout
          // for environments without it (jsdom under fake timers).
          const restoreTransition = (): void => {
            if (scrubberArea) scrubberArea.style.transition = '';
          };
          const view2 = opts.doc.defaultView;
          if (view2 && typeof view2.requestAnimationFrame === 'function') {
            view2.requestAnimationFrame(restoreTransition);
          } else {
            setTimeout(restoreTransition, 0);
          }
          return;
        }
        scrubberArea.style.opacity = '1';
        scrubberArea.style.visibility = 'visible';
        scrubberArea.style.pointerEvents = '';
        scrubberArea.dataset.hidden = 'false';
      }
    };

    const reflectEngineState = (): void => {
      const s = engine?.state ?? 'idle';
      if (s === 'playing') {
        playPauseBtn.setAttribute('aria-pressed', 'true');
        playPauseBtn.setAttribute('aria-label', OVERLAY_TEXT.PAUSE_LABEL);
        playPauseBtn.textContent = OVERLAY_TEXT.PAUSE_GLYPH;
        playPauseBtn.disabled = false;
      } else if (s === 'paused') {
        playPauseBtn.setAttribute('aria-pressed', 'false');
        playPauseBtn.setAttribute('aria-label', OVERLAY_TEXT.PLAY_LABEL);
        playPauseBtn.textContent = OVERLAY_TEXT.PLAY_GLYPH;
        playPauseBtn.disabled = false;
      } else {
        // 'idle' or 'done'
        playPauseBtn.setAttribute('aria-pressed', 'false');
        playPauseBtn.setAttribute('aria-label', OVERLAY_TEXT.PLAY_LABEL);
        playPauseBtn.textContent = OVERLAY_TEXT.PLAY_GLYPH;
        playPauseBtn.disabled = s === 'done';
      }
      // Engine-state transitions can flip the auto-hide outcome (e.g.
      // playing → paused → visible). Recompute here so any caller of
      // reflectEngineState (togglePlayPause, swapToFull, start, done
      // branch) keeps visibility in sync without each caller having to
      // remember to call recompute themselves.
      recomputeScrubberVisibility();
    };

    const clearPreview = (): void => {
      // Idempotency guard — clearPreview can be called on every state
      // transition; skip the layout-touching property writes when the
      // node is already in the cleared state. Matters when callers fan
      // out (toggle, swap, paused-state seek-driven word emits) — the
      // hot path stays free of redundant DOM writes.
      if (preview.hidden && preview.firstChild === null) return;
      preview.hidden = true;
      // textContent='' removes children too, dropping the <strong>.
      preview.textContent = '';
    };

    // #20 — render the surrounding-sentence preview. Caller MUST gate
    // on `engine.state === 'paused'`. The internal early-return below
    // is belt-and-braces only; the per-word hot path should never reach
    // this function (perf-adversary F1 + scope-adversary F1).
    const renderPreview = (): void => {
      if (!engine) return;
      if (engine.state !== 'paused') {
        clearPreview();
        return;
      }
      const progress = engine.progress();
      if (progress.total === 0) {
        clearPreview();
        return;
      }
      const currentIndex = progress.index - 1;
      // Active stream: scopeView's activeWords reflects swap-to-full;
      // fall back to the legacy single-stream path when no scope.
      const activeWords = scopeView ? scopeView.activeWords : opts.words;
      const ctx = buildSentenceContext(activeWords, currentIndex);
      if (!ctx) {
        clearPreview();
        return;
      }
      // Build via textContent + a single appended <strong>. No innerHTML.
      clearPreview();
      const beforeText = ctx.before.length > 0 ? ctx.before.join(' ') + ' ' : '';
      const afterText = ctx.after.length > 0 ? ' ' + ctx.after.join(' ') : '';
      preview.appendChild(opts.doc.createTextNode(beforeText));
      const strong = opts.doc.createElement('strong');
      strong.className = OVERLAY_CLASS.CONTEXT_CURRENT;
      strong.textContent = ctx.current;
      preview.appendChild(strong);
      preview.appendChild(opts.doc.createTextNode(afterText));
      preview.hidden = false;
    };

    engine.subscribe((ev) => {
      if (ev.type === 'word') {
        renderWord(word, ev.word);
        // FIX-6 — suppress per-emission aria-live writes while a scrub
        // session is active. Rapid drag would otherwise queue trailing
        // speech that arrives after release. The slider's aria-valuetext
        // still updates via updateScrubber() so position feedback for AT
        // is preserved.
        if (!scrubInProgress) ariaLive.textContent = ev.word;
        // #48 — emit the post-emit 1-based progress count so the host can
        // persist it. Reading `engine.progress().index` AFTER the emit
        // matches the persistence semantics: closing after the last word
        // stores `wordIndex === totalWords`, which the resume check then
        // treats as "finished, start fresh."
        if (opts.onWordAdvance && engine) {
          const p = engine.progress();
          opts.onWordAdvance(p.index, p.total);
        }
        // Only re-render the preview if the just-emitted word landed
        // while the engine was already paused (paused-state seekTo emits
        // a replacement `word` event — see RsvpEngine.seekTo docs). On
        // the per-word PLAYING tick path we MUST skip the call entirely;
        // clearPreview's idempotency guard makes the no-op cheap, but
        // not calling it at all is cheaper still (perf-adversary F1).
        if (engine?.state === 'paused') renderPreview();
        // Scrubber update LAST so the visual word lands first, then the
        // label follows (matches Safari spec render order).
        updateScrubber();
      } else if (ev.type === 'chunk') {
        // #51 + #52 PART C — multi-word display with per-word ORP. The
        // pre-#52 path called `renderWord(word, ev.text)` which ran
        // `splitWordAtFocus` over the WHOLE joined chunk string, producing
        // a nonsensical focus position somewhere inside the join. The
        // fix delegates to `renderChunk`, which builds one `.word-run`
        // per chunk word (each with its own before/focus/after spans
        // sourced from `splitWordAtFocus` on the individual word).
        // aria-live still announces the WHOLE chunk text (single readable
        // unit). FIX-6 suppression applies here too — chunk-mode scrub
        // would otherwise spam aria-live with replacement chunk text.
        renderChunk(word, ev.text, ev.words);
        if (!scrubInProgress) ariaLive.textContent = ev.text;
        if (opts.onWordAdvance && engine) {
          const p = engine.progress();
          opts.onWordAdvance(p.index, p.total);
        }
        if (engine?.state === 'paused') renderPreview();
        updateScrubber();
      } else if (ev.type === 'done') {
        reflectEngineState();
        // Done is reached by playback; the preview was never visible if
        // we were playing. If a future caller can land in `done` from a
        // paused state, the idempotent clearPreview below is the safety
        // net.
        clearPreview();
        updateScrubber();
      }
    });
    // #25 — resume the engine at the saved session position. Idle seekTo
    // is silent and sets nextIndex; the subsequent `start()` then emits
    // exactly one word event for words[resume]. Running seekTo AFTER start
    // (the prior shape) emitted words[0] first, then a replacement for
    // words[resume] — the subscriber's aria-live wrote twice, which can
    // cause a screen-reader double-announce on resume. seekTo's own
    // finite-integer + range guards belt-and-brace the check below; the
    // conditional is here so we skip the no-op when there's nothing to
    // restore.
    const resume = opts.initialIndex;
    const resumedAt: number | null =
      typeof resume === 'number' &&
      Number.isInteger(resume) &&
      resume > 0 &&
      resume < engineWords.length
        ? resume
        : null;
    if (resumedAt !== null) {
      engine.seekTo(resumedAt);
    }
    engine.start();
    // #52 PART D — initial visibility computation now that engine state
    // is settled. engine.start() emits the first word/chunk synchronously
    // and may transition to 'done' on an empty stream; either way, the
    // recompute below establishes the correct initial visibility before
    // the user sees the mounted overlay.
    recomputeScrubberVisibility();
    if (scopeView?.fallback === 'empty-selection') {
      // Overrides the word[0] textContent that fired via the subscribe
      // handler during engine.start(). The polite live-region status fires
      // once on mount; subsequent ticks resume the per-word announcement
      // pattern.
      ariaLive.textContent = OVERLAY_TEXT.EMPTY_SELECTION_FALLBACK;
    }
    reflectEngineState();
    renderPreview();

    // #48 — resume toast. Only renders when the mount actually resumed
    // AND the caller opted in via `resumeToast`. The toast lives inside
    // the modal as a `role="status"` chip so it announces politely
    // alongside the visible chip. Auto-dismisses after 5 s; Start Over
    // rewinds the engine to word 0 and invokes `onStartOver` so the
    // host can clear the persisted entry.
    if (resumedAt !== null && opts.resumeToast) {
      const toast = opts.doc.createElement('div');
      toast.className = OVERLAY_CLASS.RESUME_TOAST;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      // Custom data attribute pins the element for tests + the Start Over
      // descendant selector without depending on the visual class name.
      toast.setAttribute('data-sr-resume-toast', '');

      const label = opts.doc.createElement('span');
      label.textContent = OVERLAY_TEXT.resumeToast(resumedAt, opts.resumeToast.totalWords);
      toast.appendChild(label);

      const startOver = opts.doc.createElement('button');
      startOver.type = 'button';
      startOver.className = OVERLAY_CLASS.RESUME_TOAST_BTN;
      startOver.setAttribute('data-sr-start-over', '');
      startOver.textContent = OVERLAY_TEXT.RESUME_TOAST_START_OVER;
      toast.appendChild(startOver);

      const onStartOverCb = opts.resumeToast.onStartOver;
      const dismissToast = (): void => {
        if (resumeToastTimer !== null) {
          clearTimeout(resumeToastTimer);
          resumeToastTimer = null;
        }
        toast.remove();
      };
      startOver.addEventListener('click', () => {
        // Rewind the engine to word 0. seekTo(0) handles both PLAYING
        // (clearPending + tick from 0) and PAUSED (replacement word
        // event for words[0]) state transitions in-place, so we don't
        // need a separate pause/start dance here.
        engine?.seekTo(0);
        dismissToast();
        reflectEngineState();
        onStartOverCb?.();
      });

      // Insert above the word region so the toast sits visually at the
      // top of the reading surface without disturbing the dialog header.
      word.parentNode?.insertBefore(toast, word);

      resumeToastTimer = setTimeout(() => {
        resumeToastTimer = null;
        toast.remove();
      }, OVERLAY_TEXT.RESUME_TOAST_DISMISS_MS);
    }

    const togglePlayPause = (): void => {
      if (!engine) return;
      if (engine.state === 'playing') {
        engine.pause();
      } else if (engine.state === 'paused') {
        engine.resume();
      } else {
        return;
      }
      reflectEngineState();
      renderPreview();
    };

    playPauseBtn.addEventListener('click', togglePlayPause);

    // #36 — tap-to-pause on touch-primary viewports. The combined query
    // (pointer: coarse) and (hover: none) is the WCAG-aligned touch-primary
    // signal: it excludes hybrid laptops whose touchscreen reports `coarse`
    // alongside a precise mouse (those still satisfy `hover: hover`). On
    // mouse viewports the listener is wired but the guard short-circuits,
    // so accidental clicks on the word region during text-selection
    // gestures do not pause the reader.
    const isTouchPrimary = (): boolean =>
      view.matchMedia('(pointer: coarse) and (hover: none)').matches;
    word.addEventListener('click', () => {
      if (!isTouchPrimary()) return;
      togglePlayPause();
    });

    const swapToFull = (): void => {
      if (!engine) return;
      if (!scopeView || scopeView.scope !== 'selection') return;

      const fullWords = opts.fullWords ?? [];
      const title = opts.articleTitle?.trim();
      const newHeader =
        title && title.length > 0 ? title : OVERLAY_TEXT.fullHeaderFallback(fullWords.length);

      // Render the first word of the full stream by start+pause-ing the
      // engine on the new stream. seekTo(0) on 'idle' is a silent
      // reposition (per engine docs) — no word event — so the word region
      // would stay empty without the start+pause pairing.
      if (engine.state === 'playing') engine.pause();
      engine.setWords(fullWords);
      if (fullWords.length > 0) {
        engine.start();
        if (engine.state === 'playing') engine.pause();
      }

      // Promote view-state to full and rewrite the header.
      scopeView = {
        scope: 'full',
        activeWords: fullWords,
        headerText: newHeader,
        showSwapBtn: false,
        fallback: null,
      };
      currentScope = 'full';
      header.textContent = newHeader;
      swapBtn?.remove();

      // The engine.start() emission above will have set ariaLive to
      // fullWords[0]; overwrite with the swap announcement so AT users hear
      // the transition not the first word.
      ariaLive.textContent = OVERLAY_TEXT.expandedAnnouncement(fullWords.length);

      reflectEngineState();
      renderPreview();
      playPauseBtn.focus();
    };

    swapBtn?.addEventListener('click', swapToFull);

    // ===== Tweaks popover (#step-3) =====
    // Click wiring lands here. syncThemeButtons is defined as a function
    // declaration above the subscribeSettings block so the echo path can
    // call it without a TDZ hazard.
    syncThemeButtons(opts.initialSettings.theme);
    // Defense-in-depth: dataset is attacker-reachable on an open shadow
    // root, so validate against the allowlist before flowing into
    // applyTheme / persistence callback (security-adversary finding #5).
    const ALLOWED_THEME_IDS = new Set<string>([...THEME_IDS, 'system']);
    for (const btn of themeButtons) {
      btn.addEventListener('click', () => {
        const raw = btn.dataset.themeId;
        if (!raw || !ALLOWED_THEME_IDS.has(raw)) return;
        const id = raw as ThemeId | 'system';
        syncThemeButtons(id);
        currentTheme = id;
        // Apply locally for instant feedback. The subscribeSettings echo
        // (if any) will run applyTheme again with the same resolved value;
        // applyTheme is idempotent so a duplicate write is harmless.
        applyTheme(resolveTheme(id, view), modal);
        if (id === 'system') installSystemThemeListener();
        else removeSystemThemeListener();
        opts.onThemeChange?.(id);
        // WCAG 4.1.3 Status Messages — confirm the theme switch via the
        // polite live region. AT users hear "Theme: Sepia" so they know
        // their click had a non-trivial side effect beyond the button
        // state flip (a11y-extension-designer finding #4). Clear-then-set
        // forces re-announcement when the same theme is clicked twice.
        ariaLive.textContent = '';
        ariaLive.textContent = OVERLAY_TEXT.themeAnnouncement(id);
      });
    }

    const isTweaksOpen = (): boolean => !tweaksPanel.hidden;
    // Disclosure pattern (ARIA-APG) — no inner focus trap. The outer modal
    // trap's `isInHiddenSubtree` filter excludes the panel's controls
    // while hidden; when open, Tab flows naturally through panel buttons
    // alongside the rest of the modal's focusables. The settings button +
    // panel form a labeled relationship via aria-controls + aria-expanded.
    const openTweaks = (): void => {
      if (!tweaksPanel.hidden) return;
      tweaksPanel.hidden = false;
      settingsBtn.setAttribute('aria-expanded', 'true');
      // Move focus into the panel so kbd users land on the first theme
      // button on open (matches mouse-user expectation of "I clicked
      // settings, the next thing I do happens in the panel"). The first
      // theme button is the first focusable inside the panel.
      const firstFocusable = tweaksPanel.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled])',
      );
      firstFocusable?.focus();
    };
    const closeTweaks = (returnFocus: boolean): void => {
      if (tweaksPanel.hidden) return;
      tweaksPanel.hidden = true;
      settingsBtn.setAttribute('aria-expanded', 'false');
      if (returnFocus) settingsBtn.focus();
    };
    settingsBtn.addEventListener('click', (e) => {
      // Stop propagation so the click doesn't trip the click-outside
      // listener below in the same event tick.
      e.stopPropagation();
      if (isTweaksOpen()) closeTweaks(true);
      else openTweaks();
    });

    // Click-outside — any pointerdown inside the modal or backdrop that
    // is NOT inside the panel AND not on the settings button closes the
    // panel. Bound on the shadow root so we catch events before they
    // reach the document; we use `pointerdown` (covers mouse, touch, pen)
    // so touch-primary users can also dismiss — synthesized mousedown is
    // suppressed on some gesture paths in iOS Safari + recent Chromium
    // (security-adversary finding #4).
    const onShadowPointerDown = (e: Event): void => {
      if (!isTweaksOpen()) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (tweaksPanel.contains(target)) return;
      if (settingsBtn.contains(target)) return;
      closeTweaks(true);
    };
    shadow.addEventListener('pointerdown', onShadowPointerDown, true);
    // Captured into the outer closure for symmetric teardown in unmount()
    // — every other shadow listener pairs add+remove explicitly so a
    // mount/unmount cycle does not accumulate handlers
    // (perf-adversary finding #4 + security-adversary finding #3).
    uninstallTweaksPointerDown = () => {
      shadow.removeEventListener('pointerdown', onShadowPointerDown, true);
    };

    uninstallTrap = installFocusTrap(modal);
    // installFocusTrap auto-focuses the first DOM-order focusable (the
    // close button at top-right). Override to land on play/pause per
    // AC #16 — the user's single keystroke to start or pause must be the
    // initial tab target. Same JS task as the trap install, so no flash.
    playPauseBtn.focus();

    const close = () => unmount();
    closeBtn.addEventListener('click', close);

    // Font-size stepper handlers (#29). Apply locally for instant
    // visual feedback, then dispatch upstream so the chrome glue can
    // persist to chrome.storage.sync. The applied value is the clamped
    // result — buttons are also disabled at the boundary, so a
    // boundary-press is the no-op safety net for assistive tech that
    // ignores `disabled`.
    const stepFontSize = (delta: number): void => {
      const next = clampFontSize(currentFontSize + delta);
      if (next === currentFontSize) return;
      applyFontSize(next);
      opts.onFontSizeChange?.(next);
    };
    fontDecBtn.addEventListener('click', () => stepFontSize(-FONT_SIZE_STEP));
    fontIncBtn.addEventListener('click', () => stepFontSize(FONT_SIZE_STEP));
    // Plain clamp — native <input type="range"> already enforces min/max and
    // step on browser-driven events, and the keyboard ArrowUp/Down deltas are
    // always on the canonical grid. The previous `Number.isFinite` guard and
    // step-snap were dead paths in practice (ring review #21).
    const clampWpm = (n: number): number => Math.max(WPM_MIN, Math.min(WPM_MAX, n));
    // `persist` controls whether onWpmChange fires. Two callsites need
    // different answers:
    //   - slider `change` (commit) + subscribeSettings echo → persist: true
    //     (subscribeSettings goes through the no-op short-circuit so the
    //      echo back to storage stays a no-op).
    //   - stepWpm (ArrowUp/Down keyboard shortcut) → persist: false. The
    //     main contract on the keyboard shortcut is "update engine cadence
    //     without persisting"; issue #24 names the SLIDER as the persistence
    //     surface, not the keyboard.
    const applyWpm = (next: number, opts2: { persist: boolean }): void => {
      if (!engine) return;
      const clamped = clampWpm(next);
      if (clamped === currentWpm) return;
      currentWpm = clamped;
      engine.setWpm(clamped);
      syncWpmUi(clamped);
      if (opts2.persist) opts.onWpmChange?.(clamped);
    };
    // ArrowUp / ArrowDown — adjust engine cadence without persisting. Issue
    // #24 names the slider as the persistence surface; the keyboard
    // shortcut intentionally stays session-only so a user can probe faster
    // speeds with arrow keys without rewriting their saved default.
    const stepWpm = (delta: number): void => {
      applyWpm(currentWpm + delta, { persist: false });
    };

    // Prev / next sentence buttons (#23). seekToSentence handles state
    // transitions (idle = silent, paused = replacement word event, playing =
    // restart at new position) and short-circuits on no further boundary.
    prevSentenceBtn.addEventListener('click', () => {
      engine?.seekToSentence('prev');
    });
    nextSentenceBtn.addEventListener('click', () => {
      engine?.seekToSentence('next');
    });

    // WPM slider (#24). Split `input` vs `change`:
    //   - `input` fires ~60×/sec during drag — UI-only update (slider
    //     value, readout text, currentWpm cache). Calling engine.setWpm
    //     on every tick would `clearPending()` + `scheduleNext()` per
    //     tick, resetting the active word's remaining-time and stalling
    //     the RSVP stream while the user drags (ring review #21).
    //   - `change` fires on drag release / keyboard commit — push the
    //     final value through applyWpm so engine cadence + persistence
    //     happen once per discrete drag, not per tick.
    wpmSlider.addEventListener('input', () => {
      const raw = Number(wpmSlider.value);
      const clamped = clampWpm(raw);
      currentWpm = clamped;
      wpmSlider.value = String(clamped);
      wpmReadout.textContent = OVERLAY_TEXT.wpmReadout(clamped);
    });
    wpmSlider.addEventListener('change', () => {
      const raw = Number(wpmSlider.value);
      const clamped = clampWpm(raw);
      // Bypass applyWpm's currentWpm short-circuit: `input` has already
      // moved currentWpm to the dragged value, so applyWpm would no-op
      // and skip engine.setWpm + persistence. Call them directly here.
      if (!engine) return;
      engine.setWpm(clamped);
      // Keep the UI source of truth aligned with the committed value
      // (defensive — input handler already syncs).
      if (currentWpm !== clamped) {
        currentWpm = clamped;
        syncWpmUi(clamped);
      }
      opts.onWpmChange?.(clamped);
    });
    // Progress scrubber interaction (#47). Spec: pause-on-scrub, stay
    // paused. mousedown/touchstart prime the engine into paused state
    // BEFORE the first `input` so a drag that traverses many positions
    // doesn't fight the per-tick scheduler. `input` fires for keyboard
    // (Arrow keys on the focused range) too, so the same handler covers
    // both surfaces.
    // FIX-6 / FIX-7 — mark a scrub session in progress + fire the
    // one-shot polite announcement on first event of the session. The
    // announcement MUST be written BEFORE `scrubInProgress` flips true
    // OR before any seekTo runs — otherwise the suppression flag would
    // block our own announcement, OR the seekTo's replacement-event
    // would race the announcement onto aria-live first. We write the
    // announcement first, then flip the flag so subsequent emissions
    // in this session are suppressed.
    const beginScrubSession = (): void => {
      if (!scrubAnnouncementFired) {
        ariaLive.textContent = OVERLAY_TEXT.SCRUB_PAUSED_ANNOUNCEMENT;
        scrubAnnouncementFired = true;
      }
      scrubInProgress = true;
      // #52 PART D — scrubInProgress is an input into the auto-hide
      // computation; recompute so a mid-drag user keeps the bar visible
      // even if the engine state is still 'playing' (e.g. before the
      // scrubFromPause call lands).
      recomputeScrubberVisibility();
      // Reset the debounce window every event so a held Arrow / sustained
      // drag stays in one session.
      if (scrubDebounceTimer !== null) clearTimeout(scrubDebounceTimer);
      scrubDebounceTimer = setTimeout(() => {
        scrubDebounceTimer = null;
        scrubInProgress = false;
        scrubAnnouncementFired = false;
        // #52 PART D — scrubInProgress is now false; recompute so the
        // bar can auto-hide if engine is back to 'playing' AND no hover
        // / focus is active.
        recomputeScrubberVisibility();
      }, SCRUB_DEBOUNCE_MS);
    };
    const scrubFromPause = (): void => {
      if (engine?.state === 'playing') {
        engine.pause();
        reflectEngineState();
      }
    };
    scrubber.addEventListener('mousedown', () => {
      beginScrubSession();
      scrubFromPause();
    });
    scrubber.addEventListener(
      'touchstart',
      () => {
        beginScrubSession();
        scrubFromPause();
      },
      { passive: true },
    );
    // #52 PART D — hover + focus listeners drive the auto-hide override.
    // Bound on the scrubber-area parent so hovering ANY part of the bar
    // (including the time-label row) keeps it visible; bound to focusin /
    // focusout (the bubbling counterparts of focus / blur) so a focused
    // scrubber slider keeps the bar visible without each focusable child
    // needing its own listener. The parent element is captured in
    // `scrubberArea` (set during the recompute closure setup).
    if (scrubberArea) {
      scrubberArea.addEventListener('mouseenter', () => {
        scrubberHovered = true;
        recomputeScrubberVisibility();
      });
      scrubberArea.addEventListener('mouseleave', () => {
        scrubberHovered = false;
        recomputeScrubberVisibility();
      });
      scrubberArea.addEventListener('focusin', () => {
        scrubberFocused = true;
        recomputeScrubberVisibility();
      });
      scrubberArea.addEventListener('focusout', () => {
        scrubberFocused = false;
        recomputeScrubberVisibility();
      });
    }
    scrubber.addEventListener('input', () => {
      if (!engine) return;
      const raw = Number(scrubber.value);
      // Number guard — Number('') is 0 but Number('abc') is NaN; the
      // engine.seekTo finite-integer guard would also catch this, but
      // refusing here keeps the no-op observable to the per-emission
      // updateScrubber path (no stale label update from a doomed seek).
      if (!Number.isFinite(raw)) return;
      const target = Math.trunc(raw);
      // Begin session BEFORE pause so the announcement reaches aria-live
      // first; the suppression flag is set after the textContent write
      // so the engine's subsequent replacement event won't clobber it.
      beginScrubSession();
      scrubFromPause();
      // snapToSentence:false — the user is dragging to a specific
      // position; sentence-snap on a mid-sentence drop would jump back
      // and feel broken (matches Safari behavior).
      engine.seekTo(target, { snapToSentence: false });
      // The paused-state seekTo emits a replacement word/chunk event
      // which the subscribe handler runs updateScrubber on — no need
      // to call it again here.
    });

    onKeydown = (e: KeyboardEvent) => {
      // Capture-phase handler installed on opts.doc — preventDefault denies
      // page-side hotkeys (YouTube Space, Docs arrows) while overlay owns
      // input. Modifier-key combos pass through so OS shortcuts like
      // Cmd+ArrowLeft (back) and Shift+ArrowRight (text selection) still
      // work.
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        // #step-3 — when the Tweaks popover is open, Escape closes ONLY
        // the panel and returns focus to the settings button. Existing
        // overlay-close behaviour applies when the panel is closed.
        if (isTweaksOpen()) {
          closeTweaks(true);
          return;
        }
        close();
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
        return;
      }
      if (e.key === 'ArrowLeft') {
        // #47 scrubber guard: native <input type="range"> owns Arrow
        // keys for incremental position changes. Letting the document
        // handler fire seekToSentence here would steal the keystroke
        // away from the focused scrubber AND scramble the user's
        // expected fine-grained navigation.
        if (e.target === scrubber) return;
        e.preventDefault();
        engine?.seekToSentence('prev');
        return;
      }
      if (e.key === 'ArrowRight') {
        if (e.target === scrubber) return;
        e.preventDefault();
        engine?.seekToSentence('next');
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        stepWpm(WPM_STEP);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        stepWpm(-WPM_STEP);
        return;
      }
    };
    opts.doc.addEventListener('keydown', onKeydown, true);

    status = 'mounted';
  }

  function unmount(): void {
    if (status === 'unmounted') return;
    // #48 — drop the toast auto-dismiss timer first so a late fire after
    // unmount can't reach into a detached shadow root.
    if (resumeToastTimer !== null) {
      clearTimeout(resumeToastTimer);
      resumeToastTimer = null;
    }
    // #47 ring-review FIX-6 — clear pending scrub debounce so a late
    // fire after unmount can't touch the detached shadow's aria-live or
    // the now-null `scrubInProgress` closure state.
    if (scrubDebounceTimer !== null) {
      clearTimeout(scrubDebounceTimer);
      scrubDebounceTimer = null;
    }
    // #step-3 — drop the shadow pointerdown listener before the outer
    // trap so the click-outside handler can't fire against a detached
    // shadow during teardown.
    uninstallTweaksPointerDown?.();
    uninstallTweaksPointerDown = null;
    uninstallTrap?.();
    uninstallTrap = null;
    if (onKeydown) opts.doc.removeEventListener('keydown', onKeydown, true);
    onKeydown = null;
    // #25 — capture progress + active scope BEFORE stopping the engine
    // so the host can build a session-resume snapshot. `engine.stop()`
    // does not reset `nextIndex`, so reading `progress()` after stop
    // would still work in practice, but capturing pre-stop keeps the
    // contract self-evident.
    let snapshot: OverlayCloseSnapshot | undefined;
    if (engine && currentScope) {
      const progress = engine.progress();
      if (progress.total > 0) {
        snapshot = {
          index: progress.index,
          total: progress.total,
          scope: currentScope,
        };
      }
    }
    engine?.stop();
    engine = null;
    currentScope = null;
    // #26 — drop the settings subscription BEFORE detaching the OS theme
    // listener. The settings callback can re-install the matchMedia
    // listener (when `s.theme === 'system'`); if we tore down matchMedia
    // first, a synchronous settings echo or microtask-drained emission
    // landing between the two calls would re-attach against a modal we're
    // about to remove, leaking a closure that pins the shadow root + engine.
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    uninstallSystemThemeListener?.();
    uninstallSystemThemeListener = null;
    host?.remove();
    host = null;
    if (priorOverflow !== null) {
      opts.doc.documentElement.style.overflow = priorOverflow;
      priorOverflow = null;
    }
    status = 'unmounted';
    opts.onClose?.(snapshot);
  }

  return {
    get status() {
      return status;
    },
    mount,
    unmount,
  };
}
