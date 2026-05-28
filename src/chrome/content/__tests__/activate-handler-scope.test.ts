/**
 * CS-side scope plumbing for the scoped mini-modal contract
 * (`docs/superpowers/specs/2026-05-25-context-menu-integration.md`
 * §Scoped Mini-Modal Contract).
 *
 * The SW's activate-reader payload now carries `scope: 'selection' | 'full'`.
 * The CS:
 *   - re-reads `window.getSelection().toString()` for authoritative
 *     selection text (the SW's `info.selectionText` is hint-only)
 *   - tokenizes both the selection text and the full body
 *   - passes `scope`, `selectionWords`, `fullWords`, and `articleTitle`
 *     to `createOverlay`
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

type Listener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void,
) => unknown;

interface ChromeMock {
  runtime: { id: string; onMessage: { addListener: (l: Listener) => void } };
  storage: {
    sync: {
      get: (...args: unknown[]) => Promise<unknown>;
      set: (...args: unknown[]) => Promise<unknown>;
    };
    onChanged: { addListener: () => void; removeListener: () => void };
  };
}

function installChromeMock(): { listenerRef: { current: Listener | undefined } } {
  const listenerRef: { current: Listener | undefined } = { current: undefined };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = {
    runtime: {
      id: 'test-ext',
      onMessage: {
        addListener: (l) => {
          listenerRef.current = l;
        },
      },
    },
    storage: {
      sync: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  return { listenerRef };
}

function getOverlayShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

async function waitForOverlay(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (document.querySelector('[data-speedreader-overlay]')) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('overlay did not mount');
}

describe('content script — scope plumbing (#131)', () => {
  beforeEach(() => {
    document.title = 'Article Title';
    document.body.innerHTML =
      '<article><p id="p1">Selected paragraph text here.</p>' +
      '<p>Other body text in the article.</p></article>';
  });

  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    document.body.innerHTML = '';
    document.title = '';
    vi.resetModules();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
    window.getSelection()?.removeAllRanges();
  });

  test('scope omitted (legacy): mounts overlay with full-article scope', async () => {
    const { listenerRef } = installChromeMock();
    await import('../index');
    listenerRef.current!({ type: 'activate-reader' }, { id: 'test-ext' }, vi.fn());
    await waitForOverlay();

    const header = getOverlayShadow().querySelector('#sr-scope-header');
    // Falls back to articleTitle when scope unspecified ("Article Title"
    // from document.title); no SELECTION pattern.
    expect(header?.textContent).toBe('Article Title');
    expect(getOverlayShadow().querySelector('.scope-swap-btn')).toBeNull();
  });

  test('scope="full" payload: overlay renders article-title header, no swap button', async () => {
    const { listenerRef } = installChromeMock();
    await import('../index');
    listenerRef.current!(
      { type: 'activate-reader', scope: 'full' },
      { id: 'test-ext' },
      vi.fn(),
    );
    await waitForOverlay();

    const shadow = getOverlayShadow();
    expect(shadow.querySelector('#sr-scope-header')?.textContent).toBe('Article Title');
    expect(shadow.querySelector('.scope-swap-btn')).toBeNull();
    expect(shadow.querySelector('.scope-subtitle')).toBeNull();
  });

  test('scope="selection" with active selection: SELECTION header + swap button', async () => {
    const { listenerRef } = installChromeMock();
    // Establish a real selection in the jsdom document so the CS's
    // getSelection().toString() returns the selected text.
    const p1 = document.getElementById('p1') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(p1);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(window.getSelection()?.toString().length).toBeGreaterThan(0);

    await import('../index');
    listenerRef.current!(
      { type: 'activate-reader', scope: 'selection' },
      { id: 'test-ext' },
      vi.fn(),
    );
    await waitForOverlay();

    const shadow = getOverlayShadow();
    const header = shadow.querySelector('#sr-scope-header');
    // "Selected paragraph text here." → 4 words after tokenize
    expect(header?.textContent).toMatch(/SELECTION · 4 words · ~\d+ sec/);
    expect(shadow.querySelector('.scope-swap-btn')).toBeTruthy();
    expect(shadow.querySelector('.scope-subtitle')).toBeNull();
  });

  test('scope="selection" with empty selection: empty-selection fallback fires', async () => {
    const { listenerRef } = installChromeMock();
    // No selection set; window.getSelection().toString() === ''.
    expect(window.getSelection()?.toString()).toBe('');

    await import('../index');
    listenerRef.current!(
      { type: 'activate-reader', scope: 'selection' },
      { id: 'test-ext' },
      vi.fn(),
    );
    await waitForOverlay();

    const shadow = getOverlayShadow();
    expect(shadow.querySelector('.scope-subtitle')?.textContent).toBe(
      'No selection detected. Reading full article instead.',
    );
    expect(shadow.querySelector('.scope-swap-btn')).toBeNull();
    // Header is full-article fallback, not SELECTION
    expect(shadow.querySelector('#sr-scope-header')?.textContent).not.toMatch(/SELECTION/);
  });
});
