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
import { resolveFontId } from '../../core/overlay/font-ids';
import { createChromePositionStore } from '../storage/chrome-position-store';

console.log('[SpeedReader] Content script loaded');

let activeOverlay: OverlayHandle | null = null;

// #48 — persistent per-URL reading-position store. Module-scoped so a
// fresh activation reuses the same chrome.storage.local adapter. The
// store itself is stateless; the singleton is just an allocation
// hygiene measure.
const positionStore = createChromePositionStore();

// #48 — single module-load warn when the local-storage surface is
// missing (test harnesses, non-MV3 hosts). Matches the
// `chrome.runtime.getURL` branch below — emit ONCE so per-mount
// retries don't spam the console.
if (typeof chrome === 'undefined' || !chrome.storage?.local) {
  console.warn(
    '[speedreader] chrome.storage.local unavailable, reading-position persistence disabled',
  );
}

/**
 * #48 — debounce reading-position writes. The overlay emits an
 * `onWordAdvance` callback for every word event (~10 Hz at 600 wpm).
 * `chrome.storage.local` has no published per-minute write quota the
 * way `.sync` does, but writing 10×/sec for the duration of a long
 * article is wasteful disk I/O. A 1 s trailing-edge debounce keeps
 * the on-disk position no more than a second stale, which is well
 * within the resume-experience floor.
 */
const POSITION_WRITE_DEBOUNCE_MS = 1_000;

interface PendingWrite {
  url: string;
  wordIndex: number;
  totalWords: number;
}

let pendingWrite: PendingWrite | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePositionWrite(write: PendingWrite): void {
  pendingWrite = write;
  if (pendingTimer !== null) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const w = pendingWrite;
    pendingWrite = null;
    if (!w) return;
    positionStore
      .write(w.url, { wordIndex: w.wordIndex, totalWords: w.totalWords })
      .catch((err: unknown) => {
        console.warn('[speedreader] reading-position write failed', err);
      });
  }, POSITION_WRITE_DEBOUNCE_MS);
}

function flushPendingPositionWrite(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  const w = pendingWrite;
  pendingWrite = null;
  if (!w) return;
  positionStore
    .write(w.url, { wordIndex: w.wordIndex, totalWords: w.totalWords })
    .catch((err: unknown) => {
      console.warn('[speedreader] reading-position flush failed', err);
    });
}

/**
 * #48 — flush hooks for tab teardown. The browser fires `pagehide`
 * when the tab navigates away, closes, or enters the back-forward
 * cache; `visibilitychange` with `document.visibilityState === 'hidden'`
 * fires when the user switches tabs / minimises the window AND covers
 * the iOS-Safari case where `pagehide` is the only signal. Catch both
 * so an article the user just stepped away from has its latest
 * position pinned before any debounce timer would have fired.
 *
 * These are NOT awaited — fire-and-forget is correct here. We can't
 * meaningfully delay tab unload, and the SW (via `chrome.storage.local`)
 * will queue the IDB write into its own lifecycle. Tracked separately
 * by #195: a future SW-owned store may upgrade this to a message-port
 * `dispatch+ack` if eviction proves to drop writes in the wild.
 *
 * Listeners attach on first overlay mount and detach on overlay
 * teardown so the content script (which outlives the overlay across
 * close/reopen cycles) doesn't leak handlers across mounts.
 */
let positionFlushListenersAttached = false;
function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    flushPendingPositionWrite();
  }
}
function onPageHide(): void {
  flushPendingPositionWrite();
}
function attachPositionFlushListeners(): void {
  if (positionFlushListenersAttached) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  positionFlushListenersAttached = true;
}
function detachPositionFlushListeners(): void {
  if (!positionFlushListenersAttached) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('pagehide', onPageHide);
  positionFlushListenersAttached = false;
}

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
        const sessionResume = resumeIndex(scope, activeStreamLength);

        // #48 — persistent per-URL resume. Only applies to full-article
        // mounts; selection scope is a per-session ephemeral construct
        // (the selection itself doesn't survive page navigation, so a
        // persisted selection position cannot be replayed). The
        // in-session sessionResume above still handles selection-scope
        // close/reopen within the same content-script lifetime.
        //
        // The chrome.storage.local guard handles test harnesses + non-MV3
        // host environments that stub a partial `chrome` surface without
        // the local namespace; the persistence path silently degrades
        // when storage is unavailable. The single module-load warn at
        // the top of the file leaves a breadcrumb without spamming
        // per-mount.
        const pageUrl = window.location.href;
        const persistAvailable = !!chrome.storage?.local;
        if (persistAvailable && scope === 'full') {
          attachPositionFlushListeners();
        }
        let persistentResume: number | undefined;
        if (persistAvailable && scope === 'full' && sessionResume === undefined) {
          try {
            const saved = await positionStore.read(pageUrl);
            if (saved !== undefined && saved.wordIndex > 0 && saved.wordIndex < fullWords.length) {
              persistentResume = saved.wordIndex;
            }
          } catch (err: unknown) {
            console.warn('[speedreader] reading-position read failed', err);
          }
        }
        const initialIndex = sessionResume ?? persistentResume;
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
            // #28 — resolve the persisted font string to a FontId before
            // crossing the core boundary. resolveFontId promotes legacy
            // `openDyslexic: true` payloads and snaps unknown literals to
            // 'system', so the overlay's typed `font?: FontId` slot stays
            // honest at the boundary.
            font: resolveFontId(settings),
            // #51 — chunk size pinned at mount. Live-update via
            // subscribeSettings is intentionally NOT wired (engine
            // reconstruction required); changes apply on next overlay
            // mount.
            chunkSize: settings.chunkSize,
          },
          subscribeSettings: (listener) =>
            subscribeSettings((s) =>
              listener({
                theme: s.theme,
                wpm: s.wpm,
                fontSize: s.fontSize,
                openDyslexic: s.openDyslexic,
                font: resolveFontId(s),
                chunkSize: s.chunkSize,
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
          // #48 — toast the persistent resume so the user knows their
          // position was restored AND has a one-click escape hatch to
          // start the article over. We pass the toast ONLY when the
          // persistent path supplied the index — session-resume (#25)
          // happens silently within the same page lifetime where the
          // user implicitly knows they just closed and reopened.
          resumeToast:
            persistentResume !== undefined
              ? {
                  totalWords: fullWords.length,
                  onStartOver: () => {
                    // Drop the persisted position so the next visit
                    // starts fresh. Cancel any pending write so the
                    // debounced flush doesn't immediately re-create
                    // the entry against the rewound index.
                    if (pendingTimer !== null) {
                      clearTimeout(pendingTimer);
                      pendingTimer = null;
                    }
                    pendingWrite = null;
                    positionStore.clear(pageUrl).catch((err: unknown) => {
                      console.warn('[speedreader] reading-position clear failed', err);
                    });
                  },
                }
              : undefined,
          // #48 — per-word advance. Only persisted for full-scope
          // mounts (selection-scope positions cannot be replayed across
          // navigation). The store is keyed by canonical URL so utm
          // tags, fragments, and host casing all collapse into one
          // slot. Writes are debounced so we land at most one set per
          // second; closing the overlay flushes any pending write.
          onWordAdvance:
            persistAvailable && scope === 'full'
              ? (index, total) => {
                  schedulePositionWrite({
                    url: pageUrl,
                    wordIndex: index,
                    totalWords: total,
                  });
                }
              : undefined,
          onClose: (snapshot) => {
            activeOverlay = null;
            recordClose(snapshot);
            // #48 — flush any pending debounced position write before
            // the page may unload. setTimeout(0) inside flush would
            // race; we call the store directly.
            flushPendingPositionWrite();
            // Drop the visibility / pagehide listeners — the content
            // script outlives the overlay across close/reopen cycles,
            // so leaving them attached would (a) hold dead closures
            // referencing this mount's `pageUrl` and (b) re-fire the
            // flush every time the user backgrounds the tab, even
            // with no overlay active. They're re-attached on the next
            // mount.
            detachPositionFlushListeners();
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
