/**
 * Pins AC #19: top-level synchronous listener registration. Module
 * load alone is the install step — no exported `register()` call. The
 * test asserts that the four `addListener` calls happen as side effects
 * of `await import('../register')`, before any user code runs.
 *
 * Why this matters: a listener registered inside an async callback
 * after the first `await` is invisible to Chrome on subsequent SW
 * wakes — per `docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`
 * §"Listener Registration Discipline".
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

vi.mock('../listener', () => ({
  handleContextMenuClick: vi.fn(() => Promise.resolve()),
}));
vi.mock('../install', () => ({
  ensureContextMenu: vi.fn(() => Promise.resolve()),
  __resetForTests: vi.fn(),
}));
vi.mock('../../../settings/storage', () => ({
  subscribeSettings: vi.fn(() => () => undefined),
}));

interface ChromeStub {
  contextMenus: { onClicked: { addListener: Mock } };
  runtime: {
    onInstalled: { addListener: Mock };
    onStartup: { addListener: Mock };
  };
}

function installChromeStub(): ChromeStub {
  const stub: ChromeStub = {
    contextMenus: {
      onClicked: { addListener: vi.fn() },
    },
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  return stub;
}

describe('context-menu/register (side-effect import)', () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub();
    vi.resetModules(); // ensure the side-effect re-runs per test
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.clearAllMocks();
  });

  it('registers chrome.contextMenus.onClicked exactly once on module load', async () => {
    await import('../register');
    expect(stub.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(1);
  });

  it('registers chrome.runtime.onInstalled', async () => {
    await import('../register');
    expect(stub.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
  });

  it('registers chrome.runtime.onStartup', async () => {
    await import('../register');
    expect(stub.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
  });

  it('calls subscribeSettings exactly once on module load', async () => {
    await import('../register');
    const storage = await import('../../../settings/storage');
    const subscribeSettings = storage.subscribeSettings as unknown as Mock;
    expect(subscribeSettings).toHaveBeenCalledTimes(1);
  });
});
