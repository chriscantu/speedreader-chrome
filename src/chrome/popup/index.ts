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

interface PopupBootstrapDeps {
  readonly api: typeof chrome;
  readonly doc: Document;
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

// DOM bootstrap. Skipped in test contexts that import the module
// without a `chrome` global.
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrapPopup({ api: chrome, doc: document });
  });
}
