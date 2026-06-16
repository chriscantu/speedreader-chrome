/**
 * SpeedReader — Popup Script (issue #18).
 *
 * Two-button surface:
 *   - "Read article"   → activate-reader { scope: 'full' }
 *   - "Read selection" → activate-reader { scope: 'selection' }
 *
 * Selection button is gated on a `chrome.scripting.executeScript` probe
 * at popup-open. The probe is best-effort: the CS re-reads
 * `window.getSelection().toString()` on activation, so a stale "true"
 * here is recovered by the CS's empty-selection fallback (see
 * `activate-handler-scope.test.ts` — `scope="selection" with empty
 * selection: empty-selection fallback fires`).
 *
 * All `chrome.*` indirection goes through `./activate.ts` so the
 * message-construction + probe paths are unit-testable.
 */

import {
  buildActivateRequest,
  resolveActiveTabId,
  tabHasSelection,
  type PopupScope,
} from './activate';
import { renderHistorySection, type HistorySectionEntry } from '../../core/popup/history-section';
import { createPopupHistoryClient, type PopupHistoryClient } from './position/client';
import { loadSettings } from '../settings/storage';

interface PopupBootstrapDeps {
  readonly api: typeof chrome;
  readonly doc: Document;
  /** Injectable for tests; defaults to `loadSettings`. */
  readonly loadSettings?: () => Promise<{ historyEnabled: boolean }>;
  /**
   * Injectable for tests; defaults to `createPopupHistoryClient(api)`. #196 —
   * the popup reaches the SW-owned store via RPC, never a direct
   * `chrome.storage.local` writer (single-writer rule).
   */
  readonly historyClient?: PopupHistoryClient;
  /** Injectable for tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Wire up the popup UI. Exported for testability — `index.test.ts`
 * invokes this with a stubbed `chrome` API + jsdom document.
 */
export async function bootstrapPopup(deps: PopupBootstrapDeps): Promise<void> {
  const { api, doc } = deps;
  const articleBtn = doc.getElementById('read-article') as HTMLButtonElement | null;
  const selectionBtn = doc.getElementById('read-selection') as HTMLButtonElement | null;
  const statusEl = doc.getElementById('status');

  // #49 — mount the "Recently read" section. Independent of the
  // activate-reader flow below; failure here must NOT block the
  // primary buttons from wiring up. Errors are surfaced to console
  // and the section is left empty (graceful degradation).
  await mountHistorySection(deps).catch((err: unknown) => {
    console.error('[speedreader] popup: history section mount failed', err);
  });

  if (!articleBtn || !selectionBtn || !statusEl) {
    // Defensive — the popup HTML controls these IDs. A missing element
    // means a structural mismatch; surface nothing and bail.
    return;
  }

  let tabId: number;
  try {
    tabId = await resolveActiveTabId(api);
  } catch {
    setStatus(statusEl, 'No active tab. Open the popup on a page.', 'error');
    articleBtn.disabled = true;
    articleBtn.setAttribute('aria-disabled', 'true');
    return;
  }

  // Article button is always enabled — even restricted URLs surface a
  // typed error from the route, which we then render in the status line.
  articleBtn.addEventListener('click', () => {
    void activate(api, statusEl, articleBtn, selectionBtn, tabId, 'full');
  });

  // Probe selection. On failure (restricted URL, no host permission, no
  // selection), the selection button stays disabled with a visible cue.
  const hasSelection = await tabHasSelection(api, tabId);
  if (hasSelection) {
    selectionBtn.disabled = false;
    selectionBtn.setAttribute('aria-disabled', 'false');
    selectionBtn.addEventListener('click', () => {
      void activate(api, statusEl, articleBtn, selectionBtn, tabId, 'selection');
    });
  } else {
    selectionBtn.disabled = true;
    selectionBtn.setAttribute('aria-disabled', 'true');
    selectionBtn.title = 'No selection on this tab';
  }
}

interface ActivationResponse {
  ok: boolean;
  error?: { kind: string; error?: { kind: string; url?: string } };
}

async function activate(
  api: typeof chrome,
  statusEl: HTMLElement,
  articleBtn: HTMLButtonElement,
  selectionBtn: HTMLButtonElement,
  tabId: number,
  scope: PopupScope,
): Promise<void> {
  articleBtn.disabled = true;
  selectionBtn.disabled = true;
  setStatus(statusEl, scope === 'selection' ? 'Activating selection…' : 'Activating reader…');

  const req = buildActivateRequest(tabId, scope);
  let resp: ActivationResponse | undefined;
  try {
    resp = (await api.runtime.sendMessage(req)) as ActivationResponse | undefined;
  } catch (err) {
    setStatus(statusEl, formatErrorMessage(err), 'error');
    articleBtn.disabled = false;
    // Re-enable selection only if it was enabled to begin with — checked
    // via aria-disabled (set by the probe path).
    if (selectionBtn.getAttribute('aria-disabled') === 'false') {
      selectionBtn.disabled = false;
    }
    return;
  }

  if (resp && resp.ok) {
    setStatus(
      statusEl,
      scope === 'selection' ? 'Activated selection read.' : 'Activated full read.',
    );
    // The popup unmounts on its own when the page takes focus during
    // overlay activation. The prior shape held the popup open for 400 ms
    // before closing — that was self-justified UX noise the ring critics
    // (scope F3, perf F3, test-gap F2) all flagged as a measurable
    // visible delay with no user benefit.
    return;
  }

  // Error path — keep popup open so the user can read the message.
  setStatus(statusEl, formatActivationError(resp), 'error');
  articleBtn.disabled = false;
  if (selectionBtn.getAttribute('aria-disabled') === 'false') {
    selectionBtn.disabled = false;
  }
}

function setStatus(el: HTMLElement, text: string, state?: 'error'): void {
  el.textContent = text;
  if (state) {
    el.setAttribute('data-state', state);
  } else {
    el.removeAttribute('data-state');
  }
}

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Unable to reach the extension service worker.';
}

function formatActivationError(resp: ActivationResponse | undefined): string {
  if (!resp || !resp.error) return 'Activation failed.';
  const outer = resp.error.kind;
  if (outer === 'activation-failed' && resp.error.error) {
    const inner = resp.error.error.kind;
    if (inner === 'restricted-page') {
      return 'SpeedReader cannot run on this page (restricted URL).';
    }
    if (inner === 'inject-failed') return 'Could not inject SpeedReader into this page.';
    if (inner === 'handoff-failed') return 'Lost connection to the page. Try again.';
    if (inner === 'tab-unavailable') return 'Tab is no longer available.';
    return `Activation failed (${inner}).`;
  }
  return `Activation failed (${outer}).`;
}

/**
 * #49 — read settings + position store, render the "Recently read"
 * section into `#history-container`. Wires callbacks to platform APIs:
 *   - resume   → `chrome.tabs.create({ url })` (new tab; CS auto-resumes
 *     on next mount via #48 position store)
 *   - delete   → `store.clear(url)` then re-mount the section
 *   - clearAll → `store.clearAll()` then re-mount
 *   - enable   → `chrome.runtime.openOptionsPage()`
 *
 * No live re-render on external store changes — popup re-renders on
 * next open, which is acceptable for the popup's short lifecycle.
 */
async function mountHistorySection(deps: PopupBootstrapDeps): Promise<void> {
  const { api, doc } = deps;
  const container = doc.getElementById('history-container');
  if (!container) return; // HTML drift; non-fatal — primary buttons still work.

  const loadFn = deps.loadSettings ?? loadSettings;
  const client = deps.historyClient ?? createPopupHistoryClient(api);
  const now = deps.now ?? (() => Date.now());

  const remount = async (): Promise<void> => {
    let enabled = false;
    let entries: HistorySectionEntry[] = [];
    try {
      const settings = await loadFn();
      enabled = settings.historyEnabled === true;
    } catch (err) {
      console.error('[speedreader] popup: settings load failed in history section', err);
      // Render the disabled "off" state on settings load failure so
      // the user has a path back via the Enable link rather than a
      // mystery-empty section. `enabled` keeps its initial `false`.
    }

    if (enabled) {
      try {
        const list = await client.list();
        entries = list.map((e) => ({ url: e.url, timestamp: e.position.lastReadAt }));
      } catch (err) {
        console.error('[speedreader] popup: history list() failed', err);
        entries = [];
      }
    }

    const section = renderHistorySection({
      entries,
      enabled,
      now: now(),
      onResume: (url) => {
        void api.tabs.create({ url });
      },
      onDelete: (url) => {
        void client
          .delete(url)
          .then(() => remount())
          .catch((err: unknown) => {
            console.error('[speedreader] popup: history delete failed', err);
          });
      },
      onClearAll: () => {
        void client
          .clearAll()
          .then(() => remount())
          .catch((err: unknown) => {
            console.error('[speedreader] popup: history clearAll failed', err);
          });
      },
      onEnableInSettings: () => {
        // openOptionsPage is the canonical MV3 way to surface the
        // options page programmatically. It honors the user's
        // `chrome://extensions/?options=` preference (separate page
        // vs. embedded) without us having to know which.
        if (api.runtime.openOptionsPage) {
          void api.runtime.openOptionsPage();
        }
      },
    });
    container.replaceChildren(section);
  };

  await remount();
}

// DOM bootstrap. Skipped in test contexts that import the module
// without a `chrome` global.
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrapPopup({ api: chrome, doc: document });
  });
}
