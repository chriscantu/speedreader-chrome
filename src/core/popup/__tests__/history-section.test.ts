/**
 * Tests for `renderHistorySection` (issue #49 — popup "Recently read"
 * surface).
 *
 * The section is a pure rendering function: input is the data slice
 * (entries, enabled flag) plus callbacks; output is a DOM subtree.
 * No chrome.* — the popup glue in src/chrome/popup/index.ts wires the
 * callbacks to chrome.tabs.create / store.clear / store.clearAll.
 *
 * Anti-tautology stance:
 *   - Accessible queries (role="list", role="listitem", role="button"
 *     with accessible name) rather than raw CSS selectors. A class
 *     rename should not false-pass.
 *   - Callbacks assert OBSERVED state change (URL passed to onResume
 *     matches the entry clicked), not "callback was called once".
 *   - Empty-state assertion checks the empty-state element is PRESENT
 *     and the list element is ABSENT — not "list has 0 items" (which
 *     a broken render-empty path could satisfy).
 *   - Confirm-before-clear-all asserts onClearAll fires only when the
 *     stub returns true; a false return must NOT invoke the callback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHistorySection, type HistorySectionEntry } from '../history-section';

const NOW = 1_700_000_000_000;

function mount(node: HTMLElement): HTMLElement {
  document.body.appendChild(node);
  return node;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('renderHistorySection — disabled state', () => {
  it('renders the "off" message and a link to enable, no list', () => {
    const section = mount(
      renderHistorySection({
        entries: [],
        enabled: false,
        now: NOW,
        onResume: vi.fn(),
        onDelete: vi.fn(),
        onClearAll: vi.fn(),
        onEnableInSettings: vi.fn(),
      }),
    );

    expect(section.textContent ?? '').toMatch(/Reading history is off/i);
    // Enable link must be a button (accessible name "Enable in settings").
    const enableBtn = section.querySelector('button');
    expect(enableBtn).not.toBeNull();
    expect(enableBtn?.textContent).toMatch(/enable/i);
    // No list element when disabled.
    expect(section.querySelector('[role="list"]')).toBeNull();
  });

  it('Enable link click invokes onEnableInSettings', () => {
    const onEnable = vi.fn();
    const section = mount(
      renderHistorySection({
        entries: [],
        enabled: false,
        now: NOW,
        onResume: vi.fn(),
        onDelete: vi.fn(),
        onClearAll: vi.fn(),
        onEnableInSettings: onEnable,
      }),
    );
    const btn = section.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(onEnable).toHaveBeenCalledTimes(1);
  });
});

describe('renderHistorySection — enabled but empty', () => {
  it('renders the empty-state message AND no list element', () => {
    const section = mount(
      renderHistorySection({
        entries: [],
        enabled: true,
        now: NOW,
        onResume: vi.fn(),
        onDelete: vi.fn(),
        onClearAll: vi.fn(),
        onEnableInSettings: vi.fn(),
      }),
    );
    expect(section.textContent ?? '').toMatch(/No articles yet/i);
    // Critical anti-tautology: list element ABSENT, not "list has 0
    // items" — a broken render path could yield an empty <ul> and we'd
    // never catch it. Forces the implementation to a single render path.
    expect(section.querySelector('[role="list"]')).toBeNull();
    // No clear-all button when there's nothing to clear.
    expect(section.querySelector('button')).toBeNull();
  });
});

describe('renderHistorySection — enabled with entries', () => {
  const entries: HistorySectionEntry[] = [
    {
      url: 'https://example.com/a',
      timestamp: NOW - 30 * 60_000, // 30m ago
    },
    {
      url: 'https://www.foo.com/blog/post',
      timestamp: NOW - 2 * 86_400_000, // 2 days ago
    },
  ];

  it('renders a list with one listitem per entry', () => {
    const section = mount(
      renderHistorySection({
        entries,
        enabled: true,
        now: NOW,
        onResume: vi.fn(),
        onDelete: vi.fn(),
        onClearAll: vi.fn(),
        onEnableInSettings: vi.fn(),
      }),
    );
    const list = section.querySelector('[role="list"]');
    expect(list).not.toBeNull();
    const items = section.querySelectorAll('[role="listitem"]');
    expect(items.length).toBe(2);
  });

  it('each item renders derived title and relative timestamp', () => {
    const section = mount(
      renderHistorySection({
        entries,
        enabled: true,
        now: NOW,
        onResume: vi.fn(),
        onDelete: vi.fn(),
        onClearAll: vi.fn(),
        onEnableInSettings: vi.fn(),
      }),
    );
    const text = section.textContent ?? '';
    // Derived titles (deriveTitleFromUrl): "example.com / a", "foo.com / post".
    expect(text).toContain('example.com / a');
    expect(text).toContain('foo.com / post');
    // Relative timestamps.
    expect(text).toContain('30m ago');
    expect(text).toContain('2 days ago');
  });

  it('clicking an entry invokes onResume with that entry URL (not just "called once")', () => {
    const onResume = vi.fn();
    const section = mount(
      renderHistorySection({
        entries,
        enabled: true,
        now: NOW,
        onResume,
        onDelete: vi.fn(),
        onClearAll: vi.fn(),
        onEnableInSettings: vi.fn(),
      }),
    );
    // Each listitem exposes a primary action button with the title as
    // accessible name. Clicking the SECOND entry must invoke onResume
    // with the SECOND entry's URL, not the first — pins observed state
    // change, not call shape.
    const items = section.querySelectorAll<HTMLElement>('[role="listitem"]');
    const secondResume = items[1].querySelector<HTMLButtonElement>('button[data-action="resume"]');
    if (!secondResume) throw new Error('test: resume button missing');
    secondResume.click();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith('https://www.foo.com/blog/post');
  });

  it('clicking the delete button invokes onDelete with the entry URL', () => {
    const onDelete = vi.fn();
    const section = mount(
      renderHistorySection({
        entries,
        enabled: true,
        now: NOW,
        onResume: vi.fn(),
        onDelete,
        onClearAll: vi.fn(),
        onEnableInSettings: vi.fn(),
      }),
    );
    const items = section.querySelectorAll<HTMLElement>('[role="listitem"]');
    const firstDelete = items[0].querySelector<HTMLButtonElement>('button[data-action="delete"]');
    if (!firstDelete) throw new Error('test: delete button missing');
    expect(firstDelete.getAttribute('aria-label')).toMatch(/remove|delete/i);
    firstDelete.click();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('https://example.com/a');
  });

  it('renders a "Clear all" button that invokes onClearAll AFTER confirm returns true', () => {
    const onClearAll = vi.fn();
    const confirmStub = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const section = mount(
      renderHistorySection({
        entries,
        enabled: true,
        now: NOW,
        onResume: vi.fn(),
        onDelete: vi.fn(),
        onClearAll,
        onEnableInSettings: vi.fn(),
      }),
    );
    const clearBtn = section.querySelector<HTMLButtonElement>('button[data-action="clear-all"]');
    if (!clearBtn) throw new Error('test: clear-all button missing');
    clearBtn.click();
    expect(confirmStub).toHaveBeenCalledTimes(1);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('Clear all does NOT fire when confirm returns false (cancelled)', () => {
    const onClearAll = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const section = mount(
      renderHistorySection({
        entries,
        enabled: true,
        now: NOW,
        onResume: vi.fn(),
        onDelete: vi.fn(),
        onClearAll,
        onEnableInSettings: vi.fn(),
      }),
    );
    const clearBtn = section.querySelector<HTMLButtonElement>('button[data-action="clear-all"]');
    if (!clearBtn) throw new Error('test: clear-all button missing');
    clearBtn.click();
    expect(onClearAll).not.toHaveBeenCalled();
  });
});

describe('renderHistorySection — entry cap', () => {
  it('renders at most MAX_DISPLAY_ENTRIES (50) even when given more', () => {
    const entries: HistorySectionEntry[] = Array.from({ length: 75 }, (_, i) => ({
      url: `https://example.com/article-${i}`,
      timestamp: NOW - i * 60_000,
    }));
    const section = mount(
      renderHistorySection({
        entries,
        enabled: true,
        now: NOW,
        onResume: vi.fn(),
        onDelete: vi.fn(),
        onClearAll: vi.fn(),
        onEnableInSettings: vi.fn(),
      }),
    );
    const items = section.querySelectorAll('[role="listitem"]');
    // Pin the cap value so a future widening to 100/200 surfaces here.
    expect(items.length).toBe(50);
    // The FIRST entry (most recent) must be present; the 51st must not.
    expect(section.textContent).toContain('article-0');
    expect(section.textContent).not.toContain('article-50');
  });
});
