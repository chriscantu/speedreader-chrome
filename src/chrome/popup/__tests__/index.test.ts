/**
 * Popup DOM bootstrap tests (issue #18).
 *
 * Exercises `bootstrapPopup` against a jsdom document built from the
 * production popup HTML structure. `chrome.*` is stubbed so we can
 * assert the runtime.sendMessage payload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrapPopup } from '../index';

interface ChromeStubOpts {
  activeTabs?: Array<{ id?: number }>;
  hasSelection?: boolean;
  selectionProbeRejects?: Error;
  sendMessageResponse?: unknown;
  sendMessageRejects?: Error;
}

type SendMessageMock = ReturnType<typeof vi.fn>;
type ExecuteScriptMock = ReturnType<typeof vi.fn>;

interface PopupChromeStub {
  api: typeof chrome;
  sendMessage: SendMessageMock;
  executeScript: ExecuteScriptMock;
}

function makeChromeStub(opts: ChromeStubOpts = {}): PopupChromeStub {
  const sendMessage: SendMessageMock = vi.fn(() => {
    if (opts.sendMessageRejects) return Promise.reject(opts.sendMessageRejects);
    return Promise.resolve(opts.sendMessageResponse ?? { ok: true, data: undefined });
  });
  const executeScript: ExecuteScriptMock = vi.fn(() => {
    if (opts.selectionProbeRejects) return Promise.reject(opts.selectionProbeRejects);
    return Promise.resolve([{ result: opts.hasSelection ?? false }]);
  });
  const api = {
    tabs: {
      query: vi.fn(() => Promise.resolve(opts.activeTabs ?? [{ id: 42 }])),
    },
    scripting: { executeScript },
    runtime: { id: 'test-ext', sendMessage },
  } as unknown as typeof chrome;
  return { api, sendMessage, executeScript };
}

function installPopupDom(): void {
  document.body.innerHTML = `
    <h1>SpeedReader</h1>
    <div class="actions">
      <button type="button" id="read-article" class="action action--primary"
        aria-label="Read article">Read article</button>
      <button type="button" id="read-selection" class="action action--secondary"
        aria-label="Read selection" aria-disabled="true" disabled>Read selection</button>
    </div>
    <div class="status" id="status" role="status" aria-live="polite"></div>
  `;
}

function getButtons(): {
  article: HTMLButtonElement;
  selection: HTMLButtonElement;
  status: HTMLElement;
} {
  return {
    article: document.getElementById('read-article') as HTMLButtonElement,
    selection: document.getElementById('read-selection') as HTMLButtonElement,
    status: document.getElementById('status') as HTMLElement,
  };
}

describe('bootstrapPopup — selection probe gating', () => {
  beforeEach(() => {
    installPopupDom();
    // Stub window.close so the success-path setTimeout doesn't bomb in jsdom.
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('enables Read selection when the probe returns true', async () => {
    const { api } = makeChromeStub({ hasSelection: true });
    await bootstrapPopup({ api, doc: document });
    const { article, selection } = getButtons();
    expect(article.disabled).toBe(false);
    expect(selection.disabled).toBe(false);
    expect(selection.getAttribute('aria-disabled')).toBe('false');
  });

  it('keeps Read selection disabled when the probe returns false', async () => {
    const { api } = makeChromeStub({ hasSelection: false });
    await bootstrapPopup({ api, doc: document });
    const { article, selection } = getButtons();
    expect(article.disabled).toBe(false);
    expect(selection.disabled).toBe(true);
    expect(selection.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps Read selection disabled when the probe rejects (restricted URL)', async () => {
    const { api } = makeChromeStub({
      selectionProbeRejects: new Error('Cannot access contents'),
    });
    await bootstrapPopup({ api, doc: document });
    const { article, selection } = getButtons();
    expect(article.disabled).toBe(false);
    expect(selection.disabled).toBe(true);
  });

  it('disables Read article and surfaces status when no active tab', async () => {
    const { api } = makeChromeStub({ activeTabs: [] });
    await bootstrapPopup({ api, doc: document });
    const { article, status } = getButtons();
    expect(article.disabled).toBe(true);
    expect(status.textContent).toMatch(/No active tab/i);
  });
});

describe('bootstrapPopup — button clicks', () => {
  beforeEach(() => {
    installPopupDom();
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('Read article click sends activate-reader with scope="full"', async () => {
    const { api, sendMessage } = makeChromeStub({ hasSelection: false });
    await bootstrapPopup({ api, doc: document });
    const { article, status } = getButtons();
    article.click();
    // Allow the async activate() handler to flush.
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalled();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'activate-reader',
      tabId: 42,
      scope: 'full',
    });
    await vi.waitFor(() => {
      expect(status.textContent).toMatch(/Activated full read/);
    });
  });

  it('Read selection click sends activate-reader with scope="selection"', async () => {
    const { api, sendMessage } = makeChromeStub({ hasSelection: true });
    await bootstrapPopup({ api, doc: document });
    const { selection, status } = getButtons();
    selection.click();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalled();
    });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'activate-reader',
      tabId: 42,
      scope: 'selection',
    });
    await vi.waitFor(() => {
      expect(status.textContent).toMatch(/Activated selection read/);
    });
  });

  it('error response renders reason and re-enables Read article without closing the popup', async () => {
    const { api, sendMessage } = makeChromeStub({
      hasSelection: false,
      sendMessageResponse: {
        ok: false,
        error: {
          kind: 'activation-failed',
          error: { kind: 'restricted-page', url: 'chrome://settings' },
        },
      },
    });
    const closeSpy = window.close as unknown as ReturnType<typeof vi.fn>;
    await bootstrapPopup({ api, doc: document });
    const { article, status } = getButtons();
    article.click();
    await vi.waitFor(() => {
      expect(sendMessage).toHaveBeenCalled();
    });
    await vi.waitFor(() => {
      expect(status.textContent).toMatch(/restricted/i);
    });
    expect(status.getAttribute('data-state')).toBe('error');
    expect(article.disabled).toBe(false);
    // The popup must stay open so the user can read the error.
    expect(closeSpy).not.toHaveBeenCalled();
  });

  // Adversarial-ring test-gap F1: prior coverage exercised only the
  // `restricted-page` inner branch; the four other inner kinds and the
  // outer-fallback template were dead-letter. One parameterized test per
  // branch closes the mutation gap.
  it.each([
    {
      inner: 'inject-failed' as const,
      match: /Could not inject SpeedReader/i,
    },
    {
      inner: 'handoff-failed' as const,
      match: /Lost connection to the page/i,
    },
    {
      inner: 'tab-unavailable' as const,
      match: /Tab is no longer available/i,
    },
  ])('error response with inner=$inner renders the expected reason', async ({ inner, match }) => {
    const { api } = makeChromeStub({
      hasSelection: false,
      sendMessageResponse: {
        ok: false,
        error: {
          kind: 'activation-failed',
          error: { kind: inner } as never,
        },
      },
    });
    await bootstrapPopup({ api, doc: document });
    const { article, status } = getButtons();
    article.click();
    await vi.waitFor(() => {
      expect(status.textContent).toMatch(match);
    });
    expect(status.getAttribute('data-state')).toBe('error');
    expect(article.disabled).toBe(false);
  });

  it('error response with unknown outer kind falls back to "Activation failed (<outer>)."', async () => {
    const { api } = makeChromeStub({
      hasSelection: false,
      sendMessageResponse: {
        ok: false,
        // Outer kind is NOT 'activation-failed' → hits the outer-fallback
        // branch in formatActivationError.
        error: { kind: 'invalid-payload' as never },
      },
    });
    await bootstrapPopup({ api, doc: document });
    const { article, status } = getButtons();
    article.click();
    await vi.waitFor(() => {
      expect(status.textContent).toMatch(/Activation failed \(invalid-payload\)\./);
    });
  });

  it('bootstrapPopup with missing DOM elements resolves without throwing and does not query chrome', async () => {
    // Adversarial-ring test-gap F3: the defensive early-return on a
    // missing button / status was unexercised; a structural HTML
    // regression would have shipped silently.
    document.body.innerHTML = '<div id="status"></div>'; // missing both buttons
    const { api } = makeChromeStub({ hasSelection: false });
    await expect(bootstrapPopup({ api, doc: document })).resolves.toBeUndefined();
    expect(api.tabs.query).not.toHaveBeenCalled();
  });

  it('sendMessage rejection surfaces error state', async () => {
    const { api } = makeChromeStub({
      hasSelection: false,
      sendMessageRejects: new Error('Could not establish connection'),
    });
    await bootstrapPopup({ api, doc: document });
    const { article, status } = getButtons();
    article.click();
    await vi.waitFor(() => {
      expect(status.textContent).toMatch(/Could not establish connection/);
    });
    expect(status.getAttribute('data-state')).toBe('error');
    expect(article.disabled).toBe(false);
  });
});
