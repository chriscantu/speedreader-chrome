import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { ActivationError, ActivationIntent, Result } from '../../activation/types';

type DispatchMock = Mock<(intent: ActivationIntent) => Promise<Result<void, ActivationError>>>;

/**
 * Tests for the `chrome.commands.onCommand` listener factory.
 *
 * The listener is wrapped in a `registerCommands(deps)` factory so the
 * `dispatchActivation` call can be injected. The default export of
 * `./index` calls the factory with the real `dispatchActivation` at
 * module top-level (the MV3 invariant: addListener BEFORE any await).
 *
 * Establishes the same chrome-stub pattern used in
 * `src/chrome/background/activation/__tests__/dispatch.test.ts` — manual
 * vitest mocks; no `sinon-chrome` despite the dev-dep being present.
 */

interface CommandsStub {
  onCommand: {
    addListener: ReturnType<typeof vi.fn>;
    // Stash the registered listener so tests can invoke it directly.
    _listener?: (command: string, tab?: chrome.tabs.Tab) => void;
  };
}

interface TabsStub {
  query: ReturnType<typeof vi.fn>;
}

interface ChromeStub {
  commands: CommandsStub;
  tabs: TabsStub;
}

function installChromeStub(opts: {
  activeTabId?: number;
  queryReturnsEmpty?: boolean;
}): ChromeStub {
  const stub: ChromeStub = {
    commands: {
      onCommand: {
        addListener: vi.fn((cb: (command: string, tab?: chrome.tabs.Tab) => void) => {
          stub.commands.onCommand._listener = cb;
        }),
      },
    },
    tabs: {
      query: vi.fn(() => {
        if (opts.queryReturnsEmpty) return Promise.resolve([]);
        return Promise.resolve([{ id: opts.activeTabId ?? 7 }]);
      }),
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
  return stub;
}

describe('registerCommands', () => {
  let stub: ChromeStub;
  let dispatch: DispatchMock;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stub = installChromeStub({});
    dispatch = vi.fn(() => Promise.resolve({ ok: true, data: undefined }));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    warnSpy.mockRestore();
    vi.resetModules();
  });

  it('registers a single onCommand listener', async () => {
    const { registerCommands } = await import('../index');
    registerCommands({ dispatch });
    expect(stub.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
  });

  it('dispatches a command intent when chrome provides the tab', async () => {
    const { registerCommands } = await import('../index');
    registerCommands({ dispatch });

    const tab = { id: 42 } as chrome.tabs.Tab;
    await stub.commands.onCommand._listener?.('_toggle_reader', tab);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const intent = dispatch.mock.calls[0]?.[0] as ActivationIntent;
    expect(intent).toEqual({ source: 'command', tabId: 42 });
    expect(stub.tabs.query).not.toHaveBeenCalled();
  });

  it('falls back to tabs.query when chrome omits the tab argument', async () => {
    stub = installChromeStub({ activeTabId: 99 });
    const { registerCommands } = await import('../index');
    registerCommands({ dispatch });

    await stub.commands.onCommand._listener?.('_toggle_reader');

    expect(stub.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const intent = dispatch.mock.calls[0]?.[0] as ActivationIntent;
    expect(intent).toEqual({ source: 'command', tabId: 99 });
  });

  it('falls back to tabs.query when the tab argument has no id', async () => {
    stub = installChromeStub({ activeTabId: 13 });
    const { registerCommands } = await import('../index');
    registerCommands({ dispatch });

    // chrome can in theory pass a tab without an id (devtools, headless); the
    // fallback must still kick in.
    await stub.commands.onCommand._listener?.('_toggle_reader', {} as chrome.tabs.Tab);

    expect(stub.tabs.query).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const intent = dispatch.mock.calls[0]?.[0] as ActivationIntent;
    expect(intent).toEqual({ source: 'command', tabId: 13 });
  });

  it('warns and does not dispatch when no active tab can be resolved', async () => {
    stub = installChromeStub({ queryReturnsEmpty: true });
    const { registerCommands } = await import('../index');
    registerCommands({ dispatch });

    await stub.commands.onCommand._listener?.('_toggle_reader');

    expect(dispatch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('[SpeedReader]');
  });

  it('ignores commands other than _toggle_reader', async () => {
    const { registerCommands } = await import('../index');
    registerCommands({ dispatch });

    await stub.commands.onCommand._listener?.('_some_future_command', { id: 1 } as chrome.tabs.Tab);

    expect(dispatch).not.toHaveBeenCalled();
    expect(stub.tabs.query).not.toHaveBeenCalled();
  });

  it('warns but does not throw when dispatch returns a restricted-page error', async () => {
    dispatch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        error: { kind: 'restricted-page', url: 'chrome://settings' },
      }),
    );
    const { registerCommands } = await import('../index');
    registerCommands({ dispatch });

    await expect(
      stub.commands.onCommand._listener?.('_toggle_reader', { id: 1 } as chrome.tabs.Tab),
    ).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    const msg = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('[SpeedReader]');
    expect(msg).toContain('restricted-page');
  });

  it('warns but does not throw when dispatch itself rejects', async () => {
    dispatch = vi.fn(() => Promise.reject(new Error('boom')));
    const { registerCommands } = await import('../index');
    registerCommands({ dispatch });

    await expect(
      stub.commands.onCommand._listener?.('_toggle_reader', { id: 1 } as chrome.tabs.Tab),
    ).resolves.not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
  });
});
