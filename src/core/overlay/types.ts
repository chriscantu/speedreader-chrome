import type { RsvpEngine, RsvpEngineOptions } from '../rsvp-engine';
import type { ThemeId } from '../theme';

/**
 * Settings slice the overlay binds to. The wider SettingsV4 is not imported
 * here so `core/overlay` stays portable (no transitive dependency on the
 * Chrome storage shape).
 *
 * `theme` extends `ThemeId` with `'system'` — the concrete-theme enum
 * covers the six design-pack values; `'system'` resolves at mount time via
 * `prefers-color-scheme` matching `SettingsV4.theme` (which includes
 * `'system'` as the auto-detect sentinel). Keeping the sentinel here avoids
 * callers having to pre-resolve before constructing the overlay.
 */
export interface OverlaySettings {
  theme: ThemeId | 'system';
  wpm: number;
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
  initialSettings: OverlaySettings;
  subscribeSettings: SettingsSubscribe;
  engineFactory: EngineFactory;
  /** Called after teardown so the host (CS) can drop its handle. */
  onClose?: () => void;
}

export type OverlayStatus = 'mounted' | 'unmounted';

export interface OverlayHandle {
  readonly status: OverlayStatus;
  /** Idempotent — second call while mounted is a no-op. */
  mount(): void;
  /** LIFO teardown. Calling while unmounted is a no-op. */
  unmount(): void;
}
