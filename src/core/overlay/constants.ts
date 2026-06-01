/**
 * Overlay constants — CSS class names, IDs, attribute names, and
 * user-facing text strings.
 *
 * Centralized so:
 *   - DOM builders + stylesheet rules share a single source of class names
 *     (manual sync with `styles.ts` selectors)
 *   - Translatable strings are inventoried in one place ahead of the
 *     chrome.i18n migration tracked under #57
 *   - Reviewers can audit hard-coded text without grepping the whole module
 *
 * Pure data — no DOM, no chrome.*; safe for `src/core/`.
 */

/** CSS class names used by the overlay DOM. Must match selectors in `styles.ts`. */
export const OVERLAY_CLASS = Object.freeze({
  BACKDROP: 'backdrop',
  MODAL: 'modal',
  SCOPE_HEADER: 'scope-header',
  SCOPE_SUBTITLE: 'scope-subtitle',
  WORD_REGION: 'word-region',
  /**
   * Per-word wrapper inside `.word-region` (#52). Always present (one
   * per word in single-word mode, N per chunk in chunk mode). Carries
   * the 3-column ORP grid when `data-alignment="orp"` so each word's
   * focus character anchors at the same horizontal position across
   * successive runs. In chunk mode, multiple word-runs are separated
   * by space text nodes inside `.word-region`.
   */
  WORD_RUN: 'word-run',
  ARIA_LIVE: 'aria-live',
  TRAP_SENTINEL: 'trap-sentinel',
  CLOSE_BTN: 'close-btn',
  FOOTER: 'footer',
  SCOPE_SWAP_BTN: 'scope-swap-btn',
  PLAY_PAUSE_BTN: 'play-pause-btn',
  FONT_DEC_BTN: 'font-dec-btn',
  FONT_INC_BTN: 'font-inc-btn',
  PREV_SENTENCE_BTN: 'prev-sentence-btn',
  NEXT_SENTENCE_BTN: 'next-sentence-btn',
  /**
   * WPM stepper (#213) — `[−] [num] [wpm] [+]` per the Hi-Fi mockup. The
   * outer `.wpm-display` is a pill chip containing two buttons (decrement
   * / increment), a numeric span, and a unit-label span. Replaces the
   * prior `<input type="range">` slider + standalone readout.
   */
  WPM_STEPPER: 'wpm-display',
  WPM_STEPPER_DEC: 'wpm-stepper-dec',
  WPM_STEPPER_INC: 'wpm-stepper-inc',
  WPM_STEPPER_NUM: 'wpm-stepper-num',
  WPM_STEPPER_LBL: 'wpm-stepper-lbl',
  CONTEXT_PREVIEW: 'context-preview',
  CONTEXT_CURRENT: 'context-current',
  /** Reading-position resume toast (#48). */
  RESUME_TOAST: 'resume-toast',
  RESUME_TOAST_BTN: 'resume-toast-start-over',
  /** Progress scrubber (#47) — Safari-parity time-labeled position control. */
  SCRUBBER_AREA: 'scrubber-area',
  SCRUBBER_LABELS: 'scrubber-labels',
  SCRUBBER_ELAPSED: 'scrubber-elapsed',
  SCRUBBER_REMAINING: 'scrubber-remaining',
  SCRUBBER_SLIDER: 'scrubber-slider',
  /**
   * Modifier applied to `.modal` when the user has enabled OpenDyslexic
   * (#27). The CSS rule overrides `font-family` to the bundled
   * OpenDyslexic family with a system-ui fallback (so a font-load failure
   * degrades gracefully rather than rendering invisible text).
   */
  OPENDYSLEXIC: 'opendyslexic',
  /**
   * Mockup-fidelity top chrome — modal-header bar with mini-logo + name +
   * hostname on the left and icon-button actions group on the right.
   * Hosts the close button (which used to be absolute-positioned top-right)
   * plus stub bookmark + settings buttons.
   */
  MODAL_HEADER: 'modal-header',
  MODAL_TITLE: 'modal-title',
  MINI_LOGO: 'mini-logo',
  MODAL_SOURCE: 'modal-source',
  MODAL_ACTIONS: 'modal-actions',
  BOOKMARK_BTN: 'bookmark-btn',
  SETTINGS_BTN: 'settings-btn',
  /**
   * Tweaks popover panel (#step-3) — anchored to the modal header's
   * settings button, hidden by default, opened by clicking the ⚙
   * affordance. Hosts theme picker now; focus-style / accent / dim
   * stubs render disabled and wire up in later steps.
   */
  TWEAKS_PANEL: 'tweaks-panel',
  TWEAKS_HEADING: 'tweaks-heading',
  TWEAKS_SECTION: 'tweaks-section',
  TWEAKS_SECTION_LABEL: 'tweaks-section-label',
  TWEAKS_SEG: 'tweaks-seg',
  TWEAKS_SEG_BTN: 'tweaks-seg-btn',
  TWEAKS_SEG_BTN_ACTIVE: 'active',
  TWEAKS_ACCENT_SWATCH: 'tweaks-accent-swatch',
  TWEAKS_DIM_RANGE: 'tweaks-dim-range',
});

/** DOM ids referenced by ARIA relationships (e.g., aria-labelledby). */
export const OVERLAY_ID = Object.freeze({
  SCOPE_HEADER: 'sr-scope-header',
});

/** HTML attribute names owned by the overlay (e.g., the host marker). */
export const OVERLAY_ATTR = Object.freeze({
  HOST: 'data-speedreader-overlay',
  /**
   * Word alignment (#52). Written on the host element with values
   * `'orp'` (default — 3-column ORP-aligned grid) or `'center'`
   * (centered inline layout). `styles.ts` consumes via
   * `:host([data-alignment="…"])` selectors. Matches the Safari
   * upstream pattern (`docs/superpowers/specs/2026-04-04-orp-alignment-design.md`).
   */
  ALIGNMENT: 'data-alignment',
});

/**
 * User-facing text strings. Centralized for the same reasons as
 * OVERLAY_CLASS — and additionally to make the eventual chrome.i18n
 * migration (#57) a single-call-site swap rather than a grep-and-replace.
 *
 * Template functions are intentionally plain — no Intl.PluralRules; the
 * spec pins these exact strings and pluralization is out of scope for MVP.
 */
export const OVERLAY_TEXT = Object.freeze({
  /** Modal default label when no scope is provided. */
  DEFAULT_HEADER: 'SpeedReader',

  /** Close-button visible glyph + accessible label. */
  CLOSE_GLYPH: 'X',
  CLOSE_LABEL: 'Close reader',

  /** Play/pause button labels + glyphs. Mockup uses glyph-only inside the
   * circular primary button; aria-label carries the full action for AT. */
  PLAY_GLYPH: '▶',
  PAUSE_GLYPH: '⏸',
  PLAY_LABEL: 'Play reading',
  PAUSE_LABEL: 'Pause reading',

  /** Scope-swap button label + accessible name. */
  SWAP_GLYPH: '← Full article',
  SWAP_LABEL: 'Switch to full article',

  /** Font-size stepper glyphs + accessible labels (#29). */
  FONT_DEC_GLYPH: 'A−',
  FONT_INC_GLYPH: 'A+',
  FONT_DEC_LABEL: 'Decrease font size',
  FONT_INC_LABEL: 'Increase font size',

  /** Prev / next sentence buttons (#23). */
  PREV_SENTENCE_GLYPH: '⏮',
  NEXT_SENTENCE_GLYPH: '⏭',
  PREV_SENTENCE_LABEL: 'Previous sentence',
  NEXT_SENTENCE_LABEL: 'Next sentence',

  /**
   * Dynamic `aria-label` for the WPM display span (#214 a11y BLOCK 2).
   *
   * Replaced the original static `WPM_SPINBUTTON_LABEL` + `role="spinbutton"`
   * shape. ARIA APG requires spinbutton elements to be focusable + handle
   * ArrowUp/Down/Home/End; the span had none of that, so AT users heard
   * "spin button, 300" and got silence when arrowing. The span is now a
   * pure display element whose `aria-label` is rewritten on every commit
   * to carry the live value; the ± buttons own the increment affordance.
   */
  wpmDisplayLabel(wpm: number): string {
    return `Reading speed, ${wpm} words per minute`;
  },

  /**
   * Polite-live-region announcement fired on each user-initiated WPM
   * commit (stepper ± click, NOT keyboard hotkey) — #214 a11y BLOCK 1.
   * Terse on purpose: repeated announcements need to be cheap to hear,
   * and the unit "wpm" matches the visible chip label.
   */
  wpmAnnouncement(wpm: number): string {
    return `${wpm} wpm`;
  },

  /** WPM stepper button accessible labels (#213). */
  WPM_DEC_LABEL: 'Decrease reading speed',
  WPM_INC_LABEL: 'Increase reading speed',

  /** WPM stepper button visible glyphs (#213). Match the Hi-Fi mockup. */
  WPM_DEC_GLYPH: '−',
  WPM_INC_GLYPH: '+',

  /** WPM stepper unit-label text — visible "wpm" next to the number. */
  WPM_UNIT_LABEL: 'wpm',

  /** Empty-selection fallback subtitle + polite live-region announcement. */
  EMPTY_SELECTION_FALLBACK: 'No selection detected. Reading full article instead.',

  /** Surrounding-sentence preview region label (#20). */
  CONTEXT_LABEL: 'Surrounding sentence',

  /** Scoped-mode header template: `SELECTION · N words · ~M sec`. */
  scopedHeader(wordCount: number, seconds: number): string {
    return `SELECTION · ${wordCount} words · ~${seconds} sec`;
  },

  /** Full-mode header fallback when no article title is available. */
  fullHeaderFallback(wordCount: number): string {
    return `Whole page — ${wordCount} words`;
  },

  /** Live-region announcement after the scope-swap completes. */
  expandedAnnouncement(totalWords: number): string {
    return `Expanded to full article. Restarting from word 1 of ${totalWords}. Paused.`;
  },

  /** Reading-position resume toast template (#48). */
  resumeToast(wordIndex: number, totalWords: number): string {
    return `Resumed at word ${wordIndex} of ${totalWords}`;
  },
  RESUME_TOAST_START_OVER: 'Start over',
  RESUME_TOAST_DISMISS_MS: 5_000,

  /** Progress scrubber (#47). */
  SCRUBBER_LABEL: 'Reading position',

  /**
   * Polite announcement spoken once per scrub session (FIX-7 — a11y MED
   * #2). The pause-on-scrub spec silently flips the play/pause button
   * label; ADHD + screen-reader users need an explicit state-change
   * confirmation. Fires on the FIRST scrub input of a session and is
   * suppressed for the remainder of the session by the FIX-6 debounce
   * (so rapid drags don't re-fire). A new session begins after the
   * 250ms scrub-debounce window elapses.
   */
  SCRUB_PAUSED_ANNOUNCEMENT: 'Paused. Scrubbing reading position.',

  /**
   * Format a non-negative duration (in seconds) as `m:ss`. Mirrors the
   * Safari upstream helper: rounds seconds, pads `ss` to width 2, joins
   * with a colon. Negative or non-finite inputs clamp to `0:00` so a
   * caller cannot leak `NaN:NaN` into the visible label.
   */
  formatTime(seconds: number): string {
    const safe = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0;
    const minutes = Math.floor(safe / 60);
    const ss = String(safe % 60).padStart(2, '0');
    return `${minutes}:${ss}`;
  },

  /**
   * Visible-equivalent string for `aria-valuetext` on the scrubber slider.
   * AT renders `min:ss elapsed, min:ss remaining`; the visible labels carry
   * the same numbers (with a leading `-` on the remaining label).
   */
  scrubberValueText(elapsedSec: number, remainingSec: number): string {
    return `${OVERLAY_TEXT.formatTime(elapsedSec)} elapsed, ${OVERLAY_TEXT.formatTime(remainingSec)} remaining`;
  },

  /** Mockup top chrome — brand mini-logo letters + product name. */
  MINI_LOGO_TEXT: 'SR',
  PRODUCT_NAME: 'SpeedReader',
  /** Joiner between product name and hostname: " · gutenberg.org". */
  SOURCE_SEPARATOR: ' · ',

  /** Stub action buttons — handlers wired in subsequent commits. */
  BOOKMARK_GLYPH: '☆',
  BOOKMARK_LABEL: 'Bookmark this article',
  SETTINGS_GLYPH: '⚙',
  SETTINGS_LABEL: 'Reader settings',

  /** Tweaks popover (#step-3). */
  TWEAKS_HEADING: 'Tweaks',
  TWEAKS_THEME_LABEL: 'Theme',
  TWEAKS_FOCUS_STYLE_LABEL: 'Focus style',
  TWEAKS_ACCENT_LABEL: 'Accent',
  TWEAKS_DIM_LABEL: 'Modal dim',
  TWEAKS_SYSTEM_LABEL: 'System',
  TWEAKS_FOCUS_LINE_LABEL: 'Line',
  TWEAKS_FOCUS_BOLD_LABEL: 'Bold',
  /**
   * Theme picker accessible-name template. Visible button text is the
   * theme id capitalized; AT users hear the explicit "Light theme" form
   * so the button purpose is unambiguous outside the section grouping.
   */
  themeButtonLabel(name: string): string {
    return `${name} theme`;
  },

  /**
   * Polite live-region announcement after a theme switch (WCAG 4.1.3).
   * The visible button state flip alone leaves AT users without
   * confirmation that the theme actually applied across the chrome.
   */
  themeAnnouncement(id: string): string {
    const pretty = id === 'system' ? 'System' : id.charAt(0).toUpperCase() + id.slice(1);
    return `Theme: ${pretty}`;
  },
});
