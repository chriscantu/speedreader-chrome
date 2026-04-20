export default {
  manifest_version: 3,
  name: 'SpeedReader',
  version: '0.1.0',
  description: 'RSVP reading accessibility extension for Chrome',
  permissions: ['activeTab', 'scripting'],
  action: {
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
} satisfies chrome.runtime.ManifestV3;