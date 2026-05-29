/**
 * theme-system-live.test.ts — issue #26
 *
 * The overlay already resolves `theme: 'system'` to a concrete light/dark
 * value at mount and on settings change. This file pins the live-update
 * behaviour: when the user's effective theme is `'system'` and the OS
 * `prefers-color-scheme` flips while the overlay is mounted, the overlay
 * must re-apply the resolved theme tokens without requiring a settings
 * push.
 *
 * Acceptance for #26: "Live-updates when the system theme changes."
 *
 * Negative coverage:
 *  - When the effective theme is an explicit override (not `'system'`),
 *    a matchMedia change is a no-op — a user who picked Light does not
 *    want the OS to override their choice.
 *  - After unmount the listener is removed; no further re-applies fire.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createOverlay } from '../overlay';
import type { OverlayOptions, OverlaySettings, SettingsSubscriber } from '../types';
import { createRsvpEngine, type RsvpEngine, type RsvpEngineOptions } from '../../rsvp-engine';
import { THEME_TOKENS } from '../../theme';

const STREAM = ['hello', 'world', 'foo', 'bar'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

type Holder = { engine: RsvpEngine | null };

interface MatchMediaMock {
  /** Captured queries (push order). */
  queries: string[];
  /** Flip `prefers-color-scheme: dark` and notify listeners. */
  setDark(next: boolean): void;
}

/**
 * Mock `window.matchMedia` with full change-listener support.
 *
 * Existing tests (touch-controls) only assert on `query`/`matches`, not on
 * change events. This mock extends that surface so we can fire a synthetic
 * `change` for the prefers-color-scheme query and observe whether the
 * overlay re-applied its theme tokens.
 */
function installMatchMediaMock(initialDarkMatches = false): MatchMediaMock {
  const queries: string[] = [];
  let darkMatches = initialDarkMatches;
  // Each created list owns its own listener set. `setDark` walks every
  // list created for the dark query and fires every listener on each.
  const darkListenerSets: Array<Set<(ev: MediaQueryListEvent) => void>> = [];

  const stub = (query: string): MediaQueryList => {
    queries.push(query);
    const listeners = new Set<(ev: MediaQueryListEvent) => void>();
    if (query === DARK_QUERY) darkListenerSets.push(listeners);
    const list: MediaQueryList = {
      get matches() {
        return query === DARK_QUERY ? darkMatches : false;
      },
      media: query,
      onchange: null,
      // Legacy API — not used by the overlay but kept for parity with the
      // real MediaQueryList shape so a future regression to addListener
      // does not silently no-op against this mock.
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
        if (type !== 'change') return;
        const fn = typeof cb === 'function' ? cb : (ev: Event) => cb.handleEvent(ev);
        listeners.add(fn as (ev: MediaQueryListEvent) => void);
      },
      removeEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
        if (type !== 'change') return;
        // Identity match — callers must pass the exact same fn ref they
        // added. The overlay stores its handler in a closure variable for
        // exactly this reason.
        listeners.forEach((existing) => {
          if (existing === cb) listeners.delete(existing);
        });
      },
      dispatchEvent: () => false,
    } as MediaQueryList;
    return list;
  };

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: stub,
  });

  return {
    queries,
    setDark(next: boolean) {
      if (next === darkMatches) return;
      darkMatches = next;
      const ev = { matches: next, media: DARK_QUERY } as MediaQueryListEvent;
      // Fire on every list created for the dark query. The overlay may
      // call matchMedia more than once (resolveTheme at mount + the live
      // listener install) — each call returns its own list with its own
      // listener set.
      darkListenerSets.forEach((set) => set.forEach((fn) => fn(ev)));
    },
  };
}

function getModal(): HTMLElement {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  const modal = host.shadowRoot.querySelector<HTMLElement>('.modal');
  if (!modal) throw new Error('overlay shadow: missing .modal');
  return modal;
}

function readBg(modal: HTMLElement): string {
  return modal.style.getPropertyValue('--bg');
}

function defaultOpts(
  holder: Holder,
  overrides: Partial<OverlayOptions> = {},
): OverlayOptions & { __push: (s: OverlaySettings) => void } {
  let listener: SettingsSubscriber | null = null;
  const opts: OverlayOptions = {
    doc: document,
    words: STREAM.slice(),
    initialSettings: { theme: 'system', wpm: 300 },
    subscribeSettings: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    engineFactory: (engineOpts: RsvpEngineOptions) => {
      holder.engine = createRsvpEngine(engineOpts);
      return holder.engine;
    },
    ...overrides,
  };
  return Object.assign(opts, {
    __push: (s: OverlaySettings) => listener?.(s),
  });
}

describe('createOverlay — live system-theme updates (#26)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
  });

  test('flips dark → light when OS theme flips and effective theme is "system"', () => {
    const mm = installMatchMediaMock(/* initialDarkMatches */ true);
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();

    const modal = getModal();
    // Mounted dark → applier wrote dark tokens.
    expect(readBg(modal)).toBe(THEME_TOKENS.dark.bg);

    // OS flips to light.
    mm.setDark(false);

    expect(readBg(modal)).toBe(THEME_TOKENS.light.bg);
    overlay.unmount();
  });

  test('flips light → dark when OS theme flips and effective theme is "system"', () => {
    const mm = installMatchMediaMock(/* initialDarkMatches */ false);
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();

    const modal = getModal();
    expect(readBg(modal)).toBe(THEME_TOKENS.light.bg);

    mm.setDark(true);

    expect(readBg(modal)).toBe(THEME_TOKENS.dark.bg);
    overlay.unmount();
  });

  test('does NOT re-apply on OS flip when effective theme is an explicit override', () => {
    const mm = installMatchMediaMock(/* initialDarkMatches */ false);
    const holder: Holder = { engine: null };
    const opts = defaultOpts(holder, {
      initialSettings: { theme: 'dark', wpm: 300 },
    });
    const overlay = createOverlay(opts);
    overlay.mount();

    const modal = getModal();
    expect(readBg(modal)).toBe(THEME_TOKENS.dark.bg);

    // OS flip is irrelevant — the user picked dark explicitly.
    mm.setDark(true);
    expect(readBg(modal)).toBe(THEME_TOKENS.dark.bg);
    mm.setDark(false);
    expect(readBg(modal)).toBe(THEME_TOKENS.dark.bg);

    overlay.unmount();
  });

  test('settings push from system → explicit detaches the live OS listener', () => {
    const mm = installMatchMediaMock(/* initialDarkMatches */ false);
    const holder: Holder = { engine: null };
    const opts = defaultOpts(holder);
    const overlay = createOverlay(opts);
    overlay.mount();

    const modal = getModal();
    expect(readBg(modal)).toBe(THEME_TOKENS.light.bg);

    // User switches to explicit "sepia" via the options page.
    opts.__push({ theme: 'sepia', wpm: 300 });
    expect(readBg(modal)).toBe(THEME_TOKENS.sepia.bg);

    // OS flip must no longer touch the modal — explicit override wins.
    mm.setDark(true);
    expect(readBg(modal)).toBe(THEME_TOKENS.sepia.bg);

    overlay.unmount();
  });

  test('settings push from explicit → system re-activates the live OS listener', () => {
    const mm = installMatchMediaMock(/* initialDarkMatches */ false);
    const holder: Holder = { engine: null };
    const opts = defaultOpts(holder, {
      initialSettings: { theme: 'light', wpm: 300 },
    });
    const overlay = createOverlay(opts);
    overlay.mount();

    const modal = getModal();
    expect(readBg(modal)).toBe(THEME_TOKENS.light.bg);

    // User switches back to "system" via the options page.
    opts.__push({ theme: 'system', wpm: 300 });
    // Still light — OS query says light.
    expect(readBg(modal)).toBe(THEME_TOKENS.light.bg);

    // OS flips → overlay must follow.
    mm.setDark(true);
    expect(readBg(modal)).toBe(THEME_TOKENS.dark.bg);

    overlay.unmount();
  });

  test('listener is removed on unmount — no re-apply after teardown', () => {
    const mm = installMatchMediaMock(/* initialDarkMatches */ false);
    const holder: Holder = { engine: null };
    const overlay = createOverlay(defaultOpts(holder));
    overlay.mount();

    const modal = getModal();
    overlay.unmount();

    // Modal is detached; we keep a reference. If a stale listener fired, it
    // would mutate the orphan node's --bg. The DOM-attached `[data-...]`
    // host is gone, so the strongest assertion is that the orphan modal's
    // bg does not change.
    const before = readBg(modal);
    mm.setDark(true);
    expect(readBg(modal)).toBe(before);
  });
});
