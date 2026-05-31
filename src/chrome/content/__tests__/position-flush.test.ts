/**
 * #48 — visibility / pagehide flush wiring (architect HOLD #3).
 *
 * The debounced position writer batches up to 1 s of word events. If
 * the user backgrounds the tab (`visibilitychange` → 'hidden') or
 * navigates away (`pagehide`) inside that window, the trailing-edge
 * timer never fires and the position is lost. The content script now
 * listens for both signals and forces a flush.
 *
 * Mutation safety net: removing either listener registration in
 * `index.ts` (the `addEventListener` calls under
 * `attachPositionFlushListeners`) drops these tests red — that's how
 * we know they're actually asserting on the production behaviour and
 * not just coincidentally passing.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

type Listener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void,
) => unknown;

interface ChromeRuntime {
  id: string;
  onMessage: { addListener: (l: Listener) => void };
}
interface FakeStorageLocal {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function installChromeStub(): { local: FakeStorageLocal; getListener: () => Listener } {
  const localMap = new Map<string, unknown>();
  const local: FakeStorageLocal = {
    get: vi.fn(async (keys: string[] | string | null) => {
      const keyList = Array.isArray(keys) ? keys : keys === null ? [...localMap.keys()] : [keys];
      const out: Record<string, unknown> = {};
      for (const k of keyList) if (localMap.has(k)) out[k] = structuredClone(localMap.get(k));
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) localMap.set(k, structuredClone(v));
    }),
    remove: vi.fn(async (keys: string[] | string) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) localMap.delete(k);
    }),
  };

  let captured: Listener | undefined;
  const runtime: ChromeRuntime = {
    id: 'test-ext',
    onMessage: {
      addListener: (l) => {
        captured = l;
      },
    },
  };

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime,
    storage: {
      local,
      sync: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };

  return {
    local,
    getListener: () => {
      if (!captured) throw new Error('listener not registered');
      return captured;
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '<article>alpha beta gamma delta epsilon zeta.</article>';
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'https://example.com/article-flush-test' },
  });
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('content script — visibility/pagehide flush wiring (#48)', () => {
  async function mountOverlayWithPendingWrite(): Promise<{ local: FakeStorageLocal }> {
    const { local, getListener } = installChromeStub();
    await import('../index');
    const listener = getListener();
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    // Overlay mount is async — wait for it to finish.
    await new Promise((r) => setTimeout(r, 50));

    // Drive a word-advance manually by calling the overlay's
    // engine-emit path indirectly: simplest is to drop a synthetic
    // position into the debounced-writer pending slot via the
    // exported `onWordAdvance` invocation, which fires during
    // engine.start(). We rely on the overlay having auto-started the
    // engine. Fast-forward to confirm at least one advance fires:
    await new Promise((r) => setTimeout(r, 250));

    return { local };
  }

  test('visibilitychange → hidden triggers a flush of the pending write', async () => {
    const { local } = await mountOverlayWithPendingWrite();
    local.set.mockClear();

    // Default visibilityState in jsdom is 'visible' — override it.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // The flush calls store.write → chrome.storage.local.set. Allow
    // microtasks to settle.
    await new Promise((r) => setTimeout(r, 30));

    // Expect at least one set call (position payload) — the flush
    // path writes the position record AND the LRU index.
    expect(local.set).toHaveBeenCalled();
  });

  test('visibilitychange → visible does NOT trigger a flush', async () => {
    const { local } = await mountOverlayWithPendingWrite();
    local.set.mockClear();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    await new Promise((r) => setTimeout(r, 30));

    // No flush should have happened — the only set calls would be
    // the debounced timer, which we haven't allowed to fire (250 ms
    // elapsed in mount, well under the 1 s debounce).
    expect(local.set).not.toHaveBeenCalled();
  });

  test('pagehide triggers a flush', async () => {
    const { local } = await mountOverlayWithPendingWrite();
    local.set.mockClear();

    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 30));

    expect(local.set).toHaveBeenCalled();
  });

  test('listeners detach after overlay close — removeEventListener called for both signals', async () => {
    // Spy on add/remove BEFORE the import so the content script's
    // attach calls go through the spy. Both signal types must be
    // detached on close so the content script doesn't leak handler
    // closures across mount cycles.
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const winAdd = vi.spyOn(window, 'addEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');

    const { getListener } = installChromeStub();
    await import('../index');
    const listener = getListener();
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    await new Promise((r) => setTimeout(r, 50));

    // Sanity — the attach must have happened.
    expect(docAdd).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(winAdd).toHaveBeenCalledWith('pagehide', expect.any(Function));

    // Capture the exact handler references the content script
    // attached so we can compare them to the ones it later removes.
    const visAttachCall = docAdd.mock.calls.find((c) => c[0] === 'visibilitychange');
    const hideAttachCall = winAdd.mock.calls.find((c) => c[0] === 'pagehide');
    if (!visAttachCall) throw new Error('visibilitychange attach not captured');
    if (!hideAttachCall) throw new Error('pagehide attach not captured');

    // Trigger overlay close via Escape (captured by the overlay's
    // capture-phase keydown handler on document).
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));

    // The content script must have called removeEventListener for
    // BOTH signals with the same handler references it attached.
    expect(docRemove).toHaveBeenCalledWith('visibilitychange', visAttachCall[1]);
    expect(winRemove).toHaveBeenCalledWith('pagehide', hideAttachCall[1]);

    docAdd.mockRestore();
    docRemove.mockRestore();
    winAdd.mockRestore();
    winRemove.mockRestore();
  });
});
