/**
 * Tests for `ensureContextMenu` — the chrome adapter that translates
 * the factory's `CtxItemSpec[]` into `chrome.contextMenus.create` /
 * `update` calls.
 *
 * Five cases per spec §Test Surface:
 *   (a) initial install: removeAll precedes create
 *   (b) lastUsedWpm change → update called, NOT removeAll
 *   (c) contextLine change → update called only on toggle.showContext
 *   (d) negative invariant: subscribe path NEVER calls removeAll
 *   (e) onStartup ordering: loadSettings resolves before menu install
 *
 * Uses manual `vi.fn()` stubs for `chrome.*`, matching the pattern in
 * `commands/__tests__/factory.test.ts`. `vi.mock` covers `loadSettings`
 * so the chrome.storage layer is byassed entirely.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { SettingsV5 } from '../../../../core/settings';
import { DEFAULT_SETTINGS } from '../../../../core/settings/defaults';

vi.mock('../../../settings/storage', () => ({
  loadSettings: vi.fn(),
}));

interface ContextMenusStub {
  removeAll: Mock;
  create: Mock;
  update: Mock;
}
interface ChromeStub {
  contextMenus: ContextMenusStub;
}

function installChromeStub(): ChromeStub {
  const stub: ChromeStub = {
    contextMenus: {
      removeAll: vi.fn((cb?: () => void) => {
        cb?.();
      }),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  return stub;
}

async function importFresh(): Promise<{
  ensureContextMenu: typeof import('../install').ensureContextMenu;
  __resetForTests: typeof import('../install').__resetForTests;
  loadSettings: Mock;
}> {
  const mod = await import('../install');
  const storage = await import('../../../settings/storage');
  return {
    ensureContextMenu: mod.ensureContextMenu,
    __resetForTests: mod.__resetForTests,
    loadSettings: storage.loadSettings as unknown as Mock,
  };
}

describe('ensureContextMenu', () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub();
  });

  afterEach(async () => {
    const mod = await import('../install');
    mod.__resetForTests();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.clearAllMocks();
  });

  it('(a) initial install: removeAll precedes the first create', async () => {
    const { ensureContextMenu, loadSettings } = await importFresh();
    loadSettings.mockResolvedValueOnce(DEFAULT_SETTINGS);

    await ensureContextMenu();

    expect(stub.contextMenus.removeAll).toHaveBeenCalledTimes(1);
    expect(stub.contextMenus.create).toHaveBeenCalled();
    // 8 items in the spec list → 8 create calls.
    expect(stub.contextMenus.create).toHaveBeenCalledTimes(8);

    // Order: removeAll invoked-order must be strictly before any create.
    const removeAllOrder = stub.contextMenus.removeAll.mock.invocationCallOrder[0] ?? Infinity;
    const firstCreateOrder = stub.contextMenus.create.mock.invocationCallOrder[0] ?? -1;
    expect(removeAllOrder).toBeLessThan(firstCreateOrder);
  });

  it('(b) lastUsedWpm change: update called, NOT removeAll', async () => {
    const { ensureContextMenu, loadSettings } = await importFresh();
    loadSettings.mockResolvedValueOnce(DEFAULT_SETTINGS);
    await ensureContextMenu(); // initial install

    // Reset call counts (keeping the `installed` flag from first call).
    stub.contextMenus.removeAll.mockClear();
    stub.contextMenus.create.mockClear();
    stub.contextMenus.update.mockClear();

    const nextSettings: SettingsV5 = { ...DEFAULT_SETTINGS, lastUsedWpm: 420 };
    loadSettings.mockResolvedValueOnce(nextSettings);
    await ensureContextMenu();

    expect(stub.contextMenus.removeAll).not.toHaveBeenCalled();
    expect(stub.contextMenus.create).not.toHaveBeenCalled();
    // Only one item changed (lastUsed title) → exactly one update.
    expect(stub.contextMenus.update).toHaveBeenCalledTimes(1);
    const [id, props] = stub.contextMenus.update.mock.calls[0] ?? [];
    expect(id).toBe('speedreader.ctx.lastUsed.v1');
    expect((props as { title?: string }).title).toBe('420 wpm · last used');
  });

  it('(c) contextLine change: update called only on toggle.showContext', async () => {
    const { ensureContextMenu, loadSettings } = await importFresh();
    loadSettings.mockResolvedValueOnce(DEFAULT_SETTINGS);
    await ensureContextMenu();
    stub.contextMenus.removeAll.mockClear();
    stub.contextMenus.create.mockClear();
    stub.contextMenus.update.mockClear();

    const nextSettings: SettingsV5 = { ...DEFAULT_SETTINGS, contextLine: true };
    loadSettings.mockResolvedValueOnce(nextSettings);
    await ensureContextMenu();

    expect(stub.contextMenus.update).toHaveBeenCalledTimes(1);
    const [id, props] = stub.contextMenus.update.mock.calls[0] ?? [];
    expect(id).toBe('speedreader.ctx.toggle.showContext.v1');
    expect((props as { checked?: boolean }).checked).toBe(true);
  });

  it('(d) negative invariant: subscribe path NEVER calls removeAll across multiple updates', async () => {
    const { ensureContextMenu, loadSettings } = await importFresh();
    loadSettings.mockResolvedValueOnce(DEFAULT_SETTINGS);
    await ensureContextMenu();
    stub.contextMenus.removeAll.mockClear();

    // Three independent settings broadcasts.
    loadSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, lastUsedWpm: 300 });
    await ensureContextMenu();
    loadSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, contextLine: true });
    await ensureContextMenu();
    loadSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, startFromWordOne: true });
    await ensureContextMenu();

    expect(stub.contextMenus.removeAll).not.toHaveBeenCalled();
  });

  it('(e) loadSettings resolves before chrome.contextMenus.create is invoked (AC #13)', async () => {
    const { ensureContextMenu, loadSettings } = await importFresh();

    let loadResolved = false;
    loadSettings.mockImplementationOnce(
      () =>
        new Promise<SettingsV5>((resolve) => {
          setTimeout(() => {
            loadResolved = true;
            resolve(DEFAULT_SETTINGS);
          }, 0);
        }),
    );

    // Assert before-call invariant via mock impl: throw if create runs
    // before loadResolved flips. Failure here surfaces the AC #13 break.
    stub.contextMenus.create.mockImplementation(() => {
      if (!loadResolved) {
        throw new Error('chrome.contextMenus.create called before loadSettings resolved');
      }
    });

    await ensureContextMenu();

    expect(loadResolved).toBe(true);
    expect(stub.contextMenus.create).toHaveBeenCalled();
  });
});
