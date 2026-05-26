import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinonChrome from 'sinon-chrome';

void sinonChrome;

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';
const FOREIGN_ID = 'foreignforeignforeignforeignforei';

interface ChromeStub {
  runtime: { id: string; getURL: (path: string) => string };
}

function installChromeStub(): ChromeStub {
  const stub: ChromeStub = {
    runtime: {
      id: OWN_ID,
      getURL: (path: string) => `chrome-extension://${OWN_ID}/${path}`,
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  return stub;
}

function popupSender(): chrome.runtime.MessageSender {
  return {
    id: OWN_ID,
    url: `chrome-extension://${OWN_ID}/src/chrome/popup/index.html`,
    // tab intentionally undefined — popup-shaped
  };
}

function contentScriptSender(tabId = 42): chrome.runtime.MessageSender {
  return {
    id: OWN_ID,
    url: 'https://example.com/article',
    tab: { id: tabId } as chrome.tabs.Tab,
    frameId: 0,
  };
}

describe('handleOnMessage — sender-provenance validation', () => {
  beforeEach(() => {
    installChromeStub();
  });
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.resetModules();
  });

  it('rejects messages from foreign sender.id without further processing', async () => {
    const { handleOnMessage } = await import('../on-message');
    const sendResponse = vi.fn();
    const route = vi.fn();

    const handled = handleOnMessage(
      { type: 'activate-reader', scope: 'full' },
      { ...popupSender(), id: FOREIGN_ID },
      sendResponse,
      { route },
    );

    expect(handled).toBe(false);
    expect(route).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: { kind: 'sender-rejected' },
    });
  });

  it('rejects messages whose sender.id is missing', async () => {
    const { handleOnMessage } = await import('../on-message');
    const sendResponse = vi.fn();
    const route = vi.fn();

    handleOnMessage(
      { type: 'activate-reader', scope: 'full' },
      { url: 'https://attacker.example' } as chrome.runtime.MessageSender,
      sendResponse,
      { route },
    );

    expect(route).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: { kind: 'sender-rejected' },
    });
  });

  it('accepts a popup-shaped sender for popup-only message types', async () => {
    const { handleOnMessage } = await import('../on-message');
    const sendResponse = vi.fn();
    const route = vi.fn();

    handleOnMessage({ type: 'activate-reader', scope: 'full' }, popupSender(), sendResponse, {
      route,
    });

    expect(route).toHaveBeenCalledTimes(1);
  });

  it('rejects a popup-only message type from a content-script-shaped sender', async () => {
    const { handleOnMessage } = await import('../on-message');
    const sendResponse = vi.fn();
    const route = vi.fn();

    handleOnMessage(
      { type: 'activate-reader', scope: 'full' },
      contentScriptSender(),
      sendResponse,
      { route },
    );

    expect(route).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: { kind: 'sender-shape-mismatch', expected: 'popup', got: 'content-script' },
    });
  });

  it('rejects a content-script-only message type from a popup-shaped sender', async () => {
    const { handleOnMessage } = await import('../on-message');
    const sendResponse = vi.fn();
    const route = vi.fn();

    handleOnMessage({ type: 'cs-progress', positionIndex: 12 }, popupSender(), sendResponse, {
      route,
    });

    expect(route).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: { kind: 'sender-shape-mismatch', expected: 'content-script', got: 'popup' },
    });
  });

  it('rejects subframe content-script senders (frameId !== 0)', async () => {
    const { handleOnMessage } = await import('../on-message');
    const sendResponse = vi.fn();
    const route = vi.fn();

    const subframeSender: chrome.runtime.MessageSender = {
      ...contentScriptSender(),
      frameId: 7,
    };

    handleOnMessage({ type: 'cs-progress', positionIndex: 1 }, subframeSender, sendResponse, {
      route,
    });

    expect(route).not.toHaveBeenCalled();
    // The subframe sender still has a `tab`, so it reports as content-script
    // by shape; the gate refuses it because `frameId !== 0` fails the
    // top-frame-only requirement.
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: { kind: 'sender-shape-mismatch', expected: 'content-script', got: 'content-script' },
    });
  });

  it('rejects malformed messages (non-object / no type)', async () => {
    const { handleOnMessage } = await import('../on-message');
    const sendResponse = vi.fn();
    const route = vi.fn();

    handleOnMessage('not an object', popupSender(), sendResponse, { route });
    handleOnMessage({ noType: true }, popupSender(), sendResponse, { route });

    expect(route).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenNthCalledWith(1, {
      ok: false,
      error: { kind: 'invalid-payload' },
    });
    expect(sendResponse).toHaveBeenNthCalledWith(2, {
      ok: false,
      error: { kind: 'invalid-payload' },
    });
  });

  it('forwards a validated message + sender to the router', async () => {
    const { handleOnMessage } = await import('../on-message');
    const sendResponse = vi.fn();
    const route = vi.fn();

    const msg = { type: 'activate-reader', scope: 'full' };
    const sender = popupSender();
    handleOnMessage(msg, sender, sendResponse, { route });

    expect(route).toHaveBeenCalledWith(msg, sender, sendResponse);
  });
});
