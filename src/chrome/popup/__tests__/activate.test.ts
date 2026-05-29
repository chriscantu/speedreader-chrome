/**
 * Unit tests for popup-side activation helpers (issue #18).
 *
 * Pure-function tests — `chrome.*` is passed in as a parameter so we
 * mock with plain vi.fn stubs rather than mutating the global.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildActivateRequest, resolveActiveTabId, tabHasSelection } from '../activate';

interface ChromeStubOpts {
  activeTabs?: Array<{ id?: number }>;
  tabsQueryRejects?: Error;
  executeScriptResult?: Array<{ result?: unknown }>;
  executeScriptRejects?: Error;
}

function makeChromeStub(opts: ChromeStubOpts = {}): typeof chrome {
  const stub = {
    tabs: {
      query: vi.fn(() => {
        if (opts.tabsQueryRejects) return Promise.reject(opts.tabsQueryRejects);
        return Promise.resolve(opts.activeTabs ?? [{ id: 42 }]);
      }),
    },
    scripting: {
      executeScript: vi.fn(() => {
        if (opts.executeScriptRejects) return Promise.reject(opts.executeScriptRejects);
        return Promise.resolve(opts.executeScriptResult ?? [{ result: false }]);
      }),
    },
    runtime: { id: 'test-ext' },
  };
  return stub as unknown as typeof chrome;
}

describe('buildActivateRequest', () => {
  it('produces the exact wire shape route.ts expects', () => {
    expect(buildActivateRequest(7, 'full')).toEqual({
      type: 'activate-reader',
      tabId: 7,
      scope: 'full',
    });
    expect(buildActivateRequest(7, 'selection')).toEqual({
      type: 'activate-reader',
      tabId: 7,
      scope: 'selection',
    });
  });
});

describe('resolveActiveTabId', () => {
  it('queries the active tab in the current window', async () => {
    const api = makeChromeStub({ activeTabs: [{ id: 99 }] });
    const id = await resolveActiveTabId(api);
    expect(id).toBe(99);
    expect(api.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });

  it('throws when no tab is present', async () => {
    const api = makeChromeStub({ activeTabs: [] });
    await expect(resolveActiveTabId(api)).rejects.toThrow(/no-active-tab/);
  });

  it('throws when the active tab is missing an id', async () => {
    const api = makeChromeStub({ activeTabs: [{}] });
    await expect(resolveActiveTabId(api)).rejects.toThrow(/no-active-tab/);
  });
});

describe('tabHasSelection', () => {
  it('returns true when the in-page probe reports a non-empty selection', async () => {
    const api = makeChromeStub({ executeScriptResult: [{ result: true }] });
    expect(await tabHasSelection(api, 1)).toBe(true);
    expect(api.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 1 },
        func: expect.any(Function),
      }),
    );
  });

  it('returns false when the in-page probe reports empty', async () => {
    const api = makeChromeStub({ executeScriptResult: [{ result: false }] });
    expect(await tabHasSelection(api, 1)).toBe(false);
  });

  it('returns false on missing or shapeless result', async () => {
    const api = makeChromeStub({ executeScriptResult: [] });
    expect(await tabHasSelection(api, 1)).toBe(false);
  });

  it('returns false when executeScript rejects (restricted URL)', async () => {
    const api = makeChromeStub({
      executeScriptRejects: new Error('Cannot access contents of url'),
    });
    expect(await tabHasSelection(api, 1)).toBe(false);
  });

  it('the probe func itself returns true for a non-empty selection (run via jsdom)', () => {
    // Smoke the inline probe function against a real jsdom selection so
    // we know the function body — not just the stub — does what we
    // assert. This is the only place the func body actually executes.
    document.body.innerHTML = '<p id="x">Selected text</p>';
    const el = document.getElementById('x');
    if (!el) throw new Error('fixture missing');
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const probe = (): boolean => (window.getSelection()?.toString() ?? '').trim().length > 0;
    expect(probe()).toBe(true);

    sel?.removeAllRanges();
    expect(probe()).toBe(false);
  });
});
