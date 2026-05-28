/**
 * E2E-only extension build with `host_permissions: ['<all_urls>']`
 * added via `SPEEDREADER_E2E=1` env in src/chrome/manifest.ts.
 *
 * Produced output: `dist-e2e-ext/`. Loaded by
 * tests/e2e/overlay-activation-chain.spec.ts via Playwright
 * --load-extension. Adding host_permissions lets the SW invoke
 * `chrome.scripting.executeScript` without a real user gesture —
 * activeTab requires gesture-provenance which CDP cannot dispatch
 * (see experiments/activeTab-commands-check/).
 *
 * NEVER ship this build. Production uses `npm run build` against
 * vite.config.ts which omits host_permissions.
 */
import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';

// Lazy-load the manifest so the env flag is read when this config
// is evaluated by Vite (env set by the npm script wrapping us).
async function loadManifest(): Promise<Record<string, unknown>> {
  process.env.SPEEDREADER_E2E = '1';
  const mod = await import('./src/chrome/manifest');
  return mod.default as Record<string, unknown>;
}

export default defineConfig(async () => ({
  plugins: [
    crx({
      manifest: (await loadManifest()) as Parameters<typeof crx>[0]['manifest'],
      browser: 'chrome',
    }),
  ],
  build: {
    minify: true,
    outDir: 'dist-e2e-ext',
    emptyOutDir: true,
  },
}));
