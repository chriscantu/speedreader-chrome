/**
 * context-line-wire.test.ts — issue #242 (CS-glue boundary)
 *
 * End-to-end wire from `chrome.storage.sync.get` → loadSettings →
 * createOverlay (`initialSettings.contextLine` slot) → subscribeSettings
 * push → overlay context-preview visibility. The unit tests in
 * `core/overlay/__tests__/context-preview.test.ts` pin the overlay's local
 * gate behaviour; this file pins the chrome-glue boundary so a regression
 * that drops `contextLine: settings.contextLine` from the CS payload or the
 * subscribe wiring lands as a test failure rather than a silent default at
 * the boundary.
 *
 * Same defect class as the "alignment dead since V3" bug: the schema slot
 * exists but no boundary code reads it. The unit tests can't detect that the
 * CS doesn't forward — only this boundary test can. `content/index.ts` is the
 * ONLY path that can enable the preview, so it is the only place this wire
 * can break.
 *
 * Mutation guards:
 *   - Dropping `contextLine: settings.contextLine` from the initial-mount
 *     payload fails the first test (the overlay would default the gate to off
 *     and keep the preview invisible despite stored `true`).
 *   - Dropping `contextLine: s.contextLine` from the subscribe payload fails
 *     the live-push test (the live enable would have no effect on the preview).
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

function getPreview(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.CONTEXT_PREVIEW}`);
  if (!el) throw new Error('overlay shadow: missing .context-preview');
  return el;
}

// #242 — the preview slot stays in flow at all times (no `display:none`, no
// `hidden` attribute); visibility is carried by `visibility`/`opacity`. Mirror
// the same read used by the overlay unit tests so the wire-test and the local
// gate test agree on what "visible" means.
function isPreviewVisible(preview: HTMLElement): boolean {
  return preview.style.visibility !== 'hidden' && preview.style.opacity !== '0';
}

function pause(): void {
  const btn = getShadow().querySelector<HTMLButtonElement>(`.${OVERLAY_CLASS.PLAY_PAUSE_BTN}`);
  if (!btn) throw new Error('overlay shadow: missing play-pause-btn');
  btn.click();
}

async function mountOverlay(getListener: () => Listener): Promise<void> {
  document.body.innerHTML = '<article>The quick brown fox jumps over the lazy dog.</article>';
  await import('../index');
  const listener = getListener();
  const respond = vi.fn();
  listener({ type: 'activate-reader' }, { id: EXT_ID }, respond);
  expect(respond).toHaveBeenCalledWith({ ok: true });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('content script — contextLine wire boundary (#242)', () => {
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

  test('stored contextLine=true → preview visible on pause (decoration opt-in wired)', async () => {
    // The preview only shows while paused. With contextLine opted in at the
    // boundary, pausing must reveal it. A regression that drops contextLine
    // from the mount payload defaults the gate to off and keeps the preview
    // invisible — failing this test.
    const { getListener } = installChromeMock({
      ...DEFAULT_SETTINGS,
      contextLine: true,
    });
    await mountOverlay(getListener);
    pause();
    expect(isPreviewVisible(getPreview())).toBe(true);
  });

  test('stored contextLine=false → preview stays invisible on pause (off-by-default also passes the boundary)', async () => {
    const { getListener } = installChromeMock({
      ...DEFAULT_SETTINGS,
      contextLine: false,
    });
    await mountOverlay(getListener);
    pause();
    expect(isPreviewVisible(getPreview())).toBe(false);
  });

  test('subscribeSettings push delivers contextLine change — live enable reveals the preview without remount', async () => {
    // Start with the decoration off (preview invisible even when paused). Push
    // the opt-in; the overlay subscribe handler MUST receive it and reveal the
    // preview against the SAME DOM node. Dropping `contextLine: s.contextLine`
    // from the subscribe payload leaves the preview invisible and fails this
    // test.
    const { getListener, emitStorageChange } = installChromeMock({
      ...DEFAULT_SETTINGS,
      contextLine: false,
    });
    await mountOverlay(getListener);
    pause();
    const preview = getPreview();
    expect(isPreviewVisible(preview)).toBe(false);

    emitStorageChange({ ...DEFAULT_SETTINGS, contextLine: true });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Same node (no remount) and now visible.
    expect(getPreview()).toBe(preview);
    expect(isPreviewVisible(preview)).toBe(true);
  });
});
