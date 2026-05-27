/**
 * Review H1 — the `chrome.runtime.onMessage` listener wiring in
 * `content/index.ts` had zero tests. The pure handler is exercised
 * elsewhere (`activate-handler.test.ts`), but a regression on the glue
 * — wrong message-type filter, dropped `sendResponse`, accidental
 * `return true` (breaks the documented synchronous-response contract),
 * missing sender auth — would not surface.
 *
 * Review H2 — sender authorization. The listener now requires
 * `sender.id === chrome.runtime.id` so messages from other extensions
 * (today: none; future: `externally_connectable` manifest changes
 * would expose this surface) cannot drive the activation gate.
 *
 * This suite captures the registered callback via the stub and drives
 * it with synthetic inputs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const OWN_ID = 'abcdefghijklmnopabcdefghijklmnop';
const FOREIGN_ID = 'foreignforeignforeignforeignfore';

interface RuntimeStub {
  id: string;
  onMessage: { addListener: ReturnType<typeof vi.fn> };
}
interface ChromeStub {
  runtime: RuntimeStub;
}

type Listener = (
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | void;

function installStub(): { stub: ChromeStub; getListener: () => Listener } {
  const stub: ChromeStub = {
    runtime: {
      id: OWN_ID,
      onMessage: { addListener: vi.fn() },
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  // `location.href` is provided by jsdom-like environments; vitest's
  // node env exposes a `globalThis.location` shim. Tests that need a
  // specific URL stash and restore it.
  return {
    stub,
    getListener: () => {
      const call = stub.runtime.onMessage.addListener.mock.calls[0];
      if (!call) throw new Error('listener not registered');
      return call[0] as Listener;
    },
  };
}

function ownSender(): chrome.runtime.MessageSender {
  return { id: OWN_ID };
}
function foreignSender(): chrome.runtime.MessageSender {
  return { id: FOREIGN_ID };
}

describe('content/index.ts — runtime.onMessage listener wiring', () => {
  let stub: ChromeStub;
  let getListener: () => Listener;
  let originalLocation: Location | undefined;

  beforeEach(() => {
    ({ stub, getListener } = installStub());
    originalLocation = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'https://example.com/article' },
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    if (originalLocation !== undefined) {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: originalLocation,
      });
    }
    vi.resetModules();
  });

  it('registers exactly one onMessage listener at module load', async () => {
    await import('../index');
    expect(stub.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  it('responds ok to activate-reader from the same extension on an allowed URL', async () => {
    await import('../index');
    const listener = getListener();
    const sendResponse = vi.fn();
    const ret = listener({ type: 'activate-reader' }, ownSender(), sendResponse);
    expect(ret).toBeUndefined(); // synchronous — must NOT return true
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  it('responds with restricted-cs when location.href is restricted', async () => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { href: 'chrome://settings' },
    });
    await import('../index');
    const listener = getListener();
    const sendResponse = vi.fn();
    listener({ type: 'activate-reader' }, ownSender(), sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ ok: false, reason: 'restricted-cs' });
  });

  it('ignores messages from a foreign extension sender (H2 sender auth)', async () => {
    await import('../index');
    const listener = getListener();
    const sendResponse = vi.fn();
    listener({ type: 'activate-reader' }, foreignSender(), sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('ignores messages of a different type from the same extension', async () => {
    await import('../index');
    const listener = getListener();
    const sendResponse = vi.fn();
    listener({ type: 'some-other-message' }, ownSender(), sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('ignores non-object messages (null, string)', async () => {
    await import('../index');
    const listener = getListener();
    const sendResponse = vi.fn();
    listener(null, ownSender(), sendResponse);
    listener('activate-reader', ownSender(), sendResponse);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
