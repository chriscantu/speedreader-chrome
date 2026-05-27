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

console.log('[SpeedReader] Content script loaded');

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
      // Synchronous response — no `return true` needed.
    }
  });
}
