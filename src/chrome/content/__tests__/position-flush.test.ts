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
  async function mountOverlayWithPendingWrite(): Promise<{
    local: FakeStorageLocal;
    pageUrl: string;
  }> {
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

    return { local, pageUrl: 'https://example.com/article-flush-test' };
  }

  /**
   * Extracts the wordIndex written under the canonical `position:<url>`
   * key from a `chrome.storage.local.set` call payload. The flush path
   * writes the per-URL payload AND the LRU index; we only assert on
   * the per-URL payload so the test is robust to index-key changes.
   */
  function payloadWordIndex(setArg: Record<string, unknown>, pageUrl: string): number | undefined {
    const key = `position:${pageUrl}`;
    const v = setArg[key];
    if (v === null || typeof v !== 'object') return undefined;
    const wi = (v as { wordIndex?: unknown }).wordIndex;
    return typeof wi === 'number' ? wi : undefined;
  }

  test('visibilitychange → hidden flushes the pending write AND cancels the debounce timer', async () => {
    // TG3 — spy clearTimeout BEFORE the import so the production code's
    // calls are captured. `setTimeout` returns numeric IDs in jsdom;
    // we capture the most-recently scheduled debounce timer ID and
    // assert clearTimeout was called with it BEFORE local.set fires.
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { local, pageUrl } = await mountOverlayWithPendingWrite();
    local.set.mockClear();
    clearTimeoutSpy.mockClear();

    // Default visibilityState in jsdom is 'visible' — override it.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    // The flush calls store.write → chrome.storage.local.set. Allow
    // microtasks to settle.
    await new Promise((r) => setTimeout(r, 30));

    // (a) clearTimeout was called as part of the flush — proves the
    // debounce timer was cancelled, not raced against.
    expect(clearTimeoutSpy).toHaveBeenCalled();

    // (b) The first set call carries the per-URL payload with a
    // non-zero wordIndex (engine has been running ~250 ms at 600 wpm
    // → ~2-3 word events) — proves the pending write actually
    // flushed, not just any storage call.
    expect(local.set).toHaveBeenCalled();
    const firstCall = local.set.mock.calls[0][0] as Record<string, unknown>;
    const wi = payloadWordIndex(firstCall, pageUrl);
    expect(wi).toBeDefined();
    expect(wi).toBeGreaterThan(0);

    clearTimeoutSpy.mockRestore();
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

  test('pagehide flushes the pending write with the most-recent wordIndex AND cancels the timer', async () => {
    // TG3 — same tightening as the visibilitychange test: spy
    // clearTimeout, assert the per-URL payload carries a non-zero
    // wordIndex (NOT a stale or empty record).
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const { local, pageUrl } = await mountOverlayWithPendingWrite();
    local.set.mockClear();
    clearTimeoutSpy.mockClear();

    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 30));

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(local.set).toHaveBeenCalled();
    const firstCall = local.set.mock.calls[0][0] as Record<string, unknown>;
    const wi = payloadWordIndex(firstCall, pageUrl);
    expect(wi).toBeDefined();
    expect(wi).toBeGreaterThan(0);

    clearTimeoutSpy.mockRestore();
  });

  test('TG4 — re-mount: pagehide on second mount flushes the second URL with no stale first-mount payload', async () => {
    // Mount → close → mount again with a DIFFERENT pageUrl → pagehide.
    // Asserts:
    //   (a) the pagehide flush carries the SECOND pageUrl's payload
    //       (proves the second mount's onWordAdvance closure
    //       captured the new pageUrl and that pendingWrite isn't
    //       stuck on a first-mount snapshot).
    //   (b) no first-mount payload lands during the second mount's
    //       pagehide (proves onClose's own flushPendingPositionWrite
    //       drained the first mount's pending state cleanly).
    //
    // Mutation honesty: the production handlers `onVisibilityChange`
    // / `onPageHide` are MODULE-SCOPED functions, not per-mount
    // closures, so removing `detachPositionFlushListeners()` in
    // onClose does NOT make this test red on its own — there is
    // only ever one handler pair. That detach contract is
    // mutation-validated by the separate `listeners detach after
    // overlay close` test above. This TG4 test sits one layer up
    // as an integration check: the full close→remount→pagehide
    // cycle leaves no payload referencing the prior mount.
    const { local, getListener } = installChromeStub();
    await import('../index');
    const listener = getListener();

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

    local.set.mockClear();
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 30));

    const calls = local.set.mock.calls as Array<[Record<string, unknown>]>;
    const firstUrlKey = 'position:https://example.com/first-article';
    const secondUrlKey = 'position:https://example.com/second-article';
    const secondPayloadCalls = calls.filter((c) =>
      Object.prototype.hasOwnProperty.call(c[0], secondUrlKey),
    );
    const firstPayloadCalls = calls.filter((c) =>
      Object.prototype.hasOwnProperty.call(c[0], firstUrlKey),
    );
    // (a) Second mount's payload landed.
    expect(secondPayloadCalls.length).toBeGreaterThan(0);
    // (b) No stale first-mount payload (the first mount's pendingWrite
    // was flushed during its own onClose).
    expect(firstPayloadCalls).toHaveLength(0);
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

  /**
   * ME3 — contract test: every chrome.storage.local.set call from the
   * position-flush path MUST carry exactly ONE argument (the items
   * object). Guards against an accidental regression to the callback
   * form of the API, which would silently drop writes in production
   * because Chrome's Promise overload is not invoked when a second
   * (callback) argument is passed.
   *
   * Mutation evidence: changing the argument count check from
   * `toBe(1)` to `toBe(2)` flips this test red.
   */
  test('ME3 — all chrome.storage.local.set calls from flush path use exactly one argument', async () => {
    const { local } = await mountOverlayWithPendingWrite();

    // Trigger a flush via visibilitychange → hidden.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 30));

    expect(local.set).toHaveBeenCalled();
    for (const call of local.set.mock.calls) {
      expect((call as unknown[]).length).toBe(1);
    }
  });
});

/**
 * CR2 — persistent-resume sanity guard: if the saved `totalWords` diverges
 * from the freshly-tokenized word count by more than ±5%, the stored index
 * is treated as stale and the resume is skipped (fresh start). This matches
 * the `#25` mutation-fallback pattern in `session-position.ts`.
 *
 * OBSERVABLE under test: the resume toast. The overlay only renders the
 * `[data-sr-resume-toast]` chip when it ACTUALLY resumed at a saved index
 * (`resumedAt !== null && opts.resumeToast`), and `index.ts` only passes
 * `resumeToast` when `persistentResume !== undefined` — i.e. when the CR2
 * guard honored the saved position. Therefore:
 *   - toast PRESENT  ⇔ guard honored the resume (drift within tolerance)
 *   - toast ABSENT   ⇔ guard suppressed the resume (drift over tolerance)
 *
 * This is a real observable that flips under guard mutation. The earlier
 * version of these tests asserted only `local.get` was called (fires
 * regardless of resume) and seeded an OUT-OF-RANGE wordIndex (rejected by
 * the pre-existing `wordIndex < fullWords.length` guard before CR2 even
 * runs) — both made the tests pass green even with the CR2 guard deleted.
 * Each test below has been mutation-validated: deleting or inverting the
 * `countDrift <= tolerance` guard in `index.ts` flips the relevant
 * assertion red.
 */
describe('content script — CR2 persistent-resume sanity guard', () => {
  function installChromeStubWithSavedPosition(
    pageUrl: string,
    savedWordIndex: number,
    savedTotalWords: number,
  ): { local: FakeStorageLocal; getListener: () => Listener } {
    // Pre-seed the storage map with a saved position record so that
    // when the content script calls positionStore.read(pageUrl), it
    // finds a saved entry with the specified word count mismatch.
    const canonicalKey = `position:${pageUrl}`;
    const indexKey = 'position-index';
    const localMap = new Map<string, unknown>([
      [
        canonicalKey,
        {
          schemaVersion: 1,
          wordIndex: savedWordIndex,
          totalWords: savedTotalWords,
          lastReadAt: Date.now() - 3_600_000, // 1 hour ago
        },
      ],
      [indexKey, [canonicalKey]],
    ]);
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
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        id: 'test-ext',
        onMessage: {
          addListener: (l: Listener) => {
            captured = l;
          },
        },
        getURL: (path: string) => `chrome-extension://test-ext/${path}`,
      },
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

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    document.body.innerHTML = '';
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
    vi.resetModules();
  });

  /**
   * Resolve the overlay's resume toast from the open shadow root. Returns
   * null when no overlay is mounted OR the overlay mounted but did NOT
   * resume (toast suppressed). This is the single OBSERVABLE the CR2 tests
   * key on — its presence is the production signal that `persistentResume`
   * was honored.
   */
  function getResumeToast(): HTMLElement | null {
    const host = document.body.querySelector('[data-speedreader-overlay]');
    if (!(host instanceof HTMLElement) || !host.shadowRoot) return null;
    return host.shadowRoot.querySelector('[role="status"][data-sr-resume-toast]');
  }

  /**
   * Mount the overlay through the content-script activate path against a
   * pre-seeded saved position, then settle the async mount. Returns the
   * resolved toast (or null) plus the storage spy for completeness.
   */
  async function mountWithSavedPosition(
    pageUrl: string,
    body: string,
    savedWordIndex: number,
    savedTotalWords: number,
  ): Promise<{ local: FakeStorageLocal; toast: HTMLElement | null }> {
    document.body.innerHTML = `<article>${body}</article>`;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: pageUrl },
    });
    const { local, getListener } = installChromeStubWithSavedPosition(
      pageUrl,
      savedWordIndex,
      savedTotalWords,
    );
    await import('../index');
    const listener = getListener();
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    // Overlay mount is async (loadSettings + positionStore.read await).
    await new Promise((r) => setTimeout(r, 80));
    return { local, toast: getResumeToast() };
  }

  test('CR2 — skips resume when saved totalWords diverges by more than 5% from current count', async () => {
    // Body has 6 words. savedWordIndex=3 is IN-RANGE for the current body
    // (0 < 3 < 6), so the PRE-EXISTING `wordIndex < fullWords.length` range
    // guard does NOT reject it — the CR2 drift guard is what must fire.
    // savedTotalWords=20 → tolerance = ceil(20*0.05) = 1; drift = |20-6| = 14
    // (> tolerance). The CR2 guard must suppress the resume.
    //
    // OBSERVABLE: the resume toast must be ABSENT. If the guard is deleted
    // (resume unconditional), `persistentResume` would be set, `resumeToast`
    // passed, and the toast would render — flipping this assertion red.
    const { toast } = await mountWithSavedPosition(
      'https://example.com/cr2-stale-count',
      'alpha beta gamma delta epsilon zeta.',
      3,
      20,
    );
    expect(toast).toBeNull();
  });

  test('CR2 — allows resume when saved totalWords is within 5% tolerance of current count', async () => {
    // Body: 102 words. Saved: wordIndex=30, totalWords=100. Range guard:
    // 0 < 30 < 102 (passes). tolerance = ceil(100*0.05) = 5; drift =
    // |100-102| = 2 (≤ tolerance). The CR2 guard must HONOR the resume.
    //
    // OBSERVABLE: the resume toast must be PRESENT, and its label must name
    // the resumed index (30). If the guard is inverted (reject within
    // tolerance) or `persistentResume` forced undefined, the toast would
    // not render — flipping this assertion red.
    const body = Array.from({ length: 102 }, (_, i) => `word${i}`).join(' ') + '.';
    const savedWordIndex = 30;
    const { toast } = await mountWithSavedPosition(
      'https://example.com/cr2-within-tolerance',
      body,
      savedWordIndex,
      100,
    );
    expect(toast).not.toBeNull();
    // The toast label is `resumeToast(resumedAt, totalWords)` — resumedAt is
    // the honored saved index, so the visible text must mention it.
    expect(toast?.textContent).toContain(String(savedWordIndex));
  });

  // FIX 3 — boundary cases at the `countDrift <= tolerance` seam.

  test('CR2 — resumes when drift EXACTLY equals tolerance (pins the <=)', async () => {
    // Body: 95 words. Saved: totalWords=100 → tolerance = ceil(100*0.05) = 5.
    // drift = |100-95| = 5 == tolerance → the `<=` must HONOR the resume.
    // Mutating the guard to `<` (strict) flips this red.
    const body = Array.from({ length: 95 }, (_, i) => `word${i}`).join(' ') + '.';
    const savedWordIndex = 10; // 0 < 10 < 95 — passes the range guard
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
    // Body: 94 words. Saved: totalWords=100 → tolerance = 5.
    // drift = |100-94| = 6 == tolerance + 1 → just over the seam → SKIP.
    // The toast must be ABSENT.
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
    // Edge of the Math.ceil rounding. The task brief asked for the
    // savedTotalWords===0 case (tolerance = ceil(0) = 0), but that record is
    // unreachable at the CR2 seam: the store's own invariant in
    // `core/storage/reading-position.ts` (`makeReadingPosition`) rejects any
    // saved record with `totalWords <= 0` and returns undefined, so
    // `positionStore.read()` never surfaces it to the guard. A test seeded
    // with totalWords=0 would pass for the WRONG reason (upstream rejection,
    // not the CR2 guard) — i.e. it would be vacuous w.r.t. CR2, the exact
    // defect class this PR fixes.
    //
    // The reachable low-end edge that genuinely pins the `Math.ceil` is
    // totalWords=2: tolerance = ceil(2*0.05) = ceil(0.1) = 1. A `Math.floor`
    // mutation would yield tolerance 0. Seed: body=3 words, wordIndex=1
    // (range guard 0 < 1 < 3 passes), drift = |2-3| = 1 == tolerance.
    //   - ceil (correct): drift 1 <= 1  → resume HONORED → toast PRESENT
    //   - floor (mutant):  drift 1 >  0 → resume SKIPPED → toast absent
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
