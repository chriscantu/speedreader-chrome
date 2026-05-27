import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * E2E harness config (issue #38).
 *
 * Notes for future maintainers:
 * - Extension MV3 loading requires `--load-extension` + a persistent context.
 *   The actual `launchPersistentContext` call lives in each spec's
 *   `beforeAll`, because Playwright's project-level `use.launchOptions` does
 *   not cover persistent contexts. The shared `extensionPath` lives in
 *   `tests/e2e/fixtures/extension.ts`.
 * - `headless: false` is required for extensions; Chromium does not load
 *   `--load-extension` paths in headless mode (this is a documented Chrome
 *   constraint). CI runs under `xvfb-run` on Linux runners.
 * - The fixture server serves `tests/e2e/fixtures/` over http so the
 *   service worker / content script see a real origin (not file://).
 */
export default defineConfig({
  testDir: resolve(here, 'tests/e2e'),
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  webServer: {
    // http-server is not a dep; use `npx serve` via node's built-in?
    // Use node's `http.createServer` through a tiny script so we don't pull
    // in another dep. Script lives at tests/e2e/fixtures/serve.mjs.
    command: 'node tests/e2e/fixtures/serve.mjs',
    url: 'http://127.0.0.1:5173/article.html',
    timeout: 10_000,
    reuseExistingServer: !process.env.CI,
  },
});
