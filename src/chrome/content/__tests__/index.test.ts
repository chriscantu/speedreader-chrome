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
    type Listener = (msg: unknown, sender: { id?: string }, sendResponse: (r: unknown) => void) => unknown;
    let listener: Listener | undefined;
    (globalThis as unknown as { chrome: { runtime: { id: string; onMessage: { addListener: (l: Listener) => void } } } }).chrome
      .runtime.onMessage.addListener = (l: Listener) => {
      listener = l;
    };
    await import('../index');
    expect(listener).toBeDefined();
    const respond = vi.fn();
    listener!({ type: 'activate-reader' }, { id: 'test-ext' }, respond);
    expect(respond).toHaveBeenCalledWith({ ok: true });
    // overlay mount is async (await loadSettings); poll briefly
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-speedreader-overlay]')).toBeTruthy();
  });
});
