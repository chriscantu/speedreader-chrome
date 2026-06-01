/**
 * Overlay stylesheet, served via adoptedStyleSheets on the open shadow
 * root. Reskinned to match the approved Hi-Fi mockup
 * (docs/design source: SpeedReader-standalone Hi-Fi). The DOM structure
 * is unchanged; existing class names from `constants.ts` remain the
 * single source of truth so the 24-file overlay test suite stays green.
 *
 * Visual deltas vs prior styling (mockup-derived):
 *   - Modal: 620px max, rounded 16px corners, surface bg, accent border
 *   - Typography: Roboto / Roboto-Mono with system fallbacks
 *   - Close button: 30px circular icon-btn (was 44px outlined square)
 *   - Word region: 54px mono ORP word, accent focus letter
 *   - Context preview: 13px serif, `.now` highlight inline
 *   - Progress scrubber: thin (4px) accent rail with circular thumb
 *   - Controls: circular ctrl-btns, primary play (48px accent)
 *   - WPM: slider styled to match mockup's pill chip
 *
 * Ancillary tokens (--surface-2, --text-muted, --border, etc.) are
 * derived from the 5 theme tokens via color-mix so the existing
 * applyTheme() contract stays the contract.
 *
 * forced-colors block uses system tokens per #35 spec section 6.
 * prefers-reduced-motion disables chrome transitions only (RSVP cadence
 * is unaffected per spec, since cadence is the format).
 */
export const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: block;
  font-family: 'Roboto', 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;

  /* Theme-invariant tokens (do not depend on applyTheme writes). */
  --brand-red: #d93025;
  --shadow-1: 0 1px 2px rgba(0,0,0,.10), 0 1px 3px 1px rgba(0,0,0,.06);
  --shadow-3: 0 4px 8px 3px rgba(0,0,0,.18), 0 1px 3px rgba(0,0,0,.32);
  --radius: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --font-ui: 'Roboto', 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'Roboto Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  --font-reader: 'Source Serif 4', 'Source Serif Pro', Georgia, serif;
}

.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  padding: 40px;
}

.modal {
  /* applyTheme() writes --bg/--surface/--text/--accent/--accent-soft onto
   * THIS element. The ancillary palette (--surface-2/-3, --text-muted,
   * --border, etc.) is derived here from those writes via color-mix so a
   * theme flip cascades through every descendant in one update. Keep
   * derivations on .modal (NOT :host) so the cascade has the post-applyTheme
   * values to mix against. */
  --surface-2: color-mix(in oklab, var(--surface, #ffffff) 96%, var(--text, #202124));
  --surface-3: color-mix(in oklab, var(--surface, #ffffff) 92%, var(--text, #202124));
  --text-2: color-mix(in oklab, var(--text, #202124) 85%, var(--surface, #ffffff));
  /* --text-muted at 60/40 mix lands ~4.0–4.2:1 on light/paper/cream
   * surfaces — below WCAG 1.4.3 (4.5:1 for &lt;18px non-bold). 75/25 lands
   * ~5.5:1 across themes and preserves the muted feel
   * (a11y-extension-designer finding #1). */
  --text-muted: color-mix(in oklab, var(--text, #202124) 75%, var(--surface, #ffffff));
  --text-faint: color-mix(in oklab, var(--text, #202124) 40%, var(--surface, #ffffff));
  --border: color-mix(in oklab, var(--text, #202124) 18%, var(--surface, #ffffff));
  --border-strong: color-mix(in oklab, var(--text, #202124) 35%, var(--surface, #ffffff));
  --accent-hover: color-mix(in oklab, var(--accent, #1a73e8) 88%, black);

  background: var(--surface, #ffffff);
  color: var(--text, #202124);
  border-radius: var(--radius-xl);
  padding: 0;
  inline-size: 620px;
  max-inline-size: calc(100% - 40px);
  box-shadow: var(--shadow-3);
  border: 1px solid var(--border);
  position: relative;
  overflow: hidden;
  container-type: inline-size;
  container-name: rsvp;
  font-family: var(--font-ui);
}

/* Font picker (#28) — Safari-parity 5-font set scoped to reading surface. */
.modal.opendyslexic .word-region,
.modal.opendyslexic .context-current,
.modal.opendyslexic .context-preview {
  font-family:
    'OpenDyslexic', 'Atkinson Hyperlegible', 'Comic Sans MS',
    'Trebuchet MS', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

.modal.newYork .word-region,
.modal.newYork .context-current,
.modal.newYork .context-preview {
  font-family: 'New York', 'Iowan Old Style', Georgia, serif;
}

.modal.georgia .word-region,
.modal.georgia .context-current,
.modal.georgia .context-preview {
  font-family: Georgia, 'Times New Roman', serif;
}

.modal.menlo .word-region,
.modal.menlo .context-current,
.modal.menlo .context-preview {
  font-family: Menlo, 'Courier New', monospace;
}

/* ===== Modal header bar — mockup ".modal-header" =====
 * Top chrome row with mini-logo + product name + hostname on left,
 * action icons on right. Sits above .scope-header (which carries the
 * article-meta info). */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px 10px 18px;
  border-block-end: 1px solid var(--border);
  background: var(--surface-2);
  margin-block-end: 2px;
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font: 500 13px / 1.2 var(--font-ui);
  color: var(--text);
  min-inline-size: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-logo {
  inline-size: 22px;
  block-size: 22px;
  border-radius: 6px;
  background: var(--brand-red);
  color: #ffffff;
  display: grid;
  place-items: center;
  font: 700 9px / 1 var(--font-mono);
  flex-shrink: 0;
  letter-spacing: 0.05em;
}

.modal-source {
  color: var(--text-muted);
  font-weight: 400;
  font-size: 12px;
}

.modal-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* ===== Close + bookmark + settings — shared icon-btn baseline =====
 * In-header icon buttons. WCAG 2.5.5 target-size honored at 44px. */
.close-btn,
.bookmark-btn,
.settings-btn {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: 600 14px / 1 var(--font-ui);
  cursor: pointer;
  display: grid;
  place-items: center;
  padding: 0;
}

.bookmark-btn,
.settings-btn {
  font-size: 16px;
}

.close-btn:hover {
  background: var(--accent-soft, #e8f0fe);
  color: var(--text, #202124);
}

.bookmark-btn:hover,
.settings-btn:hover {
  background: var(--accent-soft, #e8f0fe);
  color: var(--text);
}

.close-btn:focus-visible,
.bookmark-btn:focus-visible,
.settings-btn:focus-visible {
  outline: 2px solid var(--accent, #1a73e8);
  outline-offset: 2px;
}

/* ===== Scope header — repurposed as ".article-meta" row =====
 * Mockup shows: bold title • author • word-count pill, 12px muted.
 * We carry just the header text in current DOM (h2 with full title or
 * scoped descriptor). Close icon now lives inside .modal-header, so the
 * right padding here is symmetric. */
.scope-header {
  margin: 0;
  padding: 14px 24px 0;
  font: 500 14px / 1.3 var(--font-ui);
  color: var(--text);
  letter-spacing: 0;
}

.scope-subtitle {
  margin: 4px 24px 0;
  padding: 0;
  font: 400 11px / 1.4 var(--font-ui);
  font-style: italic;
  color: var(--text-muted);
}

/* ===== Word region — mockup ".rsvp-stage > .rsvp-word" =====
 * Generous vertical padding gives the ORP word breathing room. The
 * accent focus-tick marks above and below the word are rendered as
 * CSS pseudo-elements anchored to the region's vertical center — no
 * DOM nodes required, so the existing word-run rendering pipeline
 * (single-word + chunk + ORP grid) is unaffected. */
.word-region {
  text-align: center;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: baseline;
  gap: 0 0.4ch;
  padding: 36px 24px 20px;
  font-family: var(--font-mono);
  font-size: var(--rsvp-font-size, clamp(40px, 8.5cqi + 0.5rem, 54px));
  font-weight: 500;
  letter-spacing: 0.01em;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  min-block-size: 110px;
  user-select: none;
  position: relative;
}

.word-region::before,
.word-region::after {
  content: '';
  position: absolute;
  inset-inline-start: 50%;
  transform: translateX(-50%);
  width: 1.5px;
  background: var(--accent, #1a73e8);
  opacity: 0.85;
  border-radius: 1px;
  pointer-events: none;
}

.word-region::before {
  top: 18px;
  height: 14px;
}

.word-region::after {
  bottom: 6px;
  height: 14px;
}

.word-region .focus {
  color: var(--accent, #1a73e8);
  font-weight: 600;
}

/* ORP alignment (#52) — preserved from prior implementation. */
:host([data-alignment="orp"]) .word-run {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: baseline;
}

:host([data-alignment="orp"]) .word-run > span:first-child {
  text-align: end;
}

:host([data-alignment="orp"]) .word-run > span:last-child {
  text-align: start;
}

:host([data-alignment="center"]) .word-run {
  display: block;
}

/* ===== Context preview — mockup ".rsvp-context" =====
 * 13px serif, muted, with the current word inline-highlighted via
 * .context-current → mockup's ".now" treatment (accent-soft bg pill). */
.context-preview {
  margin: 0;
  padding: 0 32px 16px;
  font: 400 13px / 1.5 var(--font-reader);
  color: var(--text-muted);
  text-align: center;
  min-block-size: 24px;
}

.context-preview[hidden] { display: none; }

.context-current {
  color: var(--text);
  background: var(--accent-soft, #e8f0fe);
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 500;
}

/* ===== Aria-live region (visually hidden but available to AT). ===== */
.aria-live {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* ===== Trap sentinels — focus trap boundaries. ===== */
.trap-sentinel {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
  pointer-events: none;
}

/* ===== Scrubber — mockup ".rsvp-progress" =====
 * 4px accent rail spanning the modal with elapsed/-remaining labels
 * on either side. The native <input range> retains its accessibility
 * surface; the visual track is styled via accent-color. */
.scrubber-area {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 24px 0;
  /* #52 PART D — auto-hide fade preserved. */
  transition: opacity 200ms ease-out, visibility 200ms ease-out;
}

.scrubber-labels {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font: 500 11px / 1 var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.scrubber-slider {
  inline-size: 100%;
  block-size: 22px; /* hit-target while visual track stays 4px */
  accent-color: var(--accent, #1a73e8);
  cursor: pointer;
  margin: 0;
}

.scrubber-slider:focus-visible {
  outline: 2px solid var(--accent, #1a73e8);
  outline-offset: 4px;
}

/* ===== Footer — mockup ".rsvp-controls" =====
 * Horizontal row: scope-swap • font ± • prev • play (primary) • next •
 * WPM slider • WPM readout. The play-pause-btn gets the primary
 * circular treatment; the other transport buttons share .ctrl-btn-ish
 * styling via their existing classes. */
.footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 6px;
  padding: 8px 18px 14px;
  border-block-start: 1px solid var(--border);
  background: var(--surface-2);
  margin-block-start: 8px;
}

/* Shared circular icon-btn baseline used by transport + font + scope swap.
 * Sized to WCAG 2.2 AA target-size floor (44px) — mockup's 38px visual
 * fits centered inside the larger hit-target via padding. */
.scope-swap-btn,
.font-dec-btn,
.font-inc-btn,
.prev-sentence-btn,
.next-sentence-btn {
  min-width: 44px;
  min-height: 44px;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--text-2);
  font: 500 14px / 1 var(--font-ui);
  cursor: pointer;
  display: grid;
  place-items: center;
}

.scope-swap-btn {
  /* Scope-swap shows text "← Full article" — let it expand horizontally. */
  width: auto;
  min-width: 44px;
  padding: 0 14px;
  border-radius: 22px;
}

.scope-swap-btn:hover {
  background: var(--accent-soft, #e8f0fe);
  color: var(--text, #202124);
}

.prev-sentence-btn:hover,
.next-sentence-btn:hover,
.font-dec-btn:hover,
.font-inc-btn:hover {
  background: var(--accent-soft, #e8f0fe);
  color: var(--text, #202124);
}

.scope-swap-btn:focus-visible,
.font-dec-btn:focus-visible,
.font-inc-btn:focus-visible,
.prev-sentence-btn:focus-visible,
.next-sentence-btn:focus-visible {
  outline: 2px solid var(--accent, #1a73e8);
  outline-offset: 2px;
}

.font-dec-btn:disabled,
.font-inc-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.prev-sentence-btn,
.next-sentence-btn {
  font-size: 16px;
  inline-size: 38px;
  block-size: 38px;
  padding: 0;
}

/* Primary play/pause — mockup's circular accent button. WCAG floor honored
 * by sizing to 48×48 (above the 44px target-size minimum). */
.play-pause-btn {
  width: 48px;
  height: 48px;
  min-width: 48px;
  min-height: 48px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--accent, #1a73e8);
  color: #ffffff;
  font: 600 14px / 1 var(--font-ui);
  cursor: pointer;
  display: grid;
  place-items: center;
  box-shadow: var(--shadow-1);
  /* The button's textContent is "▶ Play" / "⏸ Pause" from OVERLAY_TEXT.
   * The aria-label carries the full action for AT. */
  white-space: nowrap;
  overflow: hidden;
  font-size: 16px;
}

.play-pause-btn:hover {
  background: var(--accent-soft, #e8f0fe);
  color: var(--text, #202124);
}

.play-pause-btn:focus-visible {
  outline: 3px solid var(--accent, #1a73e8);
  outline-offset: 3px;
}

.play-pause-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* WPM slider + readout — styled as a pill chip pair.
 * Hit-target ≥44px per WCAG 2.2 AA. */
.wpm-slider {
  min-height: 44px;
  inline-size: clamp(100px, 18cqi, 180px);
  accent-color: var(--accent, #1a73e8);
  cursor: pointer;
}

.wpm-slider:focus-visible {
  outline: 2px solid var(--accent, #1a73e8);
  outline-offset: 4px;
}

.wpm-readout {
  font: 600 12px / 1 var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text);
  padding: 4px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  min-inline-size: 5ch;
  text-align: center;
}

/* ===== Resume toast (#48) — Hi-Fi chip styling. ===== */
.resume-toast {
  margin: 4px 24px 0;
  padding: 8px 14px;
  border-radius: var(--radius);
  background: var(--accent-soft, #e8f0fe);
  color: var(--text);
  font: 400 12px / 1.4 var(--font-ui);
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: center;
}

.resume-toast-start-over {
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--accent, #1a73e8);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}

.resume-toast-start-over:focus-visible {
  outline: 2px solid var(--accent, #1a73e8);
  outline-offset: 2px;
}

/* ===== Tweaks popover (#step-3) =====
 * Absolute-positioned panel anchored to the modal top-right, dropping
 * below the modal-header settings button. Hidden by default via the
 * hidden attribute. Segmented row uses the .tweaks-seg-btn shared
 * baseline; .active swaps the surface to accent-soft + accent text
 * for the pressed-state affordance.
 */
.tweaks-panel[hidden] { display: none; }

.tweaks-panel {
  position: absolute;
  inset-block-start: 56px;
  inset-inline-end: 12px;
  inline-size: 280px;
  max-inline-size: calc(100% - 24px);
  background: var(--surface, #ffffff);
  color: var(--text, #202124);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-3);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 2;
}

.tweaks-panel .tweaks-heading {
  margin: 0;
  font: 600 13px / 1.2 var(--font-ui);
  color: var(--text);
  letter-spacing: 0.02em;
}

.tweaks-panel .tweaks-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tweaks-panel .tweaks-section-label {
  font: 500 11px / 1.2 var(--font-ui);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.tweaks-panel .tweaks-seg {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tweaks-panel .tweaks-seg-btn {
  /* Honors WCAG 2.5.5 target-size floor (44px), matching the rest of
   * the overlay's tap-target discipline rather than the mockup's 32px
   * (a11y-extension-designer finding #5). */
  min-block-size: 44px;
  min-inline-size: 44px;
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text);
  font: 500 12px / 1.2 var(--font-ui);
  cursor: pointer;
}

.tweaks-panel .tweaks-seg-btn:hover:not([disabled]) {
  background: var(--accent-soft, #e8f0fe);
  border-color: var(--accent, #1a73e8);
}

.tweaks-panel .tweaks-seg-btn.active {
  background: var(--accent-soft, #e8f0fe);
  border-color: var(--accent, #1a73e8);
  color: var(--accent, #1a73e8);
}

.tweaks-panel .tweaks-seg-btn:focus-visible {
  outline: 2px solid var(--accent, #1a73e8);
  outline-offset: 2px;
}

.tweaks-panel .tweaks-seg-btn[disabled],
.tweaks-panel .tweaks-accent-swatch[disabled],
.tweaks-panel .tweaks-dim-range[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}

.tweaks-panel .tweaks-accent-swatch {
  inline-size: 24px;
  block-size: 24px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--accent, #1a73e8);
  padding: 0;
}

.tweaks-panel .tweaks-dim-range {
  inline-size: 100%;
}

.tweaks-trap-sentinel {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* ===== Forced colors ===== */
@media (forced-colors: active) {
  .modal { background: Canvas; color: CanvasText; border-color: CanvasText; }
  .close-btn { color: ButtonText; background: ButtonFace; }
  .close-btn:focus-visible { outline-color: Highlight; }
  .word-region .focus { color: Highlight; }
  .play-pause-btn { background: ButtonFace; color: ButtonText; border: 1px solid ButtonText; }
  .play-pause-btn:focus-visible { outline-color: Highlight; }
  .scope-header { color: CanvasText; }
  .scope-subtitle { color: CanvasText; }
  .scope-swap-btn,
  .font-dec-btn,
  .font-inc-btn,
  .prev-sentence-btn,
  .next-sentence-btn {
    color: ButtonText;
    background: ButtonFace;
    border: 1px solid ButtonText;
  }
  .scope-swap-btn:focus-visible,
  .font-dec-btn:focus-visible,
  .font-inc-btn:focus-visible,
  .prev-sentence-btn:focus-visible,
  .next-sentence-btn:focus-visible { outline-color: Highlight; }
  .wpm-slider:focus-visible,
  .scrubber-slider:focus-visible { outline-color: Highlight; }
  .wpm-readout { color: CanvasText; border-color: CanvasText; background: Canvas; }
  .scrubber-labels { color: CanvasText; }
  .context-preview { color: CanvasText; }
  .context-current { color: Highlight; background: Canvas; }
  .resume-toast { background: Canvas; color: CanvasText; border: 1px solid CanvasText; }
  .resume-toast-start-over { color: LinkText; }
  .resume-toast-start-over:focus-visible { outline-color: Highlight; }

  /* Step 2 modal-header + Step 3 tweaks-panel surfaces under
   * forced-colors. Without these overrides the new classes resolve to
   * the theme's hardcoded hex values and defeat the user's OS
   * high-contrast preference (a11y-extension-designer finding #3). */
  .modal-header { background: Canvas; border-color: CanvasText; }
  .modal-title { color: CanvasText; }
  .modal-source { color: CanvasText; }
  .mini-logo { background: ButtonFace; color: ButtonText; border: 1px solid ButtonText; }
  .bookmark-btn,
  .settings-btn { color: ButtonText; background: ButtonFace; }
  .bookmark-btn:focus-visible,
  .settings-btn:focus-visible { outline-color: Highlight; }

  .tweaks-panel { background: Canvas; color: CanvasText; border: 1px solid CanvasText; }
  .tweaks-panel .tweaks-heading,
  .tweaks-panel .tweaks-section-label { color: CanvasText; }
  .tweaks-panel .tweaks-seg-btn {
    background: ButtonFace;
    color: ButtonText;
    border-color: ButtonText;
  }
  .tweaks-panel .tweaks-seg-btn.active {
    background: Highlight;
    color: HighlightText;
  }
  .tweaks-panel .tweaks-seg-btn:focus-visible { outline-color: Highlight; }
  .tweaks-accent-swatch { background: ButtonFace; border: 1px solid ButtonText; }
  .tweaks-dim-range:focus-visible { outline-color: Highlight; }
}

/* ===== Reduced motion ===== */
@media (prefers-reduced-motion: reduce) {
  .backdrop, .modal { transition: none !important; animation: none !important; }
  .scrubber-area { transition: none !important; }
}

/* ===== Touch-primary (#36) ===== */
@media (pointer: coarse) and (hover: none) {
  .backdrop {
    padding: 0;
    place-items: stretch;
  }
  .modal {
    border-radius: 0;
    min-block-size: 100%;
    inline-size: 100%;
    max-inline-size: 100%;
    display: flex;
    flex-direction: column;
  }
  .close-btn {
    width: 48px;
    height: 48px;
    min-width: 48px;
    min-height: 48px;
  }
  .word-region {
    flex: 1 1 auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    cursor: pointer;
  }
  .footer {
    padding-block-end: max(16px, env(safe-area-inset-bottom));
    padding-inline: 16px;
    flex-wrap: wrap;
    row-gap: 10px;
  }
  .play-pause-btn {
    width: 56px;
    height: 56px;
    min-width: 56px;
    min-height: 56px;
    font-size: 20px;
  }
  .scope-swap-btn,
  .font-dec-btn,
  .font-inc-btn,
  .prev-sentence-btn,
  .next-sentence-btn {
    min-width: 48px;
    min-height: 48px;
    width: 48px;
    height: 48px;
  }
  .scope-swap-btn {
    width: auto;
    padding: 0 16px;
  }
  .wpm-slider {
    min-height: 48px;
    inline-size: clamp(140px, 26cqi, 280px);
  }
  .scrubber-slider {
    block-size: 32px;
  }
}
`;
