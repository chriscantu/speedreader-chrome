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
  WPM_SLIDER: 'wpm-slider',
  WPM_READOUT: 'wpm-readout',
  CONTEXT_PREVIEW: 'context-preview',
  CONTEXT_CURRENT: 'context-current',
});

/** DOM ids referenced by ARIA relationships (e.g., aria-labelledby). */
export const OVERLAY_ID = Object.freeze({
  SCOPE_HEADER: 'sr-scope-header',
});

/** HTML attribute names owned by the overlay (e.g., the host marker). */
export const OVERLAY_ATTR = Object.freeze({
  HOST: 'data-speedreader-overlay',
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

  /** Play/pause button labels + glyphs. */
  PLAY_GLYPH: '▶ Play',
  PAUSE_GLYPH: '⏸ Pause',
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

  /** WPM slider accessible label (#24). */
  WPM_SLIDER_LABEL: 'Reading speed (words per minute)',

  /** WPM readout template — visible "300 wpm" text next to the slider. */
  wpmReadout(wpm: number): string {
    return `${wpm} wpm`;
  },

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
});
