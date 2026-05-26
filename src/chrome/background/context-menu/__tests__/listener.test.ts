/**
 * Tests for `handleContextMenuClick` — the click → dispatch / settings
 * write / openOptionsPage adapter. Covers every `CtxMenuItemId` arm
 * plus the frame-provenance refusal (AC #18).
 *
 * `dispatchActivation`, `saveSettings`, and `loadSettings` are mocked
 * so the test surface is the listener's branching logic, not the
 * funnel or the storage layer.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../../core/settings/defaults';

vi.mock('../../activation/dispatch', () => ({
  dispatchActivation: vi.fn(() => Promise.resolve({ ok: true, data: undefined })),
}));
vi.mock('../../../settings/storage', () => ({
  saveSettings: vi.fn(() => Promise.resolve()),
  loadSettings: vi.fn(() => Promise.resolve(DEFAULT_SETTINGS)),
}));

interface TabsStub {
  sendMessage: Mock;
}
interface RuntimeStub {
  openOptionsPage: Mock;
}
interface ChromeStub {
  tabs: TabsStub;
  runtime: RuntimeStub;
}

function installChromeStub(): ChromeStub {
  const stub: ChromeStub = {
    tabs: {
      sendMessage: vi.fn(() => Promise.resolve()),
    },
    runtime: {
      openOptionsPage: vi.fn(),
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  return stub;
}

function clickInfo(
  partial: Partial<chrome.contextMenus.OnClickData>,
): chrome.contextMenus.OnClickData {
  return {
    menuItemId: 'speedreader.ctx.preset.300.v1',
    editable: false,
    pageUrl: 'https://example.com/',
    frameId: 0,
    ...partial,
  } as chrome.contextMenus.OnClickData;
}

async function importListener(): Promise<{
  handleContextMenuClick: typeof import('../listener').handleContextMenuClick;
  dispatchActivation: Mock;
  saveSettings: Mock;
  loadSettings: Mock;
}> {
  const mod = await import('../listener');
  const dispatch = (await import('../../activation/dispatch'))
    .dispatchActivation as unknown as Mock;
  const storage = await import('../../../settings/storage');
  return {
    handleContextMenuClick: mod.handleContextMenuClick,
    dispatchActivation: dispatch,
    saveSettings: storage.saveSettings as unknown as Mock,
    loadSettings: storage.loadSettings as unknown as Mock,
  };
}

const TAB = { id: 42 } as chrome.tabs.Tab;

describe('handleContextMenuClick', () => {
  let stub: ChromeStub;

  beforeEach(() => {
    stub = installChromeStub();
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.clearAllMocks();
  });

  it('preset.300 click → dispatch with overrides.wpm=300 and persists lastUsedWpm', async () => {
    const { handleContextMenuClick, dispatchActivation, saveSettings } = await importListener();
    await handleContextMenuClick(
      clickInfo({
        menuItemId: 'speedreader.ctx.preset.300.v1',
        selectionText: 'hello world',
      }),
      TAB,
    );
    expect(saveSettings).toHaveBeenCalledWith({ lastUsedWpm: 300 });
    expect(dispatchActivation).toHaveBeenCalledTimes(1);
    const intent = dispatchActivation.mock.calls[0]?.[0];
    expect(intent).toMatchObject({
      source: 'contextMenu',
      tabId: 42,
      selectionText: 'hello world',
      menuItemId: 'speedreader.ctx.preset.300.v1',
      overrides: { wpm: 300 },
    });
  });

  it('preset.500 click → dispatch with overrides.wpm=500', async () => {
    const { handleContextMenuClick, dispatchActivation, saveSettings } = await importListener();
    await handleContextMenuClick(
      clickInfo({ menuItemId: 'speedreader.ctx.preset.500.v1', selectionText: 'x' }),
      TAB,
    );
    expect(saveSettings).toHaveBeenCalledWith({ lastUsedWpm: 500 });
    expect(dispatchActivation.mock.calls[0]?.[0]).toMatchObject({
      overrides: { wpm: 500 },
    });
  });

  it('lastUsed click → reads settings and dispatches with overrides.wpm = settings.lastUsedWpm', async () => {
    const { handleContextMenuClick, dispatchActivation, loadSettings, saveSettings } =
      await importListener();
    loadSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, lastUsedWpm: 420 });
    await handleContextMenuClick(
      clickInfo({ menuItemId: 'speedreader.ctx.lastUsed.v1', selectionText: 'x' }),
      TAB,
    );
    expect(loadSettings).toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(dispatchActivation.mock.calls[0]?.[0]).toMatchObject({
      menuItemId: 'speedreader.ctx.lastUsed.v1',
      overrides: { wpm: 420 },
    });
  });

  it('custom click → openOptionsPage; NO dispatchActivation', async () => {
    const { handleContextMenuClick, dispatchActivation, saveSettings } = await importListener();
    await handleContextMenuClick(
      clickInfo({ menuItemId: 'speedreader.ctx.preset.custom.v1' }),
      TAB,
    );
    expect(stub.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    expect(dispatchActivation).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('toggle.showContext click with checked=true → saveSettings({contextLine:true}); NO dispatch', async () => {
    const { handleContextMenuClick, dispatchActivation, saveSettings } = await importListener();
    await handleContextMenuClick(
      clickInfo({
        menuItemId: 'speedreader.ctx.toggle.showContext.v1',
        checked: true,
        wasChecked: false,
      }),
      TAB,
    );
    expect(saveSettings).toHaveBeenCalledWith({ contextLine: true });
    expect(dispatchActivation).not.toHaveBeenCalled();
  });

  it('toggle.startFromWord1 click with checked=false → saveSettings({startFromWordOne:false}); NO dispatch', async () => {
    const { handleContextMenuClick, dispatchActivation, saveSettings } = await importListener();
    await handleContextMenuClick(
      clickInfo({
        menuItemId: 'speedreader.ctx.toggle.startFromWord1.v1',
        checked: false,
        wasChecked: true,
      }),
      TAB,
    );
    expect(saveSettings).toHaveBeenCalledWith({ startFromWordOne: false });
    expect(dispatchActivation).not.toHaveBeenCalled();
  });

  it('frameId !== 0 → no dispatch, no saveSettings, sends ctx-frame-blocked to the tab', async () => {
    const { handleContextMenuClick, dispatchActivation, saveSettings } = await importListener();
    await handleContextMenuClick(
      clickInfo({
        menuItemId: 'speedreader.ctx.preset.300.v1',
        selectionText: 'inside iframe',
        frameId: 17,
      }),
      TAB,
    );
    expect(dispatchActivation).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(stub.tabs.sendMessage).toHaveBeenCalledTimes(1);
    const [tabId, payload] = stub.tabs.sendMessage.mock.calls[0] ?? [];
    expect(tabId).toBe(42);
    expect(payload).toMatchObject({
      type: 'ctx-frame-blocked',
      message: 'Selection inside embedded frame; right-click the page directly',
    });
  });

  it('parent and separator IDs are no-ops (exhaustive switch coverage)', async () => {
    const { handleContextMenuClick, dispatchActivation, saveSettings } = await importListener();
    await handleContextMenuClick(clickInfo({ menuItemId: 'speedreader.ctx.parent.v1' }), TAB);
    await handleContextMenuClick(clickInfo({ menuItemId: 'speedreader.ctx.separator.v1' }), TAB);
    expect(dispatchActivation).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(stub.runtime.openOptionsPage).not.toHaveBeenCalled();
  });

  it('tab without id is a silent no-op (no dispatch, no settings write)', async () => {
    const { handleContextMenuClick, dispatchActivation, saveSettings } = await importListener();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handleContextMenuClick(
      clickInfo({ menuItemId: 'speedreader.ctx.preset.300.v1', selectionText: 'x' }),
      undefined,
    );
    expect(dispatchActivation).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
