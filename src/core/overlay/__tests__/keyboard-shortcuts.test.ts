import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine, type RsvpEngine, type RsvpEngineOptions } from '../../rsvp-engine';

const STREAM = ['Hi.', 'How', 'are', 'you?', 'I', 'am', 'fine.', 'Bye!'];

type Holder = { engine: RsvpEngine | null };

function defaultOpts(holder: Holder, overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: STREAM.slice(),
    initialSettings: { theme: 'system', wpm: 300 },
    subscribeSettings: () => () => undefined,
    engineFactory: (engineOpts: RsvpEngineOptions) => {
      holder.engine = createRsvpEngine(engineOpts);
      return holder.engine;
    },
    ...overrides,
  };
}

function dispatch(key: string, init: KeyboardEventInit = {}): void {
  // Capture-phase handler is installed on `document`, so the event must
  // dispatch from document for the handler to see it. `cancelable: true`
  // is required for `preventDefault` to have any observable effect.
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

function engineOf(holder: Holder): RsvpEngine {
  if (!holder.engine) throw new Error('engine not yet created');
  return holder.engine;
}

describe('createOverlay — in-overlay keyboard shortcuts (#33)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('Space toggles play/pause', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    expect(holder.engine?.state).toBe('playing');

    dispatch(' ');
    expect(holder.engine?.state).toBe('paused');

    dispatch(' ');
    expect(holder.engine?.state).toBe('playing');

    overlay.unmount();
  });

  test('ArrowRight jumps to next sentence', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    dispatch(' '); // pause at 'Hi.' (nextIndex=1)
    const seekSpy = vi.spyOn(engineOf(holder), 'seekToSentence');

    dispatch('ArrowRight');

    expect(seekSpy).toHaveBeenCalledWith('next');
    overlay.unmount();
  });

  test('ArrowLeft jumps to previous sentence', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    dispatch(' '); // pause
    const seekSpy = vi.spyOn(engineOf(holder), 'seekToSentence');

    dispatch('ArrowLeft');

    expect(seekSpy).toHaveBeenCalledWith('prev');
    overlay.unmount();
  });

  test('ArrowUp increases WPM by step', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300 } }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    dispatch('ArrowUp');

    expect(setWpmSpy).toHaveBeenCalledWith(310);
    overlay.unmount();
  });

  test('ArrowDown decreases WPM by step', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300 } }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    dispatch('ArrowDown');

    expect(setWpmSpy).toHaveBeenCalledWith(290);
    overlay.unmount();
  });

  test('ArrowUp clamps at WPM upper bound (600)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 600 } }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    dispatch('ArrowUp');

    expect(setWpmSpy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('ArrowDown clamps at WPM lower bound (100)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 100 } }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    dispatch('ArrowDown');

    expect(setWpmSpy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('repeated ArrowUp ticks accumulate', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 300 } }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    dispatch('ArrowUp');
    dispatch('ArrowUp');
    dispatch('ArrowUp');

    expect(setWpmSpy).toHaveBeenNthCalledWith(1, 310);
    expect(setWpmSpy).toHaveBeenNthCalledWith(2, 320);
    expect(setWpmSpy).toHaveBeenNthCalledWith(3, 330);
    overlay.unmount();
  });

  test('Escape closes the overlay', () => {
    const onClose = vi.fn();
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder, { onClose }));
    overlay.mount();
    expect(overlay.status).toBe('mounted');

    dispatch('Escape');

    expect(overlay.status).toBe('unmounted');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('modifier-key arrow combos are ignored (OS shortcuts pass through)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const seekSpy = vi.spyOn(engineOf(holder), 'seekToSentence');
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    dispatch('ArrowLeft', { metaKey: true });
    dispatch('ArrowRight', { ctrlKey: true });
    dispatch('ArrowUp', { altKey: true });
    dispatch('ArrowDown', { metaKey: true });

    expect(seekSpy).not.toHaveBeenCalled();
    expect(setWpmSpy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('shortcuts call preventDefault to deny page-side hotkeys', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();

    for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      expect(event.defaultPrevented, `defaultPrevented for ${key}`).toBe(true);
      if (key === 'Escape') break; // overlay unmounted, no more handlers
    }
  });

  test('shortcuts no longer fire after unmount', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const engineRef = engineOf(holder);
    overlay.unmount();
    const seekSpy = vi.spyOn(engineRef, 'seekToSentence');

    dispatch('ArrowRight');
    dispatch(' ');

    expect(seekSpy).not.toHaveBeenCalled();
  });

  test('subscribeSettings wpm change updates the engine cadence', () => {
    const holder: Holder = { engine: null };
    const emitter: { fn: SettingsSubscriber | null } = { fn: null };
    const subscribeSettings = (cb: SettingsSubscriber): (() => void) => {
      emitter.fn = cb;
      return () => {
        emitter.fn = null;
      };
    };
    const overlay = createOverlay(defaultOpts(holder, { subscribeSettings }));
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    const next: OverlaySettings = { theme: 'system', wpm: 450 };
    emitter.fn?.(next);

    expect(setWpmSpy).toHaveBeenCalledWith(450);
    overlay.unmount();
  });

  test('subscribeSettings same-wpm change does NOT call setWpm', () => {
    const holder: Holder = { engine: null };
    const emitter: { fn: SettingsSubscriber | null } = { fn: null };
    const subscribeSettings = (cb: SettingsSubscriber): (() => void) => {
      emitter.fn = cb;
      return () => {
        emitter.fn = null;
      };
    };
    const overlay = createOverlay(defaultOpts(holder, { subscribeSettings }));
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    emitter.fn?.({ theme: 'dark', wpm: 300 }); // wpm unchanged

    expect(setWpmSpy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('ArrowRight on last sentence is a no-op (does NOT end the session)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder, { words: ['only.', 'one.'] }));
    overlay.mount();
    dispatch(' '); // pause
    const stateBefore = holder.engine?.state;
    const seekSpy = vi.spyOn(engineOf(holder), 'seekTo');

    // First ArrowRight: from index 1 (paused after 'only.'), nextIndex=1 means
    // we're at start of "one." — next-sentence walks forward from 1, finds no
    // further boundary → no-op.
    dispatch('ArrowRight');
    dispatch('ArrowRight');

    expect(holder.engine?.state).toBe(stateBefore);
    expect(seekSpy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('Shift+Arrow passes through (text selection / scroll shortcuts preserved)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    const seekSpy = vi.spyOn(engineOf(holder), 'seekToSentence');
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      expect(event.defaultPrevented, `Shift+${key} must not be preventDefault'd`).toBe(false);
    }
    expect(seekSpy).not.toHaveBeenCalled();
    expect(setWpmSpy).not.toHaveBeenCalled();
    overlay.unmount();
  });

  test('ArrowUp at 595 WPM clamps to 600 (not 605)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 590 } }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    dispatch('ArrowUp'); // 590 → 600
    dispatch('ArrowUp'); // 600 → clamped no-op

    expect(setWpmSpy).toHaveBeenCalledTimes(1);
    expect(setWpmSpy).toHaveBeenCalledWith(600);
    overlay.unmount();
  });

  test('ArrowDown at 110 WPM clamps to 100 (not 90)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(
      defaultOpts(holder, { initialSettings: { theme: 'system', wpm: 110 } }),
    );
    overlay.mount();
    const setWpmSpy = vi.spyOn(engineOf(holder), 'setWpm');

    dispatch('ArrowDown'); // 110 → 100
    dispatch('ArrowDown'); // 100 → clamped no-op

    expect(setWpmSpy).toHaveBeenCalledTimes(1);
    expect(setWpmSpy).toHaveBeenCalledWith(100);
    overlay.unmount();
  });

  test('capture-phase handler runs before page-side bubble listener', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();
    // Page-side listener at bubble phase (false). If overlay's capture handler
    // didn't preventDefault first, this would still fire on the event — but
    // defaultPrevented should be true by the time it runs.
    const observed: Array<{ key: string; prevented: boolean }> = [];
    const pageListener = (e: Event): void => {
      const ke = e as KeyboardEvent;
      observed.push({ key: ke.key, prevented: ke.defaultPrevented });
    };
    document.addEventListener('keydown', pageListener, false);

    dispatch(' ');
    dispatch('ArrowRight');
    dispatch('ArrowUp');

    document.removeEventListener('keydown', pageListener, false);
    expect(observed.length).toBe(3);
    expect(observed.every((o) => o.prevented)).toBe(true);
    overlay.unmount();
  });
});
