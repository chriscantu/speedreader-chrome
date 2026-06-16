/**
 * #196 — visibility / pagehide flush wiring over the SW position RPC.
 *
 * The content script no longer touches `chrome.storage.local` directly (the
 * SW's `setAccessLevel('TRUSTED_CONTEXTS')` revoked CS access). Reading and
 * writing reading positions now flows through sender-bound `chrome.runtime`
 * `sendMessage` RPCs: `position/get` on mount, `position/set` on each debounced
 * advance, `position/clear` on start-over. These tests assert on those RPCs
 * instead of on `storage.local`.
 *
 * The debounced writer batches up to 1 s of word events. If the user
 * backgrounds the tab (`visibilitychange` → 'hidden') or navigates away
 * (`pagehide`) inside that window, the trailing-edge timer never fires and the
 * position is lost. The content script listens for both signals and forces a
 * flush (a `position/set`).
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

type Listener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void,
) => unknown;

type PositionMsg = { type: string; wordIndex?: number; totalWords?: number };

interface ChromeStub {
  sendMessage: ReturnType<typeof vi.fn>;
  getListener: () => Listener;
}

/**
 * Install a chrome stub whose `runtime.sendMessage` answers the position RPCs.
 * `savedRecord` is what a `position/get` resolves to (the SW-owned store's
 * answer) — `null` means "nothing persisted". `position/set` / `position/clear`
 * resolve ok and are recorded on the spy for flush assertions.
 */
function installChromeStub(savedRecord: unknown = null): ChromeStub {
  const sendMessage = vi.fn(async (msg: PositionMsg) => {
    if (msg.type === 'position/get') return { ok: true, data: savedRecord };
    return { ok: true, data: undefined };
  });

  let captured: Listener | undefined;
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test-ext',
      onMessage: {
        addListener: (l: Listener) => {
          captured = l;
        },
      },
      sendMessage,
      getURL: (path: string) => `chrome-extension://test-ext/${path}`,
    },
    storage: {
      // No `local` — the CS must not depend on it post-#196. Settings still
      // live in `sync`; the overlay mount calls loadSettings().
      sync: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };

  return {
    sendMessage,
    getListener: () => {
      if (!captured) throw new Error('listener not registered');
      return captured;
    },
  };
}

/** wordIndex of the most-recent `position/set` RPC, or undefined if none. */
function lastSetWordIndex(sendMessage: ReturnType<typeof vi.fn>): number | undefined {
  const setCalls = sendMessage.mock.calls.filter(
    (c) => (c[0] as PositionMsg | undefined)?.type === 'position/set',
  );
  const last = setCalls.length > 0 ? (setCalls[setCalls.length - 1][0] as PositionMsg) : undefined;
  return typeof last?.wordIndex === 'number' ? last.wordIndex : undefined;
}

function setCallCount(sendMessage: ReturnType<typeof vi.fn>): number {
  return sendMessage.mock.calls.filter(
    (c) => (c[0] as PositionMsg | undefined)?.type === 'position/set',
  ).length;
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

describe('content script — visibility/pagehide flush wiring (#196 RPC transport)', () => {
  async function mountOverlayWithPendingWrite(): Promise<ChromeStub> {
    const stub = installChromeStub();
    await import('../index');
    const listener = stub.getListener();
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    // Overlay mount is async — wait for it to finish.
    await new Promise((r) => setTimeout(r, 50));
    // Let the engine advance a few words (default 600 wpm → ~2-3 events).
    await new Promise((r) => setTimeout(r, 250));
    return stub;
  }

  test('visibilitychange → hidden flushes the pending write (position/set) AND cancels the debounce timer', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const stub = await mountOverlayWithPendingWrite();
    stub.sendMessage.mockClear();
    clearTimeoutSpy.mockClear();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));

    // (a) clearTimeout fired as part of the flush — the debounce timer was
    // cancelled, not raced against.
    expect(clearTimeoutSpy).toHaveBeenCalled();
    // (b) A position/set RPC carried a non-zero wordIndex — the pending write
    // actually flushed.
    expect(setCallCount(stub.sendMessage)).toBeGreaterThan(0);
    const wi = lastSetWordIndex(stub.sendMessage);
    expect(wi).toBeDefined();
    expect(wi).toBeGreaterThan(0);

    clearTimeoutSpy.mockRestore();
  });

  test('visibilitychange → visible does NOT trigger a flush', async () => {
    const stub = await mountOverlayWithPendingWrite();
    stub.sendMessage.mockClear();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));

    expect(setCallCount(stub.sendMessage)).toBe(0);
  });

  test('pagehide flushes the pending write (position/set) with the most-recent wordIndex AND cancels the timer', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const stub = await mountOverlayWithPendingWrite();
    stub.sendMessage.mockClear();
    clearTimeoutSpy.mockClear();

    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 30));

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(setCallCount(stub.sendMessage)).toBeGreaterThan(0);
    const wi = lastSetWordIndex(stub.sendMessage);
    expect(wi).toBeDefined();
    expect(wi).toBeGreaterThan(0);

    clearTimeoutSpy.mockRestore();
  });

  test('TG4 — re-mount: pagehide on second mount still flushes a position/set', async () => {
    // Pre-#196 this test asserted the flush payload carried the SECOND
    // pageUrl. The wire no longer carries any url (the SW binds it from
    // sender.url), so cross-mount url-staleness is structurally impossible —
    // there is no url to go stale. This test now asserts the weaker, still-
    // meaningful property: a full mount→close→remount→pagehide cycle flushes
    // the second mount's progress.
    const stub = installChromeStub();
    await import('../index');
    const listener = stub.getListener();

    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://example.com/first-article' },
    });
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 250));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));

    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://example.com/second-article' },
    });
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 250));

    stub.sendMessage.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 30));

    expect(setCallCount(stub.sendMessage)).toBeGreaterThan(0);
    const wi = lastSetWordIndex(stub.sendMessage);
    expect(wi).toBeDefined();
    expect(wi).toBeGreaterThan(0);
  });

  test('listeners detach after overlay close — removeEventListener called for both signals', async () => {
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    const winAdd = vi.spyOn(window, 'addEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');

    const stub = installChromeStub();
    await import('../index');
    const listener = stub.getListener();
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    await new Promise((r) => setTimeout(r, 50));

    expect(docAdd).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(winAdd).toHaveBeenCalledWith('pagehide', expect.any(Function));

    const visAttachCall = docAdd.mock.calls.find((c) => c[0] === 'visibilitychange');
    const hideAttachCall = winAdd.mock.calls.find((c) => c[0] === 'pagehide');
    if (!visAttachCall) throw new Error('visibilitychange attach not captured');
    if (!hideAttachCall) throw new Error('pagehide attach not captured');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));

    expect(docRemove).toHaveBeenCalledWith('visibilitychange', visAttachCall[1]);
    expect(winRemove).toHaveBeenCalledWith('pagehide', hideAttachCall[1]);

    docAdd.mockRestore();
    docRemove.mockRestore();
    winAdd.mockRestore();
    winRemove.mockRestore();
  });

  /**
   * ME3 (adapted) — every position RPC is sent with exactly ONE argument (the
   * message object). Guards against an accidental second (callback) argument
   * to `sendMessage`, which would change the call semantics.
   */
  test('ME3 — all position RPCs use exactly one sendMessage argument', async () => {
    const stub = await mountOverlayWithPendingWrite();

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));

    expect(stub.sendMessage).toHaveBeenCalled();
    for (const call of stub.sendMessage.mock.calls) {
      expect((call as unknown[]).length).toBe(1);
    }
  });
});

/**
 * CR2 — persistent-resume sanity guard (unchanged logic, RPC transport).
 *
 * If the saved `totalWords` diverges from the freshly-tokenized word count by
 * more than ±5%, the stored index is treated as stale and the resume is
 * skipped. The guard lives in `content/index.ts` and is unchanged by #196 —
 * only the SOURCE of the saved record moved from a `storage.local` read to a
 * `position/get` RPC response.
 *
 * OBSERVABLE: the resume toast. The overlay renders `[data-sr-resume-toast]`
 * only when it actually resumed at a saved index, and `index.ts` passes
 * `resumeToast` only when `persistentResume !== undefined` — i.e. when the CR2
 * guard honored the saved position. toast PRESENT ⇔ resume honored.
 * Mutation-validated: deleting/inverting `countDrift <= tolerance` flips the
 * relevant assertion.
 */
describe('content script — CR2 persistent-resume sanity guard (RPC transport)', () => {
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    document.body.innerHTML = '';
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
    vi.resetModules();
  });

  function getResumeToast(): HTMLElement | null {
    const host = document.body.querySelector('[data-speedreader-overlay]');
    if (!(host instanceof HTMLElement) || !host.shadowRoot) return null;
    return host.shadowRoot.querySelector('[role="status"][data-sr-resume-toast]');
  }

  async function mountWithSavedPosition(
    pageUrl: string,
    body: string,
    savedWordIndex: number,
    savedTotalWords: number,
  ): Promise<{ toast: HTMLElement | null }> {
    document.body.innerHTML = `<article>${body}</article>`;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: pageUrl },
    });
    // The SW's position/get answer carries the seeded record.
    const stub = installChromeStub({
      schemaVersion: 1,
      wordIndex: savedWordIndex,
      totalWords: savedTotalWords,
      lastReadAt: 1000,
    });
    await import('../index');
    const listener = stub.getListener();
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    // Overlay mount is async (loadSettings + position/get await).
    await new Promise((r) => setTimeout(r, 80));
    return { toast: getResumeToast() };
  }

  test('CR2 — skips resume when saved totalWords diverges by more than 5% from current count', async () => {
    // Body has 6 words. savedWordIndex=3 in-range; savedTotalWords=20 →
    // tolerance = ceil(20*0.05) = 1; drift = |20-6| = 14 (> tolerance) → SKIP.
    const { toast } = await mountWithSavedPosition(
      'https://example.com/cr2-stale-count',
      'alpha beta gamma delta epsilon zeta.',
      3,
      20,
    );
    expect(toast).toBeNull();
  });

  test('CR2 — allows resume when saved totalWords is within 5% tolerance of current count', async () => {
    // Body: 102 words. Saved: wordIndex=30, totalWords=100. tolerance=5;
    // drift=|100-102|=2 (≤ tolerance) → HONOR.
    const body = Array.from({ length: 102 }, (_, i) => `word${i}`).join(' ') + '.';
    const savedWordIndex = 30;
    const { toast } = await mountWithSavedPosition(
      'https://example.com/cr2-within-tolerance',
      body,
      savedWordIndex,
      100,
    );
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain(String(savedWordIndex));
  });

  test('CR2 — resumes when drift EXACTLY equals tolerance (pins the <=)', async () => {
    // Body: 95 words. totalWords=100 → tolerance=5; drift=|100-95|=5 == tol → HONOR.
    const body = Array.from({ length: 95 }, (_, i) => `word${i}`).join(' ') + '.';
    const savedWordIndex = 10;
    const { toast } = await mountWithSavedPosition(
      'https://example.com/cr2-drift-eq-tolerance',
      body,
      savedWordIndex,
      100,
    );
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain(String(savedWordIndex));
  });

  test('CR2 — skips resume when drift equals tolerance + 1', async () => {
    // Body: 94 words. tolerance=5; drift=|100-94|=6 == tol+1 → SKIP.
    const body = Array.from({ length: 94 }, (_, i) => `word${i}`).join(' ') + '.';
    const { toast } = await mountWithSavedPosition(
      'https://example.com/cr2-drift-over-tolerance',
      body,
      10,
      100,
    );
    expect(toast).toBeNull();
  });

  test('CR2 — tolerance uses Math.ceil: small totalWords still admits ±1 drift', async () => {
    // Reachable low-end edge: totalWords=2 → tolerance = ceil(2*0.05) = 1.
    // Body=3 words, wordIndex=1 (range guard 0 < 1 < 3 passes), drift=|2-3|=1.
    //   - ceil (correct): 1 <= 1 → HONOR → toast PRESENT
    //   - floor (mutant): 1 > 0  → SKIP   → toast absent
    const savedWordIndex = 1;
    const { toast } = await mountWithSavedPosition(
      'https://example.com/cr2-ceil-low-end',
      'word0 word1 word2.',
      savedWordIndex,
      2,
    );
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain(String(savedWordIndex));
  });
});
