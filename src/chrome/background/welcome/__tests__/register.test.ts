/**
 * Welcome trigger — top-level chrome.runtime.onInstalled listener.
 *
 * Pins:
 *  - listener registered exactly once on module import (MV3 SW invariant;
 *    see `2026-05-22-sw-lifecycle-activation.md` §"Listener Registration
 *    Discipline")
 *  - reason === 'install' → chrome.tabs.create({ url: welcome.html })
 *  - all other reasons → no-op (matrix owned by sw-lifecycle spec; this
 *    module owns only the positive case per spec line 86)
 *
 * See docs/superpowers/specs/2026-05-30-onboarding-surface.md §"Install Trigger".
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

interface ChromeStub {
  runtime: {
    onInstalled: { addListener: Mock };
    getURL: Mock;
  };
  tabs: {
    create: Mock;
  };
}

function installChromeStub(): ChromeStub {
  const stub: ChromeStub = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      getURL: vi.fn((p: string) => `chrome-extension://AAA/${p}`),
    },
    tabs: {
      create: vi.fn(() => Promise.resolve()),
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  return stub;
}

type InstalledHandler = (details: chrome.runtime.InstalledDetails) => void;

describe('background/welcome/register (side-effect import)', () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub();
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.clearAllMocks();
  });

  it('registers chrome.runtime.onInstalled exactly once on module load', async () => {
    await import('../register');
    expect(stub.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
  });

  it('opens welcome.html on reason="install"', async () => {
    await import('../register');
    const handler = stub.runtime.onInstalled.addListener.mock.calls[0]?.[0] as InstalledHandler;
    expect(typeof handler).toBe('function');
    handler({ reason: 'install' } as chrome.runtime.InstalledDetails);
    expect(stub.runtime.getURL).toHaveBeenCalledWith('welcome.html');
    expect(stub.tabs.create).toHaveBeenCalledTimes(1);
    expect(stub.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://AAA/welcome.html',
    });
  });

  it('no-ops on reason="update"', async () => {
    await import('../register');
    const handler = stub.runtime.onInstalled.addListener.mock.calls[0]?.[0] as InstalledHandler;
    handler({
      reason: 'update',
      previousVersion: '0.0.1',
    } as chrome.runtime.InstalledDetails);
    expect(stub.tabs.create).not.toHaveBeenCalled();
  });

  it('no-ops on reason="chrome_update"', async () => {
    await import('../register');
    const handler = stub.runtime.onInstalled.addListener.mock.calls[0]?.[0] as InstalledHandler;
    handler({ reason: 'chrome_update' } as chrome.runtime.InstalledDetails);
    expect(stub.tabs.create).not.toHaveBeenCalled();
  });

  it('no-ops on reason="shared_module_update"', async () => {
    await import('../register');
    const handler = stub.runtime.onInstalled.addListener.mock.calls[0]?.[0] as InstalledHandler;
    handler({ reason: 'shared_module_update' } as chrome.runtime.InstalledDetails);
    expect(stub.tabs.create).not.toHaveBeenCalled();
  });
});
