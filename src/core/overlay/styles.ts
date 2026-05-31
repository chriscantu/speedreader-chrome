/**
 * Overlay stylesheet, served via adoptedStyleSheets on the open shadow
 * root. Container query primer lives in the #35 spec; this MVP floor
 * uses fluid clamp() that satisfies WCAG 1.4.10 / 1.4.4 at 320px and
 * 200% zoom without dedicated tier blocks. Tiers land in a follow-up.
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
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.78);
  display: grid;
  place-items: center;
  padding: 24px;
}

.modal {
  background: var(--surface, #ffffff);
  color: var(--text, #111111);
  border-radius: 12px;
  padding: clamp(24px, 6cqi, 64px);
  max-inline-size: min(72ch, 1100px);
  inline-size: 100%;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  position: relative;
  container-type: inline-size;
  container-name: rsvp;
}

/* Font picker (#28) — Safari-parity 5-font set. Family stacks mirror
 * SpeedReader/SpeedReaderExtension/Resources/rsvp/overlay.css. Scoped to
 * the reading surface only (word + context-preview); UI chrome stays in
 * the system font so button labels read consistently across picker
 * selections. The 'system' ID applies no class — the default .modal
 * family stack at :host above is already system-ui. */
.modal.opendyslexic .word-region,
.modal.opendyslexic .context-current,
.modal.opendyslexic .context-preview {
  /* Fallback chain ordered for dyslexia readability — generic system-ui
   * only as last resort. Atkinson Hyperlegible (Braille Institute,
   * downloadable / ships on some platforms), Comic Sans MS (research-
   * cited dyslexia-friendly letter disambiguation; preinstalled on
   * Windows + macOS), and Trebuchet MS (also research-cited; preinstalled
   * cross-platform) keep the user on a dyslexia-friendly face when the
   * bundled OpenDyslexic WOFF2 fails to load. See #190. */
  font-family:
    'OpenDyslexic', 'Atkinson Hyperlegible', 'Comic Sans MS',
    'Trebuchet MS', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

.modal.newYork .word-region,
.modal.newYork .context-current,
.modal.newYork .context-preview {
  /* macOS/iOS ship 'New York' (Apple system serif); Chromium on other
   * platforms falls back to Iowan Old Style → Georgia → generic serif so
   * the user still sees a comfortable serif face. */
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
  /* Apple-bundled monospace; the fallback chain covers Windows
   * ('Courier New') and Linux (generic monospace). */
  font-family: Menlo, 'Courier New', monospace;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 44px;
  height: 44px;
  border: 2px solid var(--text, #111111);
  border-radius: 8px;
  background: transparent;
  color: var(--text, #111111);
  font: 700 20px / 1 system-ui, sans-serif;
  cursor: pointer;
}

.close-btn:hover {
  background: var(--accent-soft, rgba(37, 99, 235, 0.12));
  color: var(--text, #111111);
}

.close-btn:focus-visible {
  outline: 3px solid var(--accent, #2563eb);
  outline-offset: 2px;
}

.footer {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  padding-block-start: clamp(16px, 4cqi, 32px);
}

.play-pause-btn {
  min-width: 96px;
  min-height: 44px;
  padding: 8px 20px;
  border: 2px solid var(--text, #111111);
  border-radius: 8px;
  background: var(--accent, #2563eb);
  color: var(--bg, #ffffff);
  font: 700 16px / 1 system-ui, sans-serif;
  cursor: pointer;
}

.play-pause-btn:hover {
  background: var(--accent-soft, rgba(37, 99, 235, 0.12));
  color: var(--text, #111111);
}

.play-pause-btn:focus-visible {
  outline: 3px solid var(--text, #111111);
  outline-offset: 2px;
}

.play-pause-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.scope-header {
  margin: 0;
  padding-inline-end: 56px; /* leave room for top-right close button */
  font-size: clamp(0.95rem, 1.6cqi + 0.5rem, 1.25rem);
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.02em;
}

.scope-subtitle {
  margin: 6px 0 0;
  font-size: clamp(0.8rem, 1.2cqi + 0.4rem, 1rem);
  font-style: italic;
  color: var(--text, #111111);
  opacity: 0.85;
}

.scope-swap-btn {
  min-height: 44px;
  padding: 8px 16px;
  border: 2px solid var(--text, #111111);
  border-radius: 8px;
  background: transparent;
  color: var(--text, #111111);
  font: 600 14px / 1 system-ui, sans-serif;
  cursor: pointer;
}

.scope-swap-btn:hover {
  background: var(--accent-soft, rgba(37, 99, 235, 0.12));
  color: var(--text, #111111);
}

.scope-swap-btn:focus-visible {
  outline: 3px solid var(--accent, #2563eb);
  outline-offset: 2px;
}

/* Font-size stepper buttons (#29). Visual treatment mirrors
 * .scope-swap-btn (outline style, accent on hover) and tap-target
 * dimensions mirror .close-btn so the WCAG 2.5.5 minimum holds across
 * the control bar. */
.font-dec-btn,
.font-inc-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 8px 12px;
  border: 2px solid var(--text, #111111);
  border-radius: 8px;
  background: transparent;
  color: var(--text, #111111);
  font: 700 16px / 1 system-ui, sans-serif;
  cursor: pointer;
}

.font-dec-btn:hover,
.font-inc-btn:hover {
  background: var(--accent-soft, rgba(37, 99, 235, 0.12));
  color: var(--text, #111111);
}

.font-dec-btn:focus-visible,
.font-inc-btn:focus-visible {
  outline: 3px solid var(--accent, #2563eb);
  outline-offset: 2px;
}

.font-dec-btn:disabled,
.font-inc-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Prev / next sentence buttons (#23). Same outline / accent treatment as
 * the font stepper; ≥44×44 px so WCAG 2.5.5 holds across the control bar. */
.prev-sentence-btn,
.next-sentence-btn {
  min-width: 44px;
  min-height: 44px;
  padding: 8px 12px;
  border: 2px solid var(--text, #111111);
  border-radius: 8px;
  background: transparent;
  color: var(--text, #111111);
  font: 700 18px / 1 system-ui, sans-serif;
  cursor: pointer;
}

.prev-sentence-btn:hover,
.next-sentence-btn:hover {
  background: var(--accent-soft, rgba(37, 99, 235, 0.12));
  color: var(--text, #111111);
}

.prev-sentence-btn:focus-visible,
.next-sentence-btn:focus-visible {
  outline: 3px solid var(--accent, #2563eb);
  outline-offset: 2px;
}

/* WPM slider (#24). The native <input type="range"> default thumb is well
 * below the WCAG 2.5.5 target-size minimum (24px on Chromium, ~18px on
 * WebKit). The base styles below give the slider element a 44px hitbox
 * (touch-primary block bumps to 48px). Track + thumb keep system defaults
 * inside that hitbox so we don't fight the cross-browser thumb shape. */
.wpm-slider {
  min-height: 44px;
  /* The default range thumb is small; the larger inline-size gives the
   * user enough travel for a 100→600 step=10 sweep. */
  inline-size: clamp(120px, 22cqi, 240px);
  accent-color: var(--accent, #2563eb);
  cursor: pointer;
}

.wpm-slider:focus-visible {
  outline: 3px solid var(--accent, #2563eb);
  outline-offset: 4px;
}

.wpm-readout {
  /* tabular-nums prevents the readout width from jittering as the digit
   * count changes during a drag (100 → 99 → 100 etc.). */
  font: 600 14px / 1 system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  color: var(--text, #111111);
  min-inline-size: 6ch;
  text-align: start;
}

.word-region {
  text-align: center;
  /*
   * When the in-modal A−/A+ stepper (#29) sets --rsvp-font-size as an
   * inline custom property, this font-size resolves to the user-chosen
   * value (clamped to FONT_SIZE_MIN..MAX in JS). When the custom
   * property is absent (e.g. caller hasn't wired the stepper yet) the
   * fluid clamp() fallback satisfies WCAG 1.4.10 / 1.4.4 at 320px and
   * 200% zoom per the responsive-overlay spec.
   */
  font-size: var(--rsvp-font-size, clamp(2rem, 5.5cqi + 1rem, 5.5rem));
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  padding-block: clamp(32px, 8cqi, 96px);
}

.word-region .focus {
  color: var(--accent, #2563eb);
}

.aria-live {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.context-preview {
  margin-block-start: clamp(12px, 3cqi, 24px);
  font-size: clamp(0.85rem, 1.2cqi + 0.4rem, 1.05rem);
  line-height: 1.5;
  color: var(--text, #111111);
  opacity: 0.85;
  max-inline-size: 60ch;
  margin-inline: auto;
  text-align: center;
}

.context-preview[hidden] { display: none; }

.context-current {
  font-weight: 700;
  /* Subtle accent so the eye lands on the current word in the sentence. */
  color: var(--accent, #2563eb);
}

.trap-sentinel {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

/* Reading-position resume toast (#48). Non-blocking polite status
 * region pinned to the top of the modal. role="status" carries the
 * polite announcement; the visual style is a subdued chip so the eye
 * lands on the word region, not the toast. */
.resume-toast {
  margin-block-end: clamp(8px, 2cqi, 16px);
  padding: clamp(8px, 1.5cqi + 4px, 14px) clamp(12px, 2cqi + 6px, 20px);
  border-radius: 8px;
  background: var(--surface-alt, rgba(0, 0, 0, 0.06));
  color: var(--text, #111111);
  font-size: clamp(0.85rem, 1cqi + 0.4rem, 1rem);
  display: flex;
  flex-wrap: wrap;
  gap: clamp(8px, 1.5cqi, 16px);
  align-items: center;
  justify-content: center;
}

.resume-toast-start-over {
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--accent, #2563eb);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}

.resume-toast-start-over:focus-visible {
  outline: 2px solid var(--accent, #2563eb);
  outline-offset: 2px;
}

@media (forced-colors: active) {
  .modal { background: Canvas; color: CanvasText; }
  .close-btn { border-color: ButtonText; color: ButtonText; }
  .close-btn:focus-visible { outline-color: Highlight; }
  .word-region .focus { color: Highlight; }
  .play-pause-btn {
    background: ButtonFace;
    color: ButtonText;
    border-color: ButtonText;
  }
  .play-pause-btn:focus-visible { outline-color: Highlight; }
  .scope-header { color: CanvasText; }
  .scope-subtitle { color: CanvasText; opacity: 1; }
  .scope-swap-btn {
    background: ButtonFace;
    color: ButtonText;
    border-color: ButtonText;
  }
  .scope-swap-btn:focus-visible { outline-color: Highlight; }
  .font-dec-btn,
  .font-inc-btn {
    background: ButtonFace;
    color: ButtonText;
    border-color: ButtonText;
  }
  .font-dec-btn:focus-visible,
  .font-inc-btn:focus-visible { outline-color: Highlight; }
  .prev-sentence-btn,
  .next-sentence-btn {
    background: ButtonFace;
    color: ButtonText;
    border-color: ButtonText;
  }
  .prev-sentence-btn:focus-visible,
  .next-sentence-btn:focus-visible { outline-color: Highlight; }
  .wpm-slider:focus-visible { outline-color: Highlight; }
  .wpm-readout { color: CanvasText; }
  .context-preview { color: CanvasText; opacity: 1; }
  .context-current { color: Highlight; }
  .resume-toast { background: Canvas; color: CanvasText; border: 1px solid CanvasText; }
  .resume-toast-start-over { color: LinkText; }
  .resume-toast-start-over:focus-visible { outline-color: Highlight; }
}

@media (prefers-reduced-motion: reduce) {
  .backdrop, .modal { transition: none !important; animation: none !important; }
}

/*
 * Touch-primary viewports (#36). The combined query targets devices whose
 * primary input is touch (phones, most tablets) without catching hybrid
 * laptops that report \`pointer: coarse\` on their touchscreen alongside
 * a precise mouse — \`hover: none\` further narrows to "no precise hover
 * available," which is the WCAG-aligned touch-primary signal.
 *
 * - Tap targets bumped to 48 CSS px (WCAG 2.2 AA target-size minimum is
 *   44; the extra 4 px is thumb-comfort headroom and gives a single
 *   knob to tune without re-auditing the minimum).
 * - Footer bottom-anchored within the modal and padded by
 *   \`env(safe-area-inset-bottom)\` so the control bar stays
 *   thumb-reachable on devices with a home indicator.
 * - Backdrop padding shrinks to give the modal more inline space at
 *   handset widths; the modal itself fills the viewport vertically so
 *   the footer can dock at the bottom.
 */
@media (pointer: coarse) and (hover: none) {
  .backdrop {
    padding: 0;
    place-items: stretch;
  }
  .modal {
    border-radius: 0;
    min-block-size: 100%;
    display: flex;
    flex-direction: column;
  }
  .close-btn {
    width: 48px;
    height: 48px;
  }
  .word-region {
    flex: 1 1 auto;
    display: grid;
    place-items: center;
    /* Tap target hint for assistive tech / a11y devtools — the click
     * handler is wired in JS. */
    cursor: pointer;
  }
  .footer {
    padding-block-end: max(16px, env(safe-area-inset-bottom));
    padding-inline: 16px;
  }
  .play-pause-btn {
    min-width: 128px;
    min-height: 48px;
    padding: 12px 24px;
  }
  .scope-swap-btn {
    min-height: 48px;
    padding: 12px 20px;
  }
  .font-dec-btn,
  .font-inc-btn {
    min-width: 48px;
    min-height: 48px;
    padding: 12px 16px;
  }
  .prev-sentence-btn,
  .next-sentence-btn {
    min-width: 48px;
    min-height: 48px;
    padding: 12px 16px;
  }
  .wpm-slider {
    min-height: 48px;
    inline-size: clamp(160px, 30cqi, 320px);
  }
  .footer {
    /* On handsets the control bar can wrap onto two lines without losing
     * the bottom safe-area inset. Centered alignment keeps the layout
     * symmetric whether or not the slider wraps. */
    flex-wrap: wrap;
    row-gap: 12px;
  }
}
`;
