/**
 * Popup-side activation helpers (issue #18).
 *
 * Pure functions split out from `index.ts` so the message-construction
 * and tab-probe logic are unit-testable without bootstrapping the DOM.
 * `index.ts` does only DOM wiring; everything that touches `chrome.*`
 * lives here behind a `typeof chrome` parameter so tests can pass a
 * stub instead of mutating the global.
 *
 * The popup is the only surface that probes the active tab for a
 * selection (via `chrome.scripting.executeScript`) — the rest of the
 * dispatch pipeline (`route.ts` → `dispatchActivation`) handles routing
 * and the CS re-reads `window.getSelection().toString()` for the
 * authoritative value per the SW-lifecycle spec §"Context-Menu
 * Selection Trust" (same trust contract applies here).
 */

export type PopupScope = 'full' | 'selection';

export interface ActivateRequest {
  readonly type: 'activate-reader';
  readonly tabId: number;
  readonly scope: PopupScope;
}

/** Construct the `activate-reader` wire payload the popup sends. */
export function buildActivateRequest(tabId: number, scope: PopupScope): ActivateRequest {
  return { type: 'activate-reader', tabId, scope };
}

/**
 * Resolve the active tab in the current window. Throws when no tab is
 * resolvable — a popup open with no active tab is a degenerate state we
 * surface rather than swallow.
 */
export async function resolveActiveTabId(api: typeof chrome): Promise<number> {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  const id = tabs[0]?.id;
  if (typeof id !== 'number') {
    throw new Error('no-active-tab');
  }
  return id;
}

/**
 * Probe the active tab for a non-empty selection. Returns `false` when:
 *   - `executeScript` rejects (restricted URL, no host permission, etc.)
 *   - the script returns no usable result (script context teardown, etc.)
 *   - the trimmed selection is empty
 *
 * The probe is a UX hint only — the CS re-reads `window.getSelection()`
 * on activation, so a stale `true` here is recovered by the CS's
 * empty-selection fallback (`activate-handler-scope.test.ts`).
 */
export async function tabHasSelection(api: typeof chrome, tabId: number): Promise<boolean> {
  try {
    const results = await api.scripting.executeScript({
      target: { tabId },
      // Inline function — runs in the page's isolated world. Keep tiny
      // and side-effect-free; the result is the only value we trust.
      func: () => (window.getSelection()?.toString() ?? '').trim().length > 0,
    });
    const first = results[0];
    return first?.result === true;
  } catch {
    // Restricted URL / no host permission / tab gone — UX falls back to
    // "Read selection" disabled, which is the same affordance the user
    // would see for an empty selection. Don't surface as an error.
    return false;
  }
}
