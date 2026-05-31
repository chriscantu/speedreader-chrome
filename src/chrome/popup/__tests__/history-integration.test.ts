/**
 * Integration tests for the popup `#history-container` wiring (issue #49).
 *
 * Asserts the chrome-glue wires the pure `renderHistorySection` to:
 *   - `loadSettings()` for the historyEnabled flag
 *   - `ReadingPositionStore.list()` for entries
 *   - `chrome.tabs.create({ url })` for resume
 *   - `store.clear(url)` for delete (and the section re-renders without it)
 *   - `store.clearAll()` for clear-all (and the section shows the empty state)
 *   - `chrome.runtime.openOptionsPage()` for the Enable link
 *
 * Anti-tautology stance:
 *   - "tabs.create was called with the right URL" (state assertion),
 *     not "tabs.create was called once".
 *   - After delete, assert the row is GONE from the DOM, not just that
 *     `store.clear` was called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrapPopup } from '../index';
import type { ReadingPositionStore } from '../../../core/storage/reading-position';

interface StoreStub extends ReadingPositionStore {
  __snapshot(): Array<{
    url: string;
    position: { wordIndex: number; totalWords: number; lastReadAt: number };
  }>;
}

function makeStoreStub(initial: Array<{ url: string; lastReadAt: number }>): StoreStub {
  // Mutable backing list — list() reads it, clear/clearAll mutate it.
  let entries = initial.map((e) => ({
    url: e.url,
    position: { wordIndex: 0, totalWords: 100, lastReadAt: e.lastReadAt },
  }));
  return {
    read: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    touch: vi.fn(async () => undefined),
    clear: vi.fn(async (url: string) => {
      entries = entries.filter((e) => e.url !== url);
    }),
    list: vi.fn(async () => entries.map((e) => ({ url: e.url, position: { ...e.position } }))),
    clearAll: vi.fn(async () => {
      entries = [];
    }),
    __snapshot: () => entries,
  };
}

function installPopupDom(): void {
  // Mirrors src/chrome/popup/index.html structure — must include
  // #history-container so the mount targets it.
  document.body.innerHTML = `
    <h1>SpeedReader</h1>
    <div class="actions">
      <button type="button" id="read-article" aria-label="Read article">Read article</button>
      <button type="button" id="read-selection" aria-label="Read selection" aria-disabled="true" disabled>Read selection</button>
    </div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
    <div id="history-container"></div>
  `;
}

interface ChromeStubOpts {
  hasSelection?: boolean;
}

function makeChromeStub(opts: ChromeStubOpts = {}): typeof chrome & {
  tabsCreate: ReturnType<typeof vi.fn>;
  openOptionsPage: ReturnType<typeof vi.fn>;
} {
  const tabsCreate = vi.fn(() => Promise.resolve(undefined));
  const openOptionsPage = vi.fn(() => Promise.resolve(undefined));
  const stub = {
    tabs: {
      query: vi.fn(() => Promise.resolve([{ id: 42 }])),
      create: tabsCreate,
    },
    scripting: {
      executeScript: vi.fn(() => Promise.resolve([{ result: opts.hasSelection ?? false }])),
    },
    runtime: {
      id: 'test-ext',
      sendMessage: vi.fn(() => Promise.resolve({ ok: true })),
      openOptionsPage,
    },
  } as unknown as typeof chrome & {
    tabsCreate: ReturnType<typeof vi.fn>;
    openOptionsPage: ReturnType<typeof vi.fn>;
  };
  stub.tabsCreate = tabsCreate;
  stub.openOptionsPage = openOptionsPage;
  return stub;
}

const NOW = 1_700_000_000_000;

beforeEach(() => {
  installPopupDom();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('bootstrapPopup — history section disabled', () => {
  it('renders the "off" message when historyEnabled is false', async () => {
    const api = makeChromeStub();
    const store = makeStoreStub([]);
    await bootstrapPopup({
      api,
      doc: document,
      loadSettings: async () => ({ historyEnabled: false }),
      store,
      now: () => NOW,
    });

    const container = document.getElementById('history-container') as HTMLElement;
    expect(container.textContent ?? '').toMatch(/Reading history is off/i);
    // No store.list() call when disabled — privacy floor.
    expect(store.list).not.toHaveBeenCalled();
  });

  it('Enable link click invokes chrome.runtime.openOptionsPage', async () => {
    const api = makeChromeStub();
    await bootstrapPopup({
      api,
      doc: document,
      loadSettings: async () => ({ historyEnabled: false }),
      store: makeStoreStub([]),
      now: () => NOW,
    });
    const enableBtn = document
      .getElementById('history-container')
      ?.querySelector('button') as HTMLButtonElement;
    enableBtn.click();
    expect(api.openOptionsPage).toHaveBeenCalledTimes(1);
  });
});

describe('bootstrapPopup — history section enabled', () => {
  it('renders entries from store.list when enabled', async () => {
    const api = makeChromeStub();
    const store = makeStoreStub([
      { url: 'https://example.com/a', lastReadAt: NOW - 30 * 60_000 },
      { url: 'https://example.com/b', lastReadAt: NOW - 2 * 86_400_000 },
    ]);
    await bootstrapPopup({
      api,
      doc: document,
      loadSettings: async () => ({ historyEnabled: true }),
      store,
      now: () => NOW,
    });

    const container = document.getElementById('history-container') as HTMLElement;
    const items = container.querySelectorAll('[role="listitem"]');
    expect(items.length).toBe(2);
    expect(container.textContent).toContain('example.com / a');
    expect(container.textContent).toContain('30m ago');
  });

  it('clicking an entry calls chrome.tabs.create with that URL', async () => {
    const api = makeChromeStub();
    const store = makeStoreStub([
      { url: 'https://example.com/article-x', lastReadAt: NOW - 60_000 },
    ]);
    await bootstrapPopup({
      api,
      doc: document,
      loadSettings: async () => ({ historyEnabled: true }),
      store,
      now: () => NOW,
    });

    const resumeBtn = document.querySelector<HTMLButtonElement>('button[data-action="resume"]');
    if (!resumeBtn) throw new Error('test: resume button missing');
    resumeBtn.click();
    expect(api.tabsCreate).toHaveBeenCalledWith({ url: 'https://example.com/article-x' });
  });

  it('clicking delete removes the row from the DOM after re-render', async () => {
    const api = makeChromeStub();
    const store = makeStoreStub([
      { url: 'https://example.com/a', lastReadAt: NOW - 60_000 },
      { url: 'https://example.com/b', lastReadAt: NOW - 120_000 },
    ]);
    await bootstrapPopup({
      api,
      doc: document,
      loadSettings: async () => ({ historyEnabled: true }),
      store,
      now: () => NOW,
    });
    expect(document.querySelectorAll('[role="listitem"]').length).toBe(2);

    const firstDelete = document.querySelector<HTMLButtonElement>(
      '[role="listitem"] button[data-action="delete"]',
    );
    if (!firstDelete) throw new Error('test: delete button missing');
    firstDelete.click();
    // Wait for the async store.clear() + remount.
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[role="listitem"]').length).toBe(1);
    });
    expect(store.clear).toHaveBeenCalledWith('https://example.com/a');
    // The REMAINING row is b, not a — observed state change, not call shape.
    expect(document.body.textContent).toContain('example.com / b');
    expect(document.body.textContent).not.toContain('example.com / a');
  });

  it('clicking Clear all (with confirm=true) wipes the list and shows the empty state', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = makeChromeStub();
    const store = makeStoreStub([{ url: 'https://example.com/a', lastReadAt: NOW - 60_000 }]);
    await bootstrapPopup({
      api,
      doc: document,
      loadSettings: async () => ({ historyEnabled: true }),
      store,
      now: () => NOW,
    });

    const clearBtn = document.querySelector<HTMLButtonElement>('button[data-action="clear-all"]');
    if (!clearBtn) throw new Error('test: clear-all button missing');
    clearBtn.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toMatch(/No articles yet/);
    });
    expect(store.clearAll).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="list"]')).toBeNull();
  });
});

describe('bootstrapPopup — history section graceful degradation', () => {
  it('settings load failure renders the disabled state, does NOT block primary buttons', async () => {
    const api = makeChromeStub();
    const store = makeStoreStub([]);
    await bootstrapPopup({
      api,
      doc: document,
      loadSettings: () => Promise.reject(new Error('storage unavailable')),
      store,
      now: () => NOW,
    });
    // History section renders the disabled state on settings failure.
    const container = document.getElementById('history-container') as HTMLElement;
    expect(container.textContent ?? '').toMatch(/Reading history is off/i);
    // Primary article button is still wired (not disabled — there IS
    // an active tab in the stub).
    const articleBtn = document.getElementById('read-article') as HTMLButtonElement;
    expect(articleBtn.disabled).toBe(false);
  });
});
