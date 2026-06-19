import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  document.body.innerHTML = '<article>The quick brown fox.</article>';
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'test-ext', onMessage: { addListener: vi.fn() } },
    storage: {
      sync: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
});
afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
  document.body.innerHTML = '';
  vi.resetModules();
});

describe('content script wiring', () => {
  test('activate-reader success path mounts overlay host', async () => {
    type Listener = (
      msg: unknown,
      sender: { id?: string },
      sendResponse: (r: unknown) => void,
    ) => unknown;
    let listener: Listener | undefined;
    (
      globalThis as unknown as {
        chrome: { runtime: { id: string; onMessage: { addListener: (l: Listener) => void } } };
      }
    ).chrome.runtime.onMessage.addListener = (l: Listener) => {
      listener = l;
    };
    await import('../index');
    expect(listener).toBeDefined();
    if (!listener) throw new Error('listener not registered');
    const respond = vi.fn();
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, respond);
    expect(respond).toHaveBeenCalledWith({ ok: true });
    // overlay mount is async (await loadSettings); poll briefly
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-speedreader-overlay]')).toBeTruthy();
  });

  // Issue #243 — the step-5 handoff retry can deliver `activate-reader`
  // to this listener more than once (the SW retries `chrome.tabs.sendMessage`
  // on a cold-start "Could not establish connection" reject, and the first
  // attempt may in fact have arrived). Double-delivery must NOT double-mount
  // the overlay. The safety rests entirely on the CS idempotency guard
  // (`if (activeOverlay && activeOverlay.status === 'mounted') return;`):
  // mirror the real retry timing — second delivery lands AFTER the first
  // mount completes — and assert exactly one overlay host in the DOM.
  test('#243: double-delivered activate-reader mounts the overlay exactly once', async () => {
    type Listener = (
      msg: unknown,
      sender: { id?: string },
      sendResponse: (r: unknown) => void,
    ) => unknown;
    let listener: Listener | undefined;
    (
      globalThis as unknown as {
        chrome: { runtime: { id: string; onMessage: { addListener: (l: Listener) => void } } };
      }
    ).chrome.runtime.onMessage.addListener = (l: Listener) => {
      listener = l;
    };
    await import('../index');
    if (!listener) throw new Error('listener not registered');

    // First delivery — let the async mount fully settle so `activeOverlay`
    // is set to a mounted handle before the retry arrives.
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelectorAll('[data-speedreader-overlay]')).toHaveLength(1);

    // Second (retried) delivery — the `:223` guard must short-circuit before
    // a second overlay host is created.
    listener({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelectorAll('[data-speedreader-overlay]')).toHaveLength(1);
  });
});
