/**
 * SpeedReader Chrome Extension — Manifest V3
 *
 * This manifest is the single source of truth for the extension's
 * Chrome Web Store configuration.  Every permission is documented with
 * a user-facing justification in `docs/permission-justifications.md`
 * (precursor to the store-listing doc).
 *
 * Injection model: lazy / on-demand.  No `content_scripts` entry — the
 * content script is injected by the service worker via
 * `chrome.scripting.executeScript` after the user opens the popup.  The
 * `activeTab` permission grants temporary host access on user gesture,
 * which removes the need for `host_permissions: ['<all_urls>']`.
 *
 * See:
 * - `docs/superpowers/decisions/2026-05-08-lazy-injection-manifest.md`
 * - `docs/superpowers/specs/2026-05-08-article-extraction.md`
 *   §"Trigger Timing — lazy on popup-open"
 *
 * Fields referenced by later issues are marked with TODO(#N).
 */

export default {
  manifest_version: 3,
  name: 'SpeedReader',
  version: '0.1.0',
  description: 'RSVP reading accessibility extension for Chrome',

  // --- Background service worker ------------------------------------------
  // Holds persistent state and handles messaging between content scripts
  // and the popup/options page.  No UI — purely a message bus.
  background: {
    service_worker: 'src/chrome/background/index.ts',
  },

  // --- Browser action (popup) ---------------------------------------------
  action: {
    default_popup: 'src/chrome/popup/index.html',
    default_title: 'SpeedReader',
    default_icon: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },

  // --- Options page -------------------------------------------------------
  options_page: 'src/chrome/options/index.html',

  // --- Permissions --------------------------------------------------------
  // Each permission is justified in docs/permission-justifications.md.
  //
  // - storage    — persist user settings (WPM, font, theme).
  // - activeTab  — grants temporary host access to the active tab on user
  //                gesture (popup click).  Replaces `<all_urls>` host
  //                permissions for the lazy-injection model.
  // - scripting  — required to call `chrome.scripting.executeScript` from
  //                the service worker to inject the content script on
  //                demand.
  permissions: ['storage', 'activeTab', 'scripting'],

  // --- Host permissions: intentionally omitted ----------------------------
  // The lazy-injection model (popup-open → service worker →
  // chrome.scripting.executeScript against the active tab) runs entirely
  // under `activeTab`.  See ADR
  // `docs/superpowers/decisions/2026-05-08-lazy-injection-manifest.md`.

  // --- Content scripts: intentionally omitted -----------------------------
  // The content script is injected on demand via
  // `chrome.scripting.executeScript`, NOT registered for eager match-all
  // injection.  Eager injection would impose per-tab CPU cost on pages
  // the user never invokes SpeedReader on.

  // --- Web accessible resources -------------------------------------------
  // Fonts bundled with the extension so content scripts can reference them
  // via chrome.runtime.getURL().  See issue #10.
  web_accessible_resources: [
    {
      resources: ['fonts/*'],
      matches: [], // limited per-site in production; <all_urls> for MVP
    },
  ],

  // --- Commands (keyboard shortcuts) --------------------------------------
  // Single global shortcut to toggle the reader from any (non-restricted)
  // page. Wired in the SW via `chrome.commands.onCommand`, which normalizes
  // to an `ActivationIntent` and routes through `dispatchActivation`.
  //
  // Mac binding uses `MacCtrl+Shift+Y` (literal Control, NOT Cmd):
  //   - `Cmd+Shift+Y` is reserved by Chrome on Mac (History).
  //   - `Cmd+Shift+R` collides with hard-reload.
  // The D10 reproducer (`experiments/activeTab-commands-check/`) uses the
  // same binding and confirms activeTab grants host access on the
  // commands-gesture path without `host_permissions`.
  //
  // The `commands` API is implicit — no new permission entry required.
  //
  // See:
  // - issue #34
  // - `docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md`
  commands: {
    _toggle_reader: {
      suggested_key: {
        default: 'Ctrl+Shift+Y',
        mac: 'MacCtrl+Shift+Y',
      },
      description: 'Toggle SpeedReader',
    },
  },

  // --- externally_connectable: intentionally omitted ----------------------
  // NO externally_connectable. Web origins MUST NOT reach our onMessage/onConnect.
  // MV3 default is closed; this comment exists to surface the invariant for future PRs.
  // See ADR docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md §5.

  // --- Icons --------------------------------------------------------------
  // Used by Chrome Web Store and the extension toolbar.  See issue #11.
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
} satisfies chrome.runtime.ManifestV3;
