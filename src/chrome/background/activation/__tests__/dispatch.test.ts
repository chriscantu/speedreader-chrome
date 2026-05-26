import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinonChrome from 'sinon-chrome';
import type { ActivationIntent } from '../types';

// Touch sinon-chrome import so the dep stays explicit even though we use vi-based mocks.
void sinonChrome;

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';
const CONTENT_SCRIPT_FILE = 'src/chrome/content/index.ts';

interface TabsStub {
  get: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
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

  it('returns ok and injects + hands off for an allowed URL (commands source)', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'commands', tabId: 42 };

    const result = await dispatchActivation(intent);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(stub.tabs.get).toHaveBeenCalledWith(42);
    expect(stub.scripting.executeScript).toHaveBeenCalledTimes(1);
    const callArg = stub.scripting.executeScript.mock.calls[0]?.[0] as {
      target: { tabId: number };
      files: string[];
    };
    expect(callArg.target.tabId).toBe(42);
    expect(callArg.files).toContain(CONTENT_SCRIPT_FILE);
    expect(stub.tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('rejects with restricted-page error for chrome:// URLs without injecting', async () => {
    stub = installChromeStub({ tabUrl: 'chrome://settings' });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'commands', tabId: 1 };

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
    const intent: ActivationIntent = { source: 'contextMenu', tabId: 3 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.kind).toBe('inject-failed');
    expect(stub.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('converts a tabs.get rejection to a tab-unavailable error', async () => {
    stub = installChromeStub({ tabsGetRejects: new Error('No tab with id: 999') });
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'commands', tabId: 999 };

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
    };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(true);
    expect(stub.tabs.sendMessage).toHaveBeenCalledTimes(1);
    const [tabId, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(tabId).toBe(11);
    expect(payload).toMatchObject({ type: 'activate-reader', scope: 'selection' });
  });

  it('treats contextMenu without selectionText as full-scope', async () => {
    const { dispatchActivation } = await import('../dispatch');
    const intent: ActivationIntent = { source: 'contextMenu', tabId: 12 };

    const result = await dispatchActivation(intent);

    expect(result.ok).toBe(true);
    const [, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(payload).toMatchObject({ type: 'activate-reader', scope: 'full' });
  });

  it('commands and popup sources hand off full-scope', async () => {
    const { dispatchActivation } = await import('../dispatch');

    await dispatchActivation({ source: 'commands', tabId: 1 });
    await dispatchActivation({ source: 'popup', tabId: 2 });

    expect(stub.tabs.sendMessage.mock.calls).toHaveLength(2);
    const [, p1] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    const [, p2] = stub.tabs.sendMessage.mock.calls[1] ?? [];
    expect(p1).toMatchObject({ type: 'activate-reader', scope: 'full' });
    expect(p2).toMatchObject({ type: 'activate-reader', scope: 'full' });
  });
});
