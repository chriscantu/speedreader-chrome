/**
 * chunk-size-wire.test.ts — issue #51 (test-gap HIGH #3)
 *
 * End-to-end wire from `chrome.storage.sync.get` → loadSettings →
 * createOverlay (`initialSettings.chunkSize` slot) → subscribeSettings
 * push → `engine.setChunkSize(next)`. The unit tests in
 * `core/rsvp-engine/__tests__/chunk-mode.test.ts` pin the engine's
 * local behaviour; this file pins the chrome-glue boundary so a
 * regression that drops `chunkSize: settings.chunkSize` from the CS
 * payload or the subscribe wiring lands as a test failure rather
 * than a silent default at the boundary.
 *
 * Mutation guards:
 *   - Hardcoding `chunkSize: 1` at the initial-mount site must fail
 *     the first test (which loads chunkSize=3 and asserts chunk
 *     events are emitted by the underlying engine).
 *   - Dropping `chunkSize: s.chunkSize` from the subscribe wiring
 *     must fail the second test (settings push to chunkSize=2
 *     should switch the live event stream from word to chunk).
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import type { SettingsV7 } from '../../../core/settings/schema';
import { OVERLAY_CLASS } from '../../../core/overlay/constants';

const SETTINGS_KEY = 'speedreader.settings';
const EXT_ID = 'test-ext';

type Listener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void,
) => unknown;

type StorageChangedListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string,
) => void;

interface ChromeMock {
  runtime: {
    id: string;
    onMessage: { addListener: (l: Listener) => void };
    getURL: ReturnType<typeof vi.fn>;
  };
  storage: {
    sync: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
    onChanged: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
}

function installChromeMock(stored: SettingsV7): {
  mock: ChromeMock;
  getListener: () => Listener;
  emitStorageChange: (next: SettingsV7) => void;
} {
  let capturedListener: Listener | undefined;
  const storageListeners: StorageChangedListener[] = [];
  const mock: ChromeMock = {
    runtime: {
      id: EXT_ID,
      onMessage: {
        addListener: (l: Listener) => {
          capturedListener = l;
        },
      },
      getURL: vi.fn((path: string) => `chrome-extension://${EXT_ID}/${path}`),
    },
    storage: {
      sync: {
        get: vi.fn().mockResolvedValue({ [SETTINGS_KEY]: stored }),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: {
        addListener: vi.fn((l: StorageChangedListener) => {
          storageListeners.push(l);
        }),
        removeListener: vi.fn(),
      },
    },
  };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return {
    mock,
    getListener: () => {
      if (!capturedListener) throw new Error('content script never registered listener');
      return capturedListener;
    },
    emitStorageChange: (next: SettingsV7) => {
      for (const l of storageListeners) {
        l({ [SETTINGS_KEY]: { newValue: next, oldValue: stored } }, 'sync');
      }
    },
  };
}

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

function getWordRegion(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.WORD_REGION}`);
  if (!el) throw new Error('overlay shadow: missing word region');
  return el;
}

async function mountOverlay(getListener: () => Listener): Promise<void> {
  // Long enough that chunkSize=2 and 3 both produce a multi-word first chunk.
  document.body.innerHTML = '<article>The quick brown fox jumps over the lazy dog.</article>';
  await import('../index');
  const listener = getListener();
  const respond = vi.fn();
  listener({ type: 'activate-reader' }, { id: EXT_ID }, respond);
  expect(respond).toHaveBeenCalledWith({ ok: true });
  // Drain the microtask queue (loadSettings is async) without
  // advancing fake timers — engine emits its first event synchronously
  // inside the mount's start(), so once the overlay handle exists the
  // first tick is already rendered. Using runAllTimersAsync would
  // exhaust the entire RSVP timer loop and leave the word region on
  // the LAST emitted event, not the first.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('content script — chunkSize wire boundary (#51)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    document.body.innerHTML = '';
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
    vi.resetModules();
  });

  test('initialSettings.chunkSize reflects stored value — engine emits 3-word chunks on first tick', async () => {
    // The overlay forwards initialSettings.chunkSize into the engine
    // factory. With chunkSize=3 and a clean stream, the first emission
    // should be a chunk of 3 words ("The quick brown") rendered into
    // the word region. A regression that hardcodes chunkSize:1 (or
    // drops the field) would cause word-mode emission — the word
    // region would show only "The".
    const { getListener } = installChromeMock({
      ...DEFAULT_SETTINGS,
      chunkSize: 3,
    });
    await mountOverlay(getListener);
    expect(getWordRegion().textContent).toBe('The quick brown');
  });

  test('subscribeSettings push delivers chunkSize change — live update flips display to 2-word chunks', async () => {
    // Start at chunkSize=1 (word mode) — first emission is the single
    // word "The". Then push chunkSize=2; the overlay's subscribe
    // handler calls engine.setChunkSize(2) which rebuilds chunks and
    // (in paused state) emits a replacement chunk for the current
    // position. The engine here is PLAYING, so setChunkSize ticks
    // immediately at the new mode — next visible text should be a
    // chunk like "quick brown" or "The quick" depending on where the
    // position landed. Either way it must NOT be a single word.
    const { getListener, emitStorageChange } = installChromeMock({
      ...DEFAULT_SETTINGS,
      chunkSize: 1,
    });
    await mountOverlay(getListener);
    expect(getWordRegion().textContent).toBe('The');

    emitStorageChange({ ...DEFAULT_SETTINGS, chunkSize: 2 });
    // Drain microtasks (storage onChanged → loadSettings → subscriber)
    // without advancing timers — the live setChunkSize call is
    // synchronous from the subscriber's perspective, and on PLAYING
    // state it ticks immediately (emitting a chunk event synchronously
    // via the engine subscriber). Advancing timers would let the
    // engine run to completion and leave the region on the last word.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Word region should now contain a multi-word chunk (text
    // includes a space). Asserting "contains a space" is robust to
    // exactly which chunk the engine lands on after the live switch.
    const text = getWordRegion().textContent ?? '';
    expect(text.includes(' ')).toBe(true);
    expect(text.split(' ').length).toBeGreaterThanOrEqual(2);
  });
});
