import type { RsvpEngine, RsvpEngineOptions } from '../rsvp-engine';
import type { ThemeId } from '../theme';
import type { FontId } from './font-ids';

/**
 * Settings slice the overlay binds to. The wider SettingsV6 is not imported
 * here so `core/overlay` stays portable (no transitive dependency on the
 * Chrome storage shape).
 *
 * `theme` extends `ThemeId` with `'system'` — the concrete-theme enum
 * covers the six design-pack values; `'system'` resolves at mount time via
 * `prefers-color-scheme` matching `SettingsV6.theme` (which includes
 * `'system'` as the auto-detect sentinel). Keeping the sentinel here avoids
 * callers having to pre-resolve before constructing the overlay.
 */
export interface OverlaySettings {
  theme: ThemeId | 'system';
  wpm: number;
  /**
   * Word-region font size in CSS px. Applied to the word region via the
   * `--rsvp-font-size` custom property; the in-modal A−/A+ stepper (#29)
   * adjusts this value and the chrome glue persists it to
   * `chrome.storage.sync`. Bounds enforced via FONT_SIZE_MIN/MAX in
   * `core/settings/bounds.ts`.
   */
  fontSize: number;
  /**
   * OpenDyslexic font toggle (#27). When true, the modal switches to the
   * bundled OpenDyslexic typeface; when false (or absent), the modal
   * falls back to system-ui. Optional so existing callers and tests that
   * pre-date this field continue to type-check — overlay treats `undefined`
   * as `false`. The font binary is loaded via `@font-face` injected at
   * mount time, parameterised by `OverlayOptions.openDyslexicFontUrl`
   * (since `core/` cannot call `chrome.runtime.getURL`).
   *
   * #28: superseded by `font: 'opendyslexic'`. The field is retained for
   * back-compat with persisted V4 payloads that still carry the boolean;
   * `resolveFontId()` in `font-ids.ts` promotes `openDyslexic: true` to
   * the `'opendyslexic'` picker ID when `font` is absent or unknown.
   */
  openDyslexic?: boolean;
  /**
   * Font picker (#28) — one of the 5 Safari-parity IDs from
   * `core/overlay/font-ids.ts`. When omitted, the overlay falls back to
   * `'system'` (no font class applied; the modal uses the default
   * system-ui stack). When set to `'opendyslexic'`, the bundled woff2
   * loads via the @font-face rule injected with
   * `OverlayOptions.openDyslexicFontUrl` — system fonts (`georgia`,
   * `menlo`, `newYork`) need no bundled binary and resolve via the
   * family stacks in `styles.ts`.
   */
  font?: FontId;
  /**
   * Multi-word chunk display (#51). Pinned at overlay-construction
   * time and forwarded to the engine factory. `1` (or undefined) keeps
   * today's single-word emission; `2` or `3` enables multi-word chunk
   * mode (engine emits `chunk` events with sentence-boundary respect).
   * Live updates via `subscribeSettings` are NOT supported in M2 —
   * changing chunkSize mid-session would require an engine
   * reconstruction (deferred to a follow-up).
   */
  chunkSize?: 1 | 2 | 3;
}

export type SettingsSubscriber = (s: OverlaySettings) => void;
export type SettingsSubscribe = (listener: SettingsSubscriber) => () => void;

export type EngineFactory = (opts: RsvpEngineOptions) => RsvpEngine;

/**
 * Activation scope. Drives header rendering and the `← Full article`
 * scope-swap affordance.
 *
 * - `'selection'` — user invoked the reader on a highlighted text range.
 *   Overlay renders the scoped header (`SELECTION · N words · ~M sec`)
 *   and the `← Full article` swap button.
 * - `'full'` — user invoked on the full article (popup, hotkey, or
 *   context-menu without an active selection). Standard full-article
 *   overlay; no swap button.
 *
 * See `docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 * §"Scoped Mini-Modal Contract" for the contract.
 */
export type OverlayScope = 'selection' | 'full';

export interface OverlayOptions {
  doc: Document;
  /**
   * Legacy single word stream. Still required by callers that pre-date the
   * scope-aware fields below; transition path: callers will move to
   * `scope` + `fullWords` (+ `selectionWords` for `'selection'`) in a
   * follow-up commit. Overlay implementation reads this field today and
   * begins reading the scope-aware fields in the scoped-modal task.
   */
  words: string[];
  /**
   * Activation scope. When omitted, the overlay falls back to single-list
   * (`words`) behaviour. Required for the scoped mini-modal contract.
   */
  scope?: OverlayScope;
  /**
   * Tokenized selection text. Used by the scoped header word count and as
   * the initial engine word stream when `scope === 'selection'`. Empty
   * array triggers the empty-selection fallback (AC #15).
   */
  selectionWords?: string[];
  /**
   * Tokenized full article. Pre-tokenized at CS-side mount time so the
   * `← Full article` swap is a synchronous local transition with no
   * SW round-trip (spec §"Why no SW round-trip"). Required when `scope`
   * is provided.
   */
  fullWords?: string[];
  /**
   * Article title used as the full-article header text. Falls back to
   * `Whole page — N words` when undefined.
   */
  articleTitle?: string;
  /**
   * Resume the engine at this word index on mount. Used by the content
   * script to restore the session reading position after the user closed
   * and reopened the overlay on the same document (#25). Clamped to
   * `[0, activeWords.length - 1]`; out-of-range, non-finite, or
   * non-integer values are ignored. `0` is treated as no-op (no seek
   * needed when starting from the beginning).
   *
   * In-memory only — persistence across page reloads is deferred to #48.
   */
  initialIndex?: number;
  initialSettings: OverlaySettings;
  subscribeSettings: SettingsSubscribe;
  engineFactory: EngineFactory;
  /**
   * Called after teardown so the host (CS) can drop its handle.
   *
   * When the overlay had an active engine at close time, `snapshot`
   * captures the engine's progress and the currently-active scope so the
   * host can restore the position on a later remount. `snapshot` is
   * `undefined` when mount aborted (engine never created) or the stream
   * was empty (`total === 0`). Existing callers that ignore the argument
   * remain source-compatible.
   */
  onClose?: (snapshot?: OverlayCloseSnapshot) => void;
  /**
   * Called when the user presses the in-modal A−/A+ stepper (#29). The
   * overlay clamps the new value to [FONT_SIZE_MIN, FONT_SIZE_MAX] before
   * invoking; consumers are expected to persist the value (the chrome
   * glue routes this to `chrome.storage.sync.saveSettings({ fontSize })`).
   * Omitting the callback disables persistence — the overlay still
   * updates its local font size for the session.
   */
  onFontSizeChange?: (next: number) => void;
  /**
   * Called when the user adjusts the WPM via slider commit (change event)
   * or the ArrowUp/ArrowDown keyboard shortcut (#24). The overlay clamps
   * the new value to [WPM_MIN, WPM_MAX] before invoking; consumers are
   * expected to persist the value (the chrome glue routes this to
   * `chrome.storage.sync.saveSettings({ wpm })`). Omitting the callback
   * disables persistence — the overlay still updates its engine cadence
   * for the session. Note: only the slider `change` event invokes this;
   * the keyboard arrow shortcut updates the engine without persisting
   * (slider is the canonical persistence surface).
   */
  onWpmChange?: (next: number) => void;
  /**
   * Resume toast (#48). When provided AND the mount actually resumes
   * (i.e. `initialIndex` is a positive in-range integer), the overlay
   * renders a non-blocking `role="status"` toast inside the shadow root
   * with text "Resumed at word N of M" and a "Start over" link. The
   * toast auto-dismisses after 5 s; clicking "Start over" rewinds the
   * engine to word 0 and invokes `onStartOver` so the host can clear
   * the persisted entry.
   *
   * Omitted when no resume is in flight — the toast must never render
   * on a fresh first-time mount.
   */
  resumeToast?: {
    /** Total words in the active stream (denominator of the toast). */
    totalWords: number;
    /**
     * Called when the user clicks "Start over". The overlay has
     * already rewound the engine; the callback exists so the host can
     * delete the persisted position for the canonical URL.
     */
    onStartOver?: () => void;
  };
  /**
   * Called on every `word` event with the post-emit progress index
   * (1-based count of words consumed) and the active stream's total
   * (#48). The host debounces and persists this value to
   * `chrome.storage.local` so a later visit can resume. Optional —
   * omitting it disables persistence; the overlay still operates
   * normally.
   *
   * Invoked only on full-scope mounts; selection-scope mounts do not
   * persist position because selection text does not survive
   * navigation. The host wires `onWordAdvance` only when
   * `scope === 'full'` — passing it for a selection-scope mount has
   * no defined meaning and may be removed by a future contract
   * cleanup.
   */
  onWordAdvance?: (index: number, total: number) => void;
  /**
   * Absolute URL of the bundled OpenDyslexic woff2 (#27, #10). The chrome
   * glue resolves this via `chrome.runtime.getURL('fonts/...')` and passes
   * it in; `core/` cannot call `chrome.*`. When the URL is provided, the
   * overlay injects an `@font-face` rule into the shadow root at mount
   * (scoped to the shadow — does NOT leak to host-page CSS). When omitted,
   * the OpenDyslexic toggle has no effect (the family name falls through
   * to the system fallback stack). Callers that toggle `openDyslexic`
   * without providing this URL still type-check; the modal class is
   * applied but no custom font loads.
   */
  openDyslexicFontUrl?: string;
}

/**
 * Snapshot of the engine state at overlay close time. Captured before
 * `engine.stop()` in `unmount()` so the host (content script) can resume
 * the reading position on a subsequent mount in the same document.
 *
 * - `index` matches `engine.progress().index` — the count of words
 *   emitted so far on the active stream.
 * - `total` is the active stream's word count at close time. Used by
 *   the host as a safety check before resuming: if the stream length
 *   changed between mounts (dynamic page content), the host should skip
 *   the resume rather than seek into a stale offset.
 * - `scope` is whichever stream was driving the engine at close —
 *   selection or full. Lets the host key session positions per-scope so
 *   that closing in selection mode and reopening in full mode does NOT
 *   restore the selection's index against the full stream.
 */
export interface OverlayCloseSnapshot {
  readonly index: number;
  readonly total: number;
  readonly scope: OverlayScope;
}

export type OverlayStatus = 'mounted' | 'unmounted';

export interface OverlayHandle {
  readonly status: OverlayStatus;
  /** Idempotent — second call while mounted is a no-op. */
  mount(): void;
  /** LIFO teardown. Calling while unmounted is a no-op. */
  unmount(): void;
}
