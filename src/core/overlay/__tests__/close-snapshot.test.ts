/**
 * Tests for the close-snapshot + `initialIndex` resume contract (#25).
 *
 * Covers:
 * - Esc-close hands a `{ index, total, scope }` snapshot to onClose with
 *   `index` matching the engine's progress at close time.
 * - ✕-button close does the same.
 * - `initialIndex` on mount seeks the engine forward so the first word
 *   rendered is `words[N]`, not `words[0]`.
 * - The clamp / ignore branches (negative, past-end, fractional, zero)
 *   all leave the mount at index 0 with no surprises.
 * - Legacy callers (no `scope` in options) get `onClose` called with
 *   `undefined` — no snapshot to record.
 * - Empty-stream callers get `undefined` — `total === 0` is meaningless
 *   for resume.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayCloseSnapshot, OverlayOptions } from '../types';
import { createRsvpEngine, type RsvpEngine, type RsvpEngineOptions } from '../../rsvp-engine';

const STREAM = ['Alpha.', 'Beta', 'gamma', 'delta.', 'Epsilon', 'zeta', 'eta.', 'Theta'];

type Holder = { engine: RsvpEngine | null };

function defaultOpts(holder: Holder, overrides: Partial<OverlayOptions> = {}): OverlayOptions {
  return {
    doc: document,
    words: STREAM.slice(),
    scope: 'full',
    fullWords: STREAM.slice(),
    selectionWords: [],
    initialSettings: { theme: 'system', wpm: 600 },
    subscribeSettings: () => () => undefined,
    engineFactory: (engineOpts: RsvpEngineOptions) => {
      holder.engine = createRsvpEngine(engineOpts);
      return holder.engine;
    },
    ...overrides,
  };
}

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
});

describe('createOverlay — onClose snapshot (#25)', () => {
  test('Esc close passes snapshot with index matching engine.progress()', () => {
    const holder: Holder = { engine: null };
    const onClose = vi.fn();
    const overlay = createOverlay(defaultOpts(holder, { onClose }));
    overlay.mount();
    // Engine emits its first word synchronously inside start() — at this
    // point progress().index === 1.
    vi.advanceTimersByTime(100); // 600 wpm => 100ms per word, advance one more tick
    const expectedIndex = holder.engine?.progress().index ?? -1;
    expect(expectedIndex).toBeGreaterThan(0);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(overlay.status).toBe('unmounted');
    expect(onClose).toHaveBeenCalledTimes(1);
    const snapshot = onClose.mock.calls[0][0] as OverlayCloseSnapshot | undefined;
    expect(snapshot).toBeDefined();
    expect(snapshot?.index).toBe(expectedIndex);
    expect(snapshot?.total).toBe(STREAM.length);
    expect(snapshot?.scope).toBe('full');
  });

  test('✕ button click passes snapshot with index matching engine.progress()', () => {
    const holder: Holder = { engine: null };
    const onClose = vi.fn();
    const overlay = createOverlay(defaultOpts(holder, { onClose }));
    overlay.mount();
    vi.advanceTimersByTime(200);
    const expectedIndex = holder.engine?.progress().index ?? -1;
    expect(expectedIndex).toBeGreaterThan(0);

    const closeBtn = getShadow().querySelector<HTMLButtonElement>('.close-btn');
    if (!closeBtn) throw new Error('close button missing');
    closeBtn.click();

    expect(overlay.status).toBe('unmounted');
    expect(onClose).toHaveBeenCalledTimes(1);
    const snapshot = onClose.mock.calls[0][0] as OverlayCloseSnapshot | undefined;
    expect(snapshot).toBeDefined();
    expect(snapshot?.index).toBe(expectedIndex);
    expect(snapshot?.total).toBe(STREAM.length);
    expect(snapshot?.scope).toBe('full');
  });

  test('selection-scope close reports scope: "selection"', () => {
    const holder: Holder = { engine: null };
    const onClose = vi.fn();
    const overlay = createOverlay(
      defaultOpts(holder, {
        onClose,
        scope: 'selection',
        selectionWords: ['one', 'two', 'three.', 'four'],
        fullWords: STREAM.slice(),
      }),
    );
    overlay.mount();
    vi.advanceTimersByTime(100);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    const snapshot = onClose.mock.calls[0][0] as OverlayCloseSnapshot | undefined;
    expect(snapshot?.scope).toBe('selection');
    expect(snapshot?.total).toBe(4);
  });

  test('legacy caller without scope receives onClose with undefined snapshot', () => {
    const holder: Holder = { engine: null };
    const onClose = vi.fn();
    // Strip scope-aware fields — this is the legacy single-stream entry
    // path that still exists in the type contract.
    const legacy: OverlayOptions = {
      doc: document,
      words: STREAM.slice(),
      initialSettings: { theme: 'system', wpm: 600 },
      subscribeSettings: () => () => undefined,
      engineFactory: (engineOpts: RsvpEngineOptions) => {
        holder.engine = createRsvpEngine(engineOpts);
        return holder.engine;
      },
      onClose,
    };
    const overlay = createOverlay(legacy);
    overlay.mount();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toBeUndefined();
  });

  test('empty-stream mount reports onClose with undefined snapshot', () => {
    const holder: Holder = { engine: null };
    const onClose = vi.fn();
    const overlay = createOverlay(
      defaultOpts(holder, {
        onClose,
        scope: 'full',
        words: [],
        fullWords: [],
        selectionWords: [],
      }),
    );
    overlay.mount();
    // Engine completes immediately (start on empty words -> done).
    overlay.unmount();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toBeUndefined();
  });
});

describe('createOverlay — initialIndex resume (#25)', () => {
  test('initialIndex: N renders words[N] as the first emitted word', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder, { initialIndex: 4 }));
    overlay.mount();
    // After mount() the engine has emitted words[0] from start() and then
    // the seekTo(4) replacement word event for words[4]. The word region
    // reflects the most recent emission.
    const wordRegion = getShadow().querySelector('.word-region');
    expect(wordRegion?.textContent).toBe(STREAM[4]);
    // progress().index advances to 5 after the seekTo emission.
    expect(holder.engine?.progress().index).toBe(5);
    overlay.unmount();
  });

  test('initialIndex: 0 does NOT seek (no-op, starts at index 0)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder, { initialIndex: 0 }));
    overlay.mount();
    // Without a seek the engine has emitted only words[0]; progress.index === 1.
    expect(holder.engine?.progress().index).toBe(1);
    overlay.unmount();
  });

  test('initialIndex: negative is ignored (clamp branch)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder, { initialIndex: -1 }));
    overlay.mount();
    expect(holder.engine?.progress().index).toBe(1);
    overlay.unmount();
  });

  test('initialIndex past the end is ignored (would otherwise mark engine done)', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder, { initialIndex: 99999 }));
    overlay.mount();
    expect(holder.engine?.state).toBe('playing');
    expect(holder.engine?.progress().index).toBe(1);
    overlay.unmount();
  });

  test('initialIndex fractional is ignored', () => {
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder, { initialIndex: 2.7 }));
    overlay.mount();
    expect(holder.engine?.progress().index).toBe(1);
    overlay.unmount();
  });

  test('round-trip: close → snapshot → remount with initialIndex resumes there', () => {
    const holder1: Holder = { engine: null };
    let captured: OverlayCloseSnapshot | undefined;
    const overlay1 = createOverlay(
      defaultOpts(holder1, {
        onClose: (snap) => {
          captured = snap;
        },
      }),
    );
    overlay1.mount();
    vi.advanceTimersByTime(300); // ~3 more ticks at 600wpm
    overlay1.unmount();

    expect(captured).toBeDefined();
    expect(captured?.index).toBeGreaterThan(1);

    const holder2: Holder = { engine: null };
    const overlay2 = createOverlay(defaultOpts(holder2, { initialIndex: captured?.index }));
    overlay2.mount();

    const wordRegion = getShadow().querySelector('.word-region');
    expect(wordRegion?.textContent).toBe(STREAM[captured?.index ?? 0]);
    overlay2.unmount();
  });
});
