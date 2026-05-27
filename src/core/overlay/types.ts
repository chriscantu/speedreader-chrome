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

export interface OverlayOptions {
  doc: Document;
  words: string[];
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
