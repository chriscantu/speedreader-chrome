/**
 * SpeedReader — Content Script
 *
 * This script is injected into page contexts by the manifest's content_scripts
 * entry. It handles:
 * - Article extraction via Readability (issue #17)
 * - RSVP overlay rendering (issues #19, #20)
 * - Communication with the background service worker
 *
 * See manifest.ts for the content script entry point.
 *
 * Issue #134 — the listener below gates `activate-reader` behind a
 * CS-side `isRestricted` self-check (via `activate-handler.ts`). This
 * closes the residual TOCTOU window between the SW's post-injection
 * recheck (PR #133) and the `chrome.tabs.sendMessage` handoff. The
 * gate lands ahead of the overlay implementation so the security
 * primitive is in place when overlay code arrives.
 *
 * Issue #135 — the listener and any future overlay state live at the
 * top-frame `window` scope. `chrome.scripting.executeScript` in the
 * SW currently injects only into the top frame (`target: { tabId }`,
 * no `frameIds`/`allFrames`); if a future change adds subframe
 * injection, the per-frame sentinel and re-registration discipline
 * must be revisited.
 */

// TODO(#5): Implement content script logic
// - Inject Readability-based article extraction
// - Render RSVP overlay with word-by-word display
// - Handle play/pause, speed control, keyboard shortcuts

import { handleActivateReader } from './activate-handler';
import { createOverlay, type OverlayHandle } from '../../core/overlay';
import { createRsvpEngine } from '../../core/rsvp-engine';
import { loadSettings, subscribeSettings } from '../settings/storage';
import { tokenize } from '../../core/tokenize';

console.log('[SpeedReader] Content script loaded');

let activeOverlay: OverlayHandle | null = null;

/**
 * Issue #142 — resident-cost trade-off (surfaced by the antagonistic-ring
 * arbiter on PR #140, perf finding #1).
 *
 * This listener registers at CS module load on every matched top-level
 * document. At N open tabs that means:
 * - N resident listener closures
 * - N copies of the `handleActivateReader` import graph
 *   (`activate-handler.ts` -> `core/restricted.ts`)
 * - The `msg.type !== 'activate-reader'` early-return runs on EVERY
 *   `runtime.onMessage` event routed to each tab (future feature
 *   messages, devtools probes, etc.).
 *
 * Decision: trade ACCEPTED. The cliff is non-catastrophic at typical
 * browsing scale, and the CS-side gate is load-bearing for #134's
 * residual TOCTOU closure between the SW's post-injection recheck
 * (PR #133) and the `chrome.tabs.sendMessage` handoff — removing it
 * reintroduces the race. Lazy registration would require a different
 * handshake protocol since the listener wouldn't exist at
 * `sendMessage` time; non-trivial design change, deferred. Flagged
 * for future hot-path expansion (auto-activate-on-scroll, etc.).
 *
 * Refs: #134 (gate rationale), #140 (review), #142 (this note).
 */
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
    // Sender authorization (review H2). `chrome.runtime.onMessage` in a
    // content script today only receives messages from this extension's
    // own contexts, but adding `externally_connectable` to the manifest
    // would silently expose this listener to other extensions. Pin the
    // expected sender so the gate is robust to future manifest changes.
    if (sender.id !== chrome.runtime.id) return;
    if (
      msg !== null &&
      typeof msg === 'object' &&
      (msg as { type?: unknown }).type === 'activate-reader'
    ) {
      const response = handleActivateReader(location.href, chrome.runtime.id);
      sendResponse(response);
      if (!response.ok) return;

      // Mount overlay (idempotent). MVP word source: body.innerText
      // tokenized; full Readability extraction tracked under #17.
      (async () => {
        if (activeOverlay && activeOverlay.status === 'mounted') return;
        const settings = await loadSettings();
        const text = document.body?.innerText ?? document.body?.textContent ?? '';
        const words = tokenize(text);
        if (words.length === 0) return;
        activeOverlay = createOverlay({
          doc: document,
          words,
          initialSettings: { theme: settings.theme, wpm: settings.wpm },
          subscribeSettings: (listener) =>
            subscribeSettings((s) => listener({ theme: s.theme, wpm: s.wpm })),
          engineFactory: createRsvpEngine,
          onClose: () => {
            activeOverlay = null;
          },
        });
        activeOverlay.mount();
      })().catch(() => {
        // Overlay mount failure must not crash the page. Errors are
        // swallowed here; the content script remains active for future
        // activation attempts.
      });
    }
  });
}
