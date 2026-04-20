/**
 * SpeedReader Chrome Extension — Manifest V3
 *
 * This manifest is the single source of truth for the extension's
 * Chrome Web Store configuration.  Every permission and host
 * permission is documented with a user-facing justification in
 * `docs/permission-justifications.md` (precursor to the store-listing
 * doc).
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
    service_worker: 'src/background/index.ts',
  },

  // --- Browser action (popup) ---------------------------------------------
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'SpeedReader',
    default_icon: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },

  // --- Options page -------------------------------------------------------
  options_page: 'src/options/index.html',

  // --- Permissions (non-host) ---------------------------------------------
  // Each permission is justified in docs/permission-justifications.md.
  permissions: ['storage', 'activeTab', 'scripting'],

  // --- Host permissions ---------------------------------------------------
  // Required so the content script can run on any article page.
  // Justification: SpeedReader is a general-purpose reading tool and must
  // work on any URL the user visits.  See docs/permission-justifications.md.
  host_permissions: ['<all_urls>'],

  // --- Content scripts ----------------------------------------------------
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],

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
  // See issue #34 for full hotkey configuration.
  // MVP: a single global shortcut to launch the reader from any page.
  commands: {
    _toggle_reader: {
      suggested_key: {
        default: 'Ctrl+Shift+Y',
        mac: 'Ctrl+Shift+Y',
      },
      description: 'Toggle SpeedReader overlay',
    },
  },

  // --- Icons --------------------------------------------------------------
  // Used by Chrome Web Store and the extension toolbar.  See issue #11.
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
} satisfies chrome.runtime.ManifestV3;