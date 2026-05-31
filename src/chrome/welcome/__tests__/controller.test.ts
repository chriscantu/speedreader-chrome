/**
 * Behavioral tests for the welcome controller.
 *
 * The controller owns:
 *   - view state machine (welcome ↔ calibrate via `hidden` attribute toggle)
 *   - lazy RSVP engine mount on first calibrate transition
 *   - paused-default engine boot + ▶ Start preview gate
 *   - 2-loop cap with auto-pause + ↻ Replay affordance
 *   - WPM slider → engine.setWpm with min(value, 500) clamp; label reflects
 *     true value with "preview capped at 500 wpm" note when above 500
 *   - settings round-trip: non-blocking load, Save & finish → saveSettings
 *     then flushSettings wrapped in try/finally so window.close runs even
 *     on flush rejection
 *   - dismiss → window.close() with NO settings written
 *
 * See docs/superpowers/specs/2026-05-30-onboarding-surface.md.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bindWelcome, WELCOME_IDS, type SettingsApi } from '../controller';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import { SAMPLE_PASSAGE } from '../sample';
import type { SettingsV5 } from '../../../core/settings/schema';

const HTML = `
  <header>
    <button type="button" id="${WELCOME_IDS.dismiss}" aria-label="Close">✕</button>
  </header>
  <main>
    <section id="${WELCOME_IDS.welcomeView}" data-view="welcome">
      <button type="button" id="${WELCOME_IDS.getStarted}">Get started →</button>
    </section>
    <section id="${WELCOME_IDS.calibrateView}" data-view="calibrate" hidden>
      <div id="${WELCOME_IDS.wordDisplay}"></div>
      <button type="button" id="${WELCOME_IDS.startPreview}">▶ Start preview</button>
      <button type="button" id="${WELCOME_IDS.pauseToggle}" hidden>Pause</button>
      <button type="button" id="${WELCOME_IDS.replay}" hidden>↻ Replay</button>
      <input type="range" id="${WELCOME_IDS.wpmSlider}" min="100" max="600" step="10" />
      <span id="${WELCOME_IDS.wpmLabel}"></span>
      <button type="button" id="${WELCOME_IDS.saveFinish}">Save &amp; finish</button>
    </section>
  </main>
`;

interface Stub extends SettingsApi {
  loadMock: ReturnType<typeof vi.fn>;
  saveMock: ReturnType<typeof vi.fn>;
  flushMock: ReturnType<typeof vi.fn>;
  resolveLoad(s: SettingsV5): void;
  rejectLoad(err: unknown): void;
}

function makeStub(options: { initial?: SettingsV5; deferLoad?: boolean } = {}): Stub {
  const initial = options.initial ?? DEFAULT_SETTINGS;
  let resolveLoad: (s: SettingsV5) => void = () => undefined;
  let rejectLoad: (e: unknown) => void = () => undefined;
  const loadPromise = options.deferLoad
    ? new Promise<SettingsV5>((res, rej) => {
        resolveLoad = res;
        rejectLoad = rej;
      })
    : Promise.resolve(initial);
  const loadMock = vi.fn(() => loadPromise);
  const saveMock = vi.fn(async () => undefined);
  const flushMock = vi.fn(async () => undefined);
  return {
    load: loadMock,
    save: saveMock,
    flush: flushMock,
    loadMock,
    saveMock,
    flushMock,
    resolveLoad: (s) => resolveLoad(s),
    rejectLoad,
  };
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

function click(el: HTMLElement | null): void {
  if (!el) throw new Error('click target null');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function inputEvent(el: HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function get<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not in DOM`);
  return el as T;
}

/**
 * Drain microtasks so deferred load resolution can flow through before
 * subsequent assertions. Needed because the controller's awaited promise
 * tree resolves over multiple microtask ticks (load → populate slider →
 * engine.setWpm).
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let mockClose: ReturnType<typeof vi.fn>;
let originalClose: typeof window.close;

describe('welcome controller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setBody(HTML);
    originalClose = window.close;
    mockClose = vi.fn();
    window.close = mockClose as unknown as typeof window.close;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    window.close = originalClose;
  });

  describe('initial render', () => {
    it('shows welcome view and hides calibrate view on boot', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      expect(get(WELCOME_IDS.welcomeView).hidden).toBe(false);
      expect(get(WELCOME_IDS.calibrateView).hidden).toBe(true);
    });

    it('does not instantiate the RSVP engine until calibrate transition', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      // No word rendered into the display — engine not constructed yet.
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe('');
    });
  });

  describe('Get started → calibrate transition', () => {
    it('hides welcome and shows calibrate when Get started is clicked', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      expect(get(WELCOME_IDS.welcomeView).hidden).toBe(true);
      expect(get(WELCOME_IDS.calibrateView).hidden).toBe(false);
    });

    it('mounts the engine on first transition and renders the first word statically (IDLE)', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      const firstWord = SAMPLE_PASSAGE.split(/\s+/)[0];
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe(firstWord);

      // Advance timers — engine is IDLE, so no further word should land.
      vi.advanceTimersByTime(10_000);
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe(firstWord);
    });
  });

  describe('▶ Start preview', () => {
    it('starts the engine when clicked; word display advances on the next tick', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      const words = SAMPLE_PASSAGE.split(/\s+/);
      // Before start: first word static.
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe(words[0]);
      click(get(WELCOME_IDS.startPreview));
      // start() emits word[0] synchronously; word[1] follows after one tick.
      // At default 250 wpm, msPerWord = 240ms.
      vi.advanceTimersByTime(240);
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe(words[1]);
    });
  });

  describe('loop policy — 2 passes then auto-pause + replay', () => {
    it('after 2 done events the engine stops and Replay button is visible', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      click(get(WELCOME_IDS.startPreview));
      const words = SAMPLE_PASSAGE.split(/\s+/);
      // Each pass is words.length ticks. Two passes = 2 * words.length ticks.
      // At 250 wpm = 240ms/word. Advance 3 passes worth to ensure 2nd done
      // landed; if loop cap is missing the test will see a 3rd pass running.
      const totalMs = words.length * 240 * 3;
      vi.advanceTimersByTime(totalMs);
      // After 2nd done, engine left in DONE state — Replay visible.
      expect(get(WELCOME_IDS.replay).hidden).toBe(false);
      // Word display should NOT be advancing anymore — capture and re-check.
      const settledWord = get(WELCOME_IDS.wordDisplay).textContent;
      vi.advanceTimersByTime(2000);
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe(settledWord);
    });

    it('clicking Replay re-starts the engine from the beginning', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      click(get(WELCOME_IDS.startPreview));
      const words = SAMPLE_PASSAGE.split(/\s+/);
      vi.advanceTimersByTime(words.length * 240 * 3);
      // After cap, Replay is visible; click it to start over.
      click(get(WELCOME_IDS.replay));
      // Engine re-started — first word should be visible again.
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe(words[0]);
      expect(get(WELCOME_IDS.replay).hidden).toBe(true);
    });
  });

  describe('WPM slider', () => {
    it('reseats engine WPM on slider input', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      click(get(WELCOME_IDS.startPreview));
      // Initial cadence — 250 wpm → 240ms.
      inputEvent(get<HTMLInputElement>(WELCOME_IDS.wpmSlider), '350');
      // Label shows true slider value.
      expect(get(WELCOME_IDS.wpmLabel).textContent).toContain('350');
      // At 350 wpm cadence is ~171ms — ensure label reflects without clamp note.
      expect(get(WELCOME_IDS.wpmLabel).textContent).not.toContain('capped');
    });

    it('clamps preview engine cadence at 500 wpm but label shows true value with "capped" note', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      click(get(WELCOME_IDS.startPreview));
      const words = SAMPLE_PASSAGE.split(/\s+/);
      inputEvent(get<HTMLInputElement>(WELCOME_IDS.wpmSlider), '550');
      // Label includes 550 and the cap note.
      const label = get(WELCOME_IDS.wpmLabel).textContent ?? '';
      expect(label).toContain('550');
      expect(label).toMatch(/capped at 500/i);
      // Engine cadence clamped to 500 wpm → 120ms. At 550 wpm uncapped it
      // would be ~109ms — advancing 119ms must NOT tick, advancing 121ms must.
      const before = get(WELCOME_IDS.wordDisplay).textContent;
      vi.advanceTimersByTime(119);
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe(before);
      vi.advanceTimersByTime(2);
      // Word advanced — confirm it's the next word in the stream.
      const after = get(WELCOME_IDS.wordDisplay).textContent;
      expect(after).not.toBe(before);
      expect(words).toContain(after);
    });
  });

  describe('settings load is non-blocking', () => {
    it('renders calibrate at default 250 while loadSettings is in flight, then reseats to loaded value', async () => {
      const api = makeStub({ deferLoad: true });
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      // Slider initialized to V4 default 250 — load still in flight.
      expect(get<HTMLInputElement>(WELCOME_IDS.wpmSlider).value).toBe('250');

      // Resolve load with wpm=400.
      api.resolveLoad({ ...DEFAULT_SETTINGS, wpm: 400 });
      await flushMicrotasks();

      // Slider reseats to 400.
      expect(get<HTMLInputElement>(WELCOME_IDS.wpmSlider).value).toBe('400');
      // Engine still IDLE — clicking start should respect the new wpm.
      const wordDisplay = get(WELCOME_IDS.wordDisplay);
      const words = SAMPLE_PASSAGE.split(/\s+/);
      expect(wordDisplay.textContent).toBe(words[0]);
    });
  });

  describe('Save & finish', () => {
    it('saves the slider value, flushes, then closes the window', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      inputEvent(get<HTMLInputElement>(WELCOME_IDS.wpmSlider), '320');
      click(get(WELCOME_IDS.saveFinish));
      await flushMicrotasks();
      expect(api.saveMock).toHaveBeenCalledWith({ wpm: 320 });
      expect(api.flushMock).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });

    it('closes the window even when flushSettings rejects (try/finally)', async () => {
      const api = makeStub();
      api.flushMock.mockRejectedValueOnce(new Error('quota exceeded'));
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      click(get(WELCOME_IDS.saveFinish));
      await flushMicrotasks();
      await flushMicrotasks();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe('header ✕ dismiss', () => {
    it('closes the window without saving from the welcome view', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.dismiss));
      expect(mockClose).toHaveBeenCalled();
      expect(api.saveMock).not.toHaveBeenCalled();
      expect(api.flushMock).not.toHaveBeenCalled();
    });

    it('closes the window without saving from the calibrate view', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      inputEvent(get<HTMLInputElement>(WELCOME_IDS.wpmSlider), '420');
      click(get(WELCOME_IDS.dismiss));
      expect(mockClose).toHaveBeenCalled();
      expect(api.saveMock).not.toHaveBeenCalled();
      expect(api.flushMock).not.toHaveBeenCalled();
    });
  });

  // Ring fixes — second-pass behaviors added after the tier-2 antagonistic
  // review on PR #184 (decision-challenger #2/#3, scope-adversary #3/#4).
  describe('slider disable in DONE (ring decision-challenger #2)', () => {
    it('disables the slider when the loop cap fires and re-enables on Replay', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      click(get(WELCOME_IDS.startPreview));
      const words = SAMPLE_PASSAGE.split(/\s+/);
      // Drive past the 2-pass cap.
      vi.advanceTimersByTime(words.length * 240 * 3);
      const slider = get<HTMLInputElement>(WELCOME_IDS.wpmSlider);
      expect(slider.disabled).toBe(true);
      // Replay re-enables.
      click(get(WELCOME_IDS.replay));
      expect(slider.disabled).toBe(false);
    });
  });

  describe('late loadSettings does not race playback (ring decision-challenger #3)', () => {
    it('skips the slider reseat if loadSettings resolves after Start preview', async () => {
      const api = makeStub({ deferLoad: true });
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      click(get(WELCOME_IDS.startPreview));
      // Engine is now PLAYING at default 250. Late load lands.
      api.resolveLoad({ ...DEFAULT_SETTINGS, wpm: 450 });
      await flushMicrotasks();
      // Slider must NOT have jumped under the user's gaze.
      expect(get<HTMLInputElement>(WELCOME_IDS.wpmSlider).value).toBe('250');
    });
  });

  describe('pause toggle (ring scope-adversary #3)', () => {
    it('pauses an active engine and resumes it on the second click', async () => {
      const api = makeStub();
      await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      click(get(WELCOME_IDS.startPreview));
      const words = SAMPLE_PASSAGE.split(/\s+/);
      // Let one tick fire so we know engine is mid-stream.
      vi.advanceTimersByTime(240);
      const pauseBtn = get<HTMLButtonElement>(WELCOME_IDS.pauseToggle);
      expect(pauseBtn.hidden).toBe(false);
      expect(pauseBtn.textContent).toBe('Pause');
      // Pause.
      click(pauseBtn);
      expect(pauseBtn.textContent).toBe('Play');
      const frozen = get(WELCOME_IDS.wordDisplay).textContent;
      // Word display does NOT advance while paused.
      vi.advanceTimersByTime(1000);
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe(frozen);
      // Resume — the next tick lands a new word.
      click(pauseBtn);
      expect(pauseBtn.textContent).toBe('Pause');
      vi.advanceTimersByTime(240);
      const advanced = get(WELCOME_IDS.wordDisplay).textContent;
      expect(advanced).not.toBe(frozen);
      expect(words).toContain(advanced);
    });
  });

  describe('teardown releases engine subscription (ring scope-adversary #4)', () => {
    it('engine word events stop driving the DOM after teardown', async () => {
      const api = makeStub();
      const teardown = await bindWelcome(document, window, api);
      click(get(WELCOME_IDS.getStarted));
      click(get(WELCOME_IDS.startPreview));
      // Tick once so a word lands.
      vi.advanceTimersByTime(240);
      const beforeTeardown = get(WELCOME_IDS.wordDisplay).textContent;
      // Teardown: stops the engine and unsubscribes the word listener. The
      // word display MUST NOT update even if a stray event fires.
      teardown();
      get(WELCOME_IDS.wordDisplay).textContent = 'SENTINEL';
      vi.advanceTimersByTime(2000);
      expect(get(WELCOME_IDS.wordDisplay).textContent).toBe('SENTINEL');
      // Sanity — confirm we captured a valid playback word before teardown.
      expect(beforeTeardown).not.toBe('');
    });
  });
});
