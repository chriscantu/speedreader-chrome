import { defineConfig, type Plugin } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import manifest from './src/chrome/manifest';

/**
 * Alias the welcome HTML to `dist/welcome.html` so the URL contract in
 * `2026-05-30-onboarding-surface.md` (AC #5) — `chrome-extension://<id>/welcome.html` —
 * matches what the SW's `chrome.runtime.getURL('welcome.html')` call expects.
 *
 * Vite + crxjs together preserve the source path of HTML inputs in `dist/`
 * (so `src/chrome/welcome/index.html` lands at
 * `dist/src/chrome/welcome/index.html`). The spec's claim that the
 * `rollupOptions.input` key alone produces `dist/welcome.html` is only true
 * for the bare-Vite build path; with the crxjs plugin in the chain the
 * source path is preserved. Rather than push the source HTML to the repo
 * root (breaks `src/chrome/popup/` parity) or rewrite the SW to use the
 * long path (loses AC #5's URL contract), we duplicate the file at
 * `dist/welcome.html` after the bundle is written. The emitted HTML uses
 * absolute `/assets/*` URLs so both copies resolve their scripts correctly.
 */
function aliasWelcomeHtml(): Plugin {
  return {
    name: 'speedreader:alias-welcome-html',
    apply: 'build',
    closeBundle() {
      const src = join('dist', 'src', 'chrome', 'welcome', 'index.html');
      const dest = join('dist', 'welcome.html');
      if (!existsSync(src)) {
        // Build didn't produce the expected source — fail loudly so the
        // dropped emission is caught by the verify gate, not at install.
        throw new Error(
          `aliasWelcomeHtml: expected ${src} but it does not exist. ` +
            `vite.config.ts rollupOptions.input.welcome may be misconfigured.`,
        );
      }
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    },
  };
}

export default defineConfig({
  plugins: [
    crx({
      manifest,
      browser: 'chrome',
    }),
    aliasWelcomeHtml(),
  ],
  build: {
    minify: true,
    outDir: 'dist',
    rollupOptions: {
      // crxjs auto-discovers HTML build inputs from manifest entry fields
      // (action.default_popup, options_page) and web_accessible_resources.
      // welcome.html is referenced from neither — it's only opened by the
      // service worker via `chrome.tabs.create(chrome.runtime.getURL(...))`.
      // Without this explicit input, crxjs would not emit it at all and
      // `chrome.runtime.getURL('welcome.html')` would 404 at runtime.
      // See docs/superpowers/specs/2026-05-30-onboarding-surface.md
      // §"Manifest Delta + URL Contract".
      input: {
        welcome: 'src/chrome/welcome/index.html',
      },
    },
  },
});
