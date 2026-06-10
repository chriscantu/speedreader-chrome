/**
 * opendyslexic-wire.test.ts — issue #27
 *
 * End-to-end wire from `chrome.storage.sync.get` → loadSettings →
 * createOverlay → modal class on the shadow DOM. The unit test in
 * `core/overlay/__tests__/opendyslexic.test.ts` pins the overlay's local
 * behaviour; this file pins the chrome-glue path so a regression that
 * drops `openDyslexic` from the `initialSettings` payload or the
 * `subscribeSettings` listener (or that strips the `openDyslexicFontUrl`
 * from `chrome.runtime.getURL`) lands as a test failure rather than a
 * silent toggle no-op.
 *
 * Mutation guard: each assertion's failure mode is explicit. Removing
 * the `openDyslexic` field from `initialSettings` makes the "modal carries
 * the class on mount" test fail. Removing `openDyslexicFontUrl` makes the
 * "shadow CSS contains the WAR URL" test fail. Dropping
 * `openDyslexic: s.openDyslexic` from the subscribe wiring breaks the
 * "live toggle re-applies on settings change" test in the overlay suite
 * — that case is covered there because it does not depend on chrome glue.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaults';
import { OVERLAY_CLASS } from '../../../core/overlay/constants';

const SETTINGS_KEY = 'speedreader.settings';
const FONT_PATH = 'fonts/OpenDyslexic-Regular.woff2';
const BOLD_FONT_PATH = 'fonts/OpenDyslexic-Bold.woff2';
const EXT_ID = 'test-ext';
const FONT_URL = `chrome-extension://${EXT_ID}/${FONT_PATH}`;
const BOLD_FONT_URL = `chrome-extension://${EXT_ID}/${BOLD_FONT_PATH}`;

type Listener = (
  msg: unknown,
  sender: { id?: string },
  sendResponse: (r: unknown) => void,
) => unknown;

interface ChromeMock {
  runtime: {
    id: string;
    onMessage: { addListener: (l: Listener) => void };
    getURL: ReturnType<typeof vi.fn>;
  };
  storage: {
    sync: {
      get: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
    };
    onChanged: {
      addListener: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
  };
}

function installChromeMock(initial: { openDyslexic: boolean } = { openDyslexic: false }): {
  mock: ChromeMock;
  getListener: () => Listener;
} {
  let capturedListener: Listener | undefined;
  const stored = { ...DEFAULT_SETTINGS, openDyslexic: initial.openDyslexic };
  const mock: ChromeMock = {
    runtime: {
      id: EXT_ID,
      onMessage: {
        addListener: (l: Listener) => {
          capturedListener = l;
        },
      },
      getURL: vi.fn((path: string) => `chrome-extension://${EXT_ID}/${path}`),
    },
    storage: {
      sync: {
        get: vi.fn().mockResolvedValue({ [SETTINGS_KEY]: stored }),
        set: vi.fn().mockResolvedValue(undefined),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;
  return {
    mock,
    getListener: () => {
      if (!capturedListener) throw new Error('content script never registered listener');
      return capturedListener;
    },
  };
}

async function mountOverlay(getListener: () => Listener): Promise<void> {
  document.body.innerHTML = '<article>The quick brown fox jumps over the lazy dog.</article>';
  await import('../index');
  const listener = getListener();
  const respond = vi.fn();
  listener({ type: 'activate-reader' }, { id: EXT_ID }, respond);
  expect(respond).toHaveBeenCalledWith({ ok: true });
  await vi.runAllTimersAsync();
}

function getShadow(): ShadowRoot {
  const host = document.body.querySelector('[data-speedreader-overlay]');
  if (!(host instanceof HTMLElement) || !host.shadowRoot) {
    throw new Error('overlay host missing or no shadow root');
  }
  return host.shadowRoot;
}

function getModal(): HTMLElement {
  const el = getShadow().querySelector<HTMLElement>(`.${OVERLAY_CLASS.MODAL}`);
  if (!el) throw new Error('overlay shadow: missing modal');
  return el;
}

function getShadowCss(): string {
  const shadow = getShadow();
  const adopted = (shadow as ShadowRoot & { adoptedStyleSheets?: CSSStyleSheet[] })
    .adoptedStyleSheets;
  const adoptedCss =
    adopted && adopted.length > 0
      ? adopted
          .map((s) =>
            Array.from(s.cssRules ?? [])
              .map((r) => r.cssText)
              .join('\n'),
          )
          .join('\n')
      : '';
  const inlineCss = Array.from(shadow.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('\n');
  return `${adoptedCss}\n${inlineCss}`;
}

describe('content script — OpenDyslexic wire (#27)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    document.body.innerHTML = '';
    document.querySelectorAll('[data-speedreader-overlay]').forEach((n) => n.remove());
    vi.resetModules();
  });

  test('openDyslexic=true persisted → modal carries .opendyslexic class on mount', async () => {
    const { getListener } = installChromeMock({ openDyslexic: true });
    await mountOverlay(getListener);
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(true);
  });

  test('openDyslexic=false persisted → modal does NOT carry .opendyslexic class', async () => {
    const { getListener } = installChromeMock({ openDyslexic: false });
    await mountOverlay(getListener);
    expect(getModal().classList.contains(OVERLAY_CLASS.OPENDYSLEXIC)).toBe(false);
  });

  test('chrome.runtime.getURL is invoked with the bundled font path and the resolved URL is embedded in the shadow @font-face', async () => {
    const { mock, getListener } = installChromeMock({ openDyslexic: true });
    await mountOverlay(getListener);

    // Mutation guard: a contributor dropping `openDyslexicFontUrl` from
    // createOverlay would still pass the class-flip assertions above —
    // this assertion is what proves the URL flow is live. Bound to the
    // exact font-path string so a typo in the path also fails here.
    expect(mock.runtime.getURL).toHaveBeenCalledWith(FONT_PATH);

    const css = getShadowCss();
    expect(css).toContain('@font-face');
    expect(css).toContain('OpenDyslexic');
    expect(css).toContain(FONT_URL);
  });

  test('bold font path (#191) is resolved via getURL and embedded as a bold @font-face', async () => {
    const { mock, getListener } = installChromeMock({ openDyslexic: true });
    await mountOverlay(getListener);

    // Mutation guard: dropping `openDyslexicBoldFontUrl` from the
    // createOverlay call leaves the regular wire intact but fails both
    // assertions below — the getURL call AND the bold-weight rule.
    expect(mock.runtime.getURL).toHaveBeenCalledWith(BOLD_FONT_PATH);

    const css = getShadowCss();
    expect(css).toContain(BOLD_FONT_URL);
    expect(css).toMatch(/font-weight:\s*bold/);
  });
});
