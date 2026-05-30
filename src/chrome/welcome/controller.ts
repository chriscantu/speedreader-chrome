/**
 * Welcome page controller.
 *
 * Owns the view state machine (welcome ↔ calibrate), the RSVP engine wiring
 * for the Calibrate preview, and the settings round-trip on Save & finish.
 *
 * Pure DOM + injected SettingsApi — unit-tested via jsdom in
 * `__tests__/controller.test.ts`. The thin `index.ts` bind is the only
 * file that imports `chrome.*` (via `../settings/storage`).
 *
 * See docs/superpowers/specs/2026-05-30-onboarding-surface.md.
 */

import type { SettingsV4 } from '../../core/settings/schema';
import { DEFAULT_SETTINGS } from '../../core/settings/defaults';
import { createRsvpEngine, type RsvpEngine } from '../../core/rsvp-engine';
import { SAMPLE_PASSAGE } from './sample';

export interface SettingsApi {
  load(): Promise<SettingsV4>;
  save(partial: Partial<Omit<SettingsV4, 'version' | 'lastUsedWpm'>>): Promise<void>;
  flush(): Promise<void>;
}

/**
 * IDs the welcome.html document is required to expose. Centralised so the
 * binder, the HTML, and the tests cannot drift.
 */
export const WELCOME_IDS = {
  dismiss: 'dismiss',
  welcomeView: 'welcome-view',
  calibrateView: 'calibrate-view',
  getStarted: 'get-started',
  wordDisplay: 'word-display',
  startPreview: 'start-preview',
  pauseToggle: 'pause-toggle',
  replay: 'replay',
  wpmSlider: 'wpm-slider',
  wpmLabel: 'wpm-label',
  saveFinish: 'save-finish',
} as const;

/**
 * Preview cadence ceiling. The user can save (and the engine will record)
 * any in-bounds slider value, but the live preview itself caps at this rate
 * to stay under the WCAG 2.3.1 (Three Flashes) area+rate threshold for
 * single-glyph swaps. See spec §"Preview WPM clamp" + OQ-4.
 */
const PREVIEW_WPM_CLAMP = 500;

/** Two passes, then auto-pause + Replay (WCAG 2.2.2). */
const LOOP_LIMIT = 2;

function tokenize(passage: string): string[] {
  return passage.split(/\s+/).filter((w) => w.length > 0);
}

function previewWpm(value: number): number {
  return Math.min(value, PREVIEW_WPM_CLAMP);
}

function labelText(sliderValue: number): string {
  if (sliderValue > PREVIEW_WPM_CLAMP) {
    return `${sliderValue} wpm — preview capped at ${PREVIEW_WPM_CLAMP} wpm for first-time view`;
  }
  return `${sliderValue} wpm`;
}

function getEl<T extends HTMLElement>(doc: Document, id: string): T | null {
  return doc.getElementById(id) as T | null;
}

/**
 * Bind the welcome surface. Returns a teardown function used by tests.
 */
export async function bindWelcome(
  doc: Document,
  win: Window,
  api: SettingsApi,
): Promise<() => void> {
  const welcomeView = getEl<HTMLElement>(doc, WELCOME_IDS.welcomeView);
  const calibrateView = getEl<HTMLElement>(doc, WELCOME_IDS.calibrateView);
  const dismissBtn = getEl<HTMLButtonElement>(doc, WELCOME_IDS.dismiss);
  const getStartedBtn = getEl<HTMLButtonElement>(doc, WELCOME_IDS.getStarted);
  const wordDisplay = getEl<HTMLElement>(doc, WELCOME_IDS.wordDisplay);
  const startPreviewBtn = getEl<HTMLButtonElement>(doc, WELCOME_IDS.startPreview);
  const pauseToggleBtn = getEl<HTMLButtonElement>(doc, WELCOME_IDS.pauseToggle);
  const replayBtn = getEl<HTMLButtonElement>(doc, WELCOME_IDS.replay);
  const slider = getEl<HTMLInputElement>(doc, WELCOME_IDS.wpmSlider);
  const label = getEl<HTMLElement>(doc, WELCOME_IDS.wpmLabel);
  const saveFinishBtn = getEl<HTMLButtonElement>(doc, WELCOME_IDS.saveFinish);

  // Validate required elements; the welcome page is small enough that a
  // missing slot is a hard error — log and bail rather than ship a broken
  // partial UI. Matches options-page console-error pattern.
  const required: Array<[string, unknown]> = [
    ['welcomeView', welcomeView],
    ['calibrateView', calibrateView],
    ['dismissBtn', dismissBtn],
    ['getStartedBtn', getStartedBtn],
    ['wordDisplay', wordDisplay],
    ['startPreviewBtn', startPreviewBtn],
    ['slider', slider],
    ['label', label],
    ['saveFinishBtn', saveFinishBtn],
  ];
  const missing = required.filter(([, el]) => el === null).map(([k]) => k);
  if (missing.length > 0) {
    console.error('[speedreader] welcome: HTML missing required elements:', missing);
    return () => undefined;
  }

  // Non-null assertions below are safe due to the guard above.
  const $welcomeView = welcomeView as HTMLElement;
  const $calibrateView = calibrateView as HTMLElement;
  const $dismissBtn = dismissBtn as HTMLButtonElement;
  const $getStartedBtn = getStartedBtn as HTMLButtonElement;
  const $wordDisplay = wordDisplay as HTMLElement;
  const $startPreviewBtn = startPreviewBtn as HTMLButtonElement;
  const $slider = slider as HTMLInputElement;
  const $label = label as HTMLElement;
  const $saveFinishBtn = saveFinishBtn as HTMLButtonElement;

  // Initialize slider + label to V4 default; the in-flight `loadSettings`
  // call below may reseat once it resolves. Spec §"Settings Round-Trip"
  // forbids blocking the render on load.
  const setSliderValue = (value: number): void => {
    $slider.value = String(value);
    $label.textContent = labelText(value);
  };
  setSliderValue(DEFAULT_SETTINGS.wpm);

  // Lazy engine state — instantiated on first transition to calibrate.
  let engine: RsvpEngine | null = null;
  const words = tokenize(SAMPLE_PASSAGE);
  let doneCount = 0;

  const showReplay = (visible: boolean): void => {
    if (replayBtn) replayBtn.hidden = !visible;
  };
  const showStartPreview = (visible: boolean): void => {
    $startPreviewBtn.hidden = !visible;
  };
  const showPauseToggle = (visible: boolean): void => {
    if (pauseToggleBtn) pauseToggleBtn.hidden = !visible;
  };

  // Captured from engine.subscribe() so teardown can release the listener;
  // production discards teardown but tests use it for clean isolation.
  let engineUnsubscribe: (() => void) | null = null;

  const mountEngine = (): void => {
    if (engine !== null) return;
    const initialWpm = Number($slider.value);
    engine = createRsvpEngine({
      words,
      wpm: previewWpm(initialWpm),
    });
    engineUnsubscribe = engine.subscribe((event) => {
      if (event.type === 'word') {
        $wordDisplay.textContent = event.word;
      } else if (event.type === 'done') {
        doneCount += 1;
        if (doneCount < LOOP_LIMIT) {
          // Loop the sample (spec §"Loop policy — capped at 2 passes").
          // The engine's start() is guarded by `state === IDLE`, so we
          // can't literally "re-call start()" as the spec phrases it —
          // the engine sits in DONE after emitting 'done'. setWords()
          // resets nextIndex + transitions back to IDLE, and the
          // subsequent start() then ticks from the top. Functionally
          // the spec's contract; mechanically a deviation worth naming.
          engine?.setWords(words);
          engine?.start();
        } else {
          // Cap reached — leave engine in DONE, surface Replay, and
          // disable the slider. Per ring decision-challenger #2: in
          // DONE the engine's setWpm() stores the new wpm but cannot
          // reschedule a non-existent tick, so a drag here is a
          // dead control until Replay. Disabling is the WCAG-clean
          // signal that the slider is out of effect right now.
          showReplay(true);
          showStartPreview(false);
          showPauseToggle(false);
          $slider.disabled = true;
        }
      }
    });
    // Render first word statically — engine boots IDLE per spec §"Boot
    // state — PAUSED for everyone" (WCAG 2.2.2). Static render satisfies
    // "first word of the sample statically".
    if (words.length > 0) {
      $wordDisplay.textContent = words[0];
    }
  };

  const transitionToCalibrate = (): void => {
    $welcomeView.hidden = true;
    $calibrateView.hidden = false;
    mountEngine();
  };

  // --- Listeners ---

  const onGetStarted = (): void => {
    transitionToCalibrate();
  };
  $getStartedBtn.addEventListener('click', onGetStarted);

  const onDismiss = (): void => {
    win.close();
  };
  $dismissBtn.addEventListener('click', onDismiss);

  const onStartPreview = (): void => {
    if (!engine) return;
    showStartPreview(false);
    showPauseToggle(true);
    engine.start();
  };
  $startPreviewBtn.addEventListener('click', onStartPreview);

  const onReplay = (): void => {
    if (!engine) return;
    doneCount = 0;
    engine.setWords(words);
    showReplay(false);
    showPauseToggle(true);
    $slider.disabled = false;
    engine.start();
  };
  if (replayBtn) replayBtn.addEventListener('click', onReplay);

  const onPauseToggle = (): void => {
    if (!engine || !pauseToggleBtn) return;
    if (engine.state === 'playing') {
      engine.pause();
      pauseToggleBtn.textContent = 'Play';
    } else if (engine.state === 'paused') {
      engine.resume();
      pauseToggleBtn.textContent = 'Pause';
    }
  };
  if (pauseToggleBtn) pauseToggleBtn.addEventListener('click', onPauseToggle);

  const onSliderInput = (): void => {
    const raw = Number($slider.value);
    if (!Number.isFinite(raw)) return;
    $label.textContent = labelText(raw);
    if (engine) {
      engine.setWpm(previewWpm(raw));
    }
  };
  $slider.addEventListener('input', onSliderInput);

  const onSaveFinish = (): void => {
    const value = Number($slider.value);
    if (!Number.isFinite(value)) return;
    // Spec §"Settings Round-Trip" — the await wraps in try/finally so
    // window.close runs even if flush rejects (offline + sync-quota,
    // transient sync.set failure).
    void (async () => {
      try {
        await api.save({ wpm: value });
        await api.flush();
      } catch (err) {
        console.error('[speedreader] welcome: save/flush failed', err);
      } finally {
        win.close();
      }
    })();
  };
  $saveFinishBtn.addEventListener('click', onSaveFinish);

  // Non-blocking load. Slider stays at default until resolved; on resolve,
  // reseat both slider and engine — but only if the engine has not yet
  // started playback. Per ring decision-challenger #3: if loadSettings
  // resolves AFTER the user has clicked Start preview, a late reseat
  // would visibly jump the slider mid-stream under the user's gaze. Once
  // the user has committed to a preview cadence, the stored setting
  // doesn't get to retro-apply.
  void api
    .load()
    .then((loaded) => {
      if (engine && engine.state !== 'idle') return;
      setSliderValue(loaded.wpm);
      if (engine) {
        engine.setWpm(previewWpm(loaded.wpm));
      }
    })
    .catch((err) => {
      console.error('[speedreader] welcome: load failed, using defaults', err);
    });

  return () => {
    $getStartedBtn.removeEventListener('click', onGetStarted);
    $dismissBtn.removeEventListener('click', onDismiss);
    $startPreviewBtn.removeEventListener('click', onStartPreview);
    if (replayBtn) replayBtn.removeEventListener('click', onReplay);
    if (pauseToggleBtn) pauseToggleBtn.removeEventListener('click', onPauseToggle);
    $slider.removeEventListener('input', onSliderInput);
    $saveFinishBtn.removeEventListener('click', onSaveFinish);
    engineUnsubscribe?.();
    engine?.stop();
  };
}
