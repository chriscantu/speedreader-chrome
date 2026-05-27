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
  background: var(--bg, #ffffff);
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

.close-btn:focus-visible {
  outline: 3px solid var(--accent, #2563eb);
  outline-offset: 2px;
}

.word-region {
  text-align: center;
  font-size: clamp(2rem, 5.5cqi + 1rem, 5.5rem);
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

.trap-sentinel {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

@media (forced-colors: active) {
  .modal { background: Canvas; color: CanvasText; }
  .close-btn { border-color: ButtonText; color: ButtonText; }
  .close-btn:focus-visible { outline-color: Highlight; }
  .word-region .focus { color: Highlight; }
}

@media (prefers-reduced-motion: reduce) {
  .backdrop, .modal { transition: none !important; animation: none !important; }
}
`;
