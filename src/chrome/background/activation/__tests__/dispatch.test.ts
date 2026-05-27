import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ActivationIntent } from '../types';

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';

interface TabsStub {
  get: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  onRemoved: { addListener: ReturnType<typeof vi.fn> };
}
interface ScriptingStub {
  executeScript: ReturnType<typeof vi.fn>;
}
interface ChromeStub {
  runtime: { id: string };
  tabs: TabsStub;
  scripting: ScriptingStub;
}

function installChromeStub(opts: {
  tabUrl?: string;
  tabsGetRejects?: Error;
  executeScriptRejects?: Error;
  sendMessageRejects?: Error;
}): ChromeStub {
  const stub: ChromeStub = {
    runtime: { id: OWN_ID },
    tabs: {
      get: vi.fn((_tabId: number) => {
        if (opts.tabsGetRejects) return Promise.reject(opts.tabsGetRejects);
        return Promise.resolve({ url: opts.tabUrl ?? 'https://example.com' });
      }),
      sendMessage: vi.fn(() => {
        if (opts.sendMessageRejects) return Promise.reject(opts.sendMessageRejects);
        return Promise.resolve({ ok: true });
      }),
      onRemoved: { addListener: vi.fn() },
    },
    scripting: {
      executeScript: vi.fn(() => {
        if (opts.executeScriptRejects) return Promise.reject(opts.executeScriptRejects);
        return Promise.resolve([{ frameId: 0, result: undefined }]);
      }),
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  return stub;
}

describe('dispatchActivation', () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub({});
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.resetModules();
  });

  it('returns ok and injects + hands off for an allowed URL (command source)', async () => {
    const { dispatchActivation, CONTENT_SCRIPT_FILE } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'command', tabId: 42 };

    const result = await dispatchActivation(intent);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(stub.tabs.get).toHaveBeenCalledWith(42);
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);
    const callArg = stub.scripting.executeScript.mock.calls[0]?.[0] as {
      target: { tabId: number; frameIds?: unknown; allFrames?: unknown };
      files: string[];
    };
    expect(callArg.target.tabId).toBe(42);
    expect(callArg.files).toContain(CONTENT_SCRIPT_FILE);
    // Issue #135 — top-frame-only invariant. Activation injects into
    // the top frame; the dedup key is `(tabId, url)` keyed on the
    // top-level document. Setting `allFrames: true` or `frameIds: [...]`
    // here would silently break the dedup contract and let subframe
    // origin flips bypass the `tab.url` recheck. Pin both.
    expect(callArg.target).not.toHaveProperty('allFrames');
    expect(callArg.target).not.toHaveProperty('frameIds');
    // The crxjs `?script` import resolves to the BUILT filename — must be
    // `.js`, not the `.ts` source. `chrome.scripting.executeScript` runs
    // against the emitted extension, not the source tree.
    expect(CONTENT_SCRIPT_FILE.endsWith('.js')).toBe(true);
    expect(CONTENT_SCRIPT_FILE.endsWith('.ts')).toBe(false);
  });

  it('resolves CONTENT_SCRIPT_FILE to a runtime filename, never a `.ts` source path', async () => {
    const { CONTENT_SCRIPT_FILE } = await import('../dispatch');
    expect(CONTENT_SCRIPT_FILE).toMatch(/\.js$/);
  });

  it('rejects with restricted-page error for chrome:// URLs without injecting', async () => {
    stub = installChromeStub({ tabUrl: 'chrome://settings' });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'command', tabId: 1 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'restricted-page', url: 'chrome://settings' });
    expect(stub.scripting.executeScript).not.toHaveBeenCalled();
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects with restricted-page error for the Chrome Web Store', async () => {
    stub = installChromeStub({ tabUrl: 'https://chromewebstore.google.com/category/extensions' });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'popup', tabId: 7 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('restricted-page');
    expect(stub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('allows chrome-extension URLs from our own ID', async () => {
    stub = installChromeStub({ tabUrl: `chrome-extension://${OWN_ID}/popup.html` });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'popup', tabId: 9 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(true);
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('converts an executeScript rejection (TOCTOU restricted) to an inject-failed error', async () => {
    stub = installChromeStub({
      tabUrl: 'https://example.com',
      executeScriptRejects: new Error('Cannot access contents of url "chrome://settings"'),
    });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = {
      source: 'contextMenu',
      tabId: 3,
      menuItemId: 'speedreader.ctx.preset.300.v1',
    };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('inject-failed');
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('converts a tabs.get rejection to a tab-unavailable error', async () => {
    stub = installChromeStub({ tabsGetRejects: new Error('No tab with id: 999') });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'command', tabId: 999 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('tab-unavailable');
    expect(stub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('converts a tabs.sendMessage rejection to a handoff-failed error', async () => {
    stub = installChromeStub({ sendMessageRejects: new Error('Could not establish connection') });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'popup', tabId: 5 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('handoff-failed');
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('forwards selectionText presence to the handoff for contextMenu source', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = {
      source: 'contextMenu',
      tabId: 11,
      selectionText: 'hello world',
      menuItemId: 'speedreader.ctx.preset.300.v1',
    };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(true);
    expect(stub.tabs.sendMessage).toHaveBeenCalledTimes(1);
    const [tabId, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(tabId).toBe(11);
    expect(payload).toMatchObject({ type: 'activate-reader', scope: 'selection' });
  });

  // Issue #135 — frame invariant on the contextMenu dispatch source.
  // The happy-path command-source test pins target shape; this test
  // pins the same invariant on a different source so a regression
  // that adds `allFrames` to only one branch doesn't slip through.
  it('#135: contextMenu source executeScript target has no allFrames / frameIds', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = {
      source: 'contextMenu',
      tabId: 121,
      menuItemId: 'speedreader.ctx.preset.300.v1',
    };

    await dispatchActivation(intent);

    const callArg = stub.scripting.executeScript.mock.calls[0]?.[0] as {
      target: Record<string, unknown>;
    };
    expect(callArg.target).not.toHaveProperty('allFrames');
    expect(callArg.target).not.toHaveProperty('frameIds');
  });

  // Issue #135 — same invariant on the popup dispatch source.
  it('#135: popup source executeScript target has no allFrames / frameIds', async () => {
    const { dispatchActivation } = await import('../dispatch');

    await dispatchActivation({ source: 'popup', tabId: 122 });

    const callArg = stub.scripting.executeScript.mock.calls[0]?.[0] as {
      target: Record<string, unknown>;
    };
    expect(callArg.target).not.toHaveProperty('allFrames');
    expect(callArg.target).not.toHaveProperty('frameIds');
  });

  it('treats contextMenu without selectionText as full-scope', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = {
      source: 'contextMenu',
      tabId: 12,
      menuItemId: 'speedreader.ctx.preset.300.v1',
    };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(true);
    const [, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ type: 'activate-reader', scope: 'full' });
  });

  it('command and popup sources hand off full-scope', async () => {
    const { dispatchActivation } = await import('../dispatch');

    await dispatchActivation({ source: 'command', tabId: 1 });
    await dispatchActivation({ source: 'popup', tabId: 2 });

    expect(stub.tabs.sendMessage.mock.calls).toHaveLength(2);
    const [, p1] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    const [, p2] = stub.tabs.sendMessage.mock.calls[1] ?? [];
    expect(p1).toMatchObject({ type: 'activate-reader', scope: 'full' });
    expect(p2).toMatchObject({ type: 'activate-reader', scope: 'full' });
  });

  // Context-menu integration spec §"Activation Payload Extension" — preset
  // click forwards `overrides` through the funnel to the wire payload.
  it('forwards overrides for contextMenu preset clicks with selection', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = {
      source: 'contextMenu',
      tabId: 13,
      selectionText: 'hello',
      menuItemId: 'speedreader.ctx.preset.300.v1',
      overrides: { wpm: 300 },
    };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(true);
    const [, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(payload).toEqual({
      type: 'activate-reader',
      scope: 'selection',
      overrides: { wpm: 300 },
    });
  });

  // Backwards-compat: non-contextMenu sources never see an `overrides` key
  // (not even `undefined`), so payload-shape assertions in legacy callers
  // continue to hold.
  it('omits overrides key for popup source', async () => {
    const { dispatchActivation } = await import('../dispatch');

    const result = await dispatchActivation({ source: 'popup', tabId: 14 });

    expect(result.ok).toBe(true);
    const [, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(payload).not.toHaveProperty('overrides');
  });

  it('omits overrides key for command source', async () => {
    const { dispatchActivation } = await import('../dispatch');

    const result = await dispatchActivation({ source: 'command', tabId: 15 });

    expect(result.ok).toBe(true);
    const [, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(payload).not.toHaveProperty('overrides');
  });

  // contextMenu intent WITHOUT explicit overrides must also omit the key —
  // not all preset clicks supply an overrides payload (e.g., the
  // `lastUsed` item dispatches without one).
  it('omits overrides key for contextMenu intent that did not supply overrides', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = {
      source: 'contextMenu',
      tabId: 16,
      selectionText: 'hello',
      menuItemId: 'speedreader.ctx.preset.500.v1',
    };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(true);
    const [, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(payload).not.toHaveProperty('overrides');
  });

  // AC #17 funnel-level integration: dispatch forwards whatever overrides
  // it's given verbatim. Bounds-checking happens CS-side via
  // pickValidOverrides — but the funnel must not silently strip or
  // mutate the overrides object on the way out. A hostile in-process
  // caller that constructs an intent with wpm: 999999 should see the
  // value reach the wire untouched so the CS-side gate is the canonical
  // enforcement seam (single source of truth for the bounds check).
  it('AC #17: forwards out-of-bounds overrides verbatim — bounds check is CS-side', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = {
      source: 'contextMenu',
      tabId: 17,
      selectionText: 'hostile',
      menuItemId: 'speedreader.ctx.preset.300.v1',
      overrides: { wpm: 999999 },
    };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(true);
    const [, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(payload).toEqual({
      type: 'activate-reader',
      scope: 'selection',
      overrides: { wpm: 999999 },
    });
  });

  // Issue #129 — security TOCTOU. Guard runs at step 2 against URL at that
  // moment; tab may navigate to a restricted origin between guard and
  // handoff. A post-injection recheck before sendMessage MUST surface
  // `restricted-page` (the typed error for this case), not silently hand
  // off to the now-restricted page.
  it('#129: re-checks isRestricted after injection and returns restricted-page on URL flip to chrome://', async () => {
    stub = installChromeStub({});
    // First call (step 2 guard) returns allowed; second call (post-inject
    // recheck before handoff) returns restricted.
    let getCalls = 0;
    stub.tabs.get = vi.fn(() => {
      getCalls += 1;
      const url = getCalls === 1 ? 'https://example.com/article' : 'chrome://settings';
      return Promise.resolve({ url });
    });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'command', tabId: 21 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ kind: 'restricted-page', url: 'chrome://settings' });
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
    expect(stub.tabs.get).toHaveBeenCalledTimes(2);
  });

  // Issue #129 follow-up (test-gap critic H1). The post-injection
  // recheck does its own `chrome.tabs.get` — that call can reject (tab
  // closed between executeScript settle and recheck). Without this test
  // the catch branch around the second tabs.get is structurally
  // unreachable from coverage; a refactor that drops it would surface
  // as an unhandled rejection in the SW.
  it('#129: post-recheck tabs.get rejection surfaces as tab-unavailable', async () => {
    stub = installChromeStub({});
    let getCalls = 0;
    stub.tabs.get = vi.fn(() => {
      getCalls += 1;
      if (getCalls === 1) return Promise.resolve({ url: 'https://example.com/article' });
      return Promise.reject(new Error('No tab with id: 21'));
    });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'command', tabId: 21 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('tab-unavailable');
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
  });

  // Issue #129 follow-up (test-gap critic H2). The recheck threads
  // `chrome.runtime.id` into `isRestricted`. Flipping to a FOREIGN
  // `chrome-extension://` URL exercises the own-id branch of
  // `isRestricted` — a regression that passed an empty/wrong runtime
  // id would still pass the chrome:// flip case (that path ignores
  // runtime id).
  it('#129: post-recheck flip to foreign extension URL surfaces as restricted-page', async () => {
    stub = installChromeStub({});
    const FOREIGN_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    let getCalls = 0;
    stub.tabs.get = vi.fn(() => {
      getCalls += 1;
      const url =
        getCalls === 1
          ? 'https://example.com/article'
          : `chrome-extension://${FOREIGN_ID}/popup.html`;
      return Promise.resolve({ url });
    });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'command', tabId: 22 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({
      kind: 'restricted-page',
      url: `chrome-extension://${FOREIGN_ID}/popup.html`,
    });
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
