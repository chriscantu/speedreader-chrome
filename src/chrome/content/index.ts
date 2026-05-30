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
import { loadSettings, saveSettings, subscribeSettings } from '../settings/storage';
import { tokenize } from '../../core/tokenize';
import { recordClose, resumeIndex } from './session-position';

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

      // Spec §"Scoped Mini-Modal Contract" — the SW's activate-reader
      // payload carries `scope: 'selection' | 'full'`. The CS owns
      // selection truth (the SW's `info.selectionText` is hint-only,
      // per `background/activation/types.ts`). Re-read the selection
      // here and tokenize both streams up front so the scope-swap
      // affordance is a pure local transition.
      const rawScope = (msg as { scope?: unknown }).scope;
      const scope: 'selection' | 'full' = rawScope === 'selection' ? 'selection' : 'full';
      const selectionText = scope === 'selection' ? (window.getSelection()?.toString() ?? '') : '';
      const selectionWords = scope === 'selection' ? tokenize(selectionText) : [];

      // Mount overlay (idempotent). MVP word source: body.innerText
      // tokenized; full Readability extraction tracked under #17.
      (async () => {
        if (activeOverlay && activeOverlay.status === 'mounted') return;
        const settings = await loadSettings();
        const bodyText = document.body?.innerText ?? document.body?.textContent ?? '';
        const fullWords = tokenize(bodyText);
        if (fullWords.length === 0 && selectionWords.length === 0) return;
        const articleTitle = document.title?.trim() || undefined;
        // #25 — session resume. Key per scope against the freshly-tokenized
        // stream length so a mutated page falls back to start-of-stream
        // rather than seeking into a stale offset.
        const activeStreamLength = scope === 'selection' ? selectionWords.length : fullWords.length;
        const initialIndex = resumeIndex(scope, activeStreamLength);
        activeOverlay = createOverlay({
          doc: document,
          // Legacy single-list field retained for the type contract; the
          // overlay reads `fullWords` / `selectionWords` when `scope` is
          // present and falls back to `words` only when it isn't.
          words: fullWords,
          scope,
          selectionWords,
          fullWords,
          articleTitle,
          initialIndex,
          initialSettings: {
            theme: settings.theme,
            wpm: settings.wpm,
            fontSize: settings.fontSize,
            openDyslexic: settings.openDyslexic,
          },
          subscribeSettings: (listener) =>
            subscribeSettings((s) =>
              listener({
                theme: s.theme,
                wpm: s.wpm,
                fontSize: s.fontSize,
                openDyslexic: s.openDyslexic,
              }),
            ),
          // OpenDyslexic font URL (#27, #10). `core/` cannot call
          // chrome.runtime.getURL, so the WAR URL is resolved here at
          // overlay-construction time and passed through. PR #169 declared
          // the `fonts/*` WAR entry; the woff2 binary lands separately under
          // #173. When the binary is missing the overlay still mounts
          // correctly — the @font-face load fails silently and the modal
          // falls back to system-ui via the family stack in styles.ts.
          //
          // Defensive: optional-chain on `getURL` because some non-MV3 host
          // environments (e.g. unit-test harnesses that stub a partial
          // `chrome.runtime`) omit it. When unavailable, the toggle still
          // flips the class — pure UI behavior — but no custom font loads.
          // Warn so the silent-no-font case leaves a breadcrumb.
          openDyslexicFontUrl: (() => {
            if (!chrome.runtime.getURL) {
              console.warn(
                '[speedreader] chrome.runtime.getURL unavailable; OpenDyslexic font will not load',
              );
              return undefined;
            }
            return chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff2');
          })(),
          engineFactory: createRsvpEngine,
          onClose: (snapshot) => {
            activeOverlay = null;
            recordClose(snapshot);
          },
          // Font-size stepper (#29) — overlay clamps to FONT_SIZE_MIN/MAX
          // before invoking. saveSettings is debounced (300 ms trailing
          // edge) so rapid stepper presses coalesce into a single
          // chrome.storage.sync.set, well under the 120 writes/min quota.
          //
          // Review H1 — surface persistence failures (quota exhaustion at
          // 8 KB/item or 120 writes/min, sync-disabled) instead of
          // dropping them via fire-and-forget `void`. The overlay UI has
          // already mutated by the time this callback fires, so the user
          // sees the new font size; logging gives us a breadcrumb when
          // the next page reload doesn't reflect it.
          onFontSizeChange: (next) => {
            saveSettings({ fontSize: next }).catch((err: unknown) => {
              console.warn('[speedreader] fontSize persist failed', err);
            });
          },
          // WPM slider + ArrowUp/Down (#24). Overlay clamps to
          // [WPM_MIN, WPM_MAX] and snaps to WPM_STEP before invoking. The
          // debounced saveSettings (300 ms trailing edge) coalesces rapid
          // slider drags into a single chrome.storage.sync.set, well under
          // the 120 writes/min quota.
          onWpmChange: (next) => {
            saveSettings({ wpm: next }).catch((err: unknown) => {
              console.warn('[speedreader] wpm persist failed', err);
            });
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
