/**
 * overlay-activation-chain.spec.ts — full SW → CS isolated-world → overlay
 * verification on a real article (#19).
 *
 * Drives the SAME activation path production uses end-to-end:
 *   1. SW calls `chrome.scripting.executeScript` to inject the CS into a
 *      real article tab
 *   2. CS runs in its isolated world, registers `chrome.runtime.onMessage`
 *   3. SW sends `{ type: 'activate-reader' }` via `chrome.tabs.sendMessage`
 *   4. CS handler verifies non-restricted, mounts overlay (shadow DOM in
 *      isolated world)
 *   5. axe-core scan against the live shadow subtree
 *   6. Esc keypress → CS teardown → host element removed
 *
 * Closes the test gap left by `overlay-real-article.spec.ts`, which uses
 * `addInitScript` (main world) — the production CS runs in the ISOLATED
 * world, where shadow-DOM lookups and adoptedStyleSheets interact with a
 * different `Window` / `document` instance.
 *
 * Bypass mechanism: the e2e build (`dist-e2e-ext/`) adds
 * `host_permissions: ['<all_urls>']` to the manifest. Production runs on
 * `activeTab` which requires a real user gesture (CDP cannot dispatch
 * gesture-provenance — see experiments/activeTab-commands-check/). The
 * extra permission lets the SW's `executeScript` succeed without a
 * gesture; the rest of the pipeline is identical to production.
 *
 * Run on demand:
 *   npm run build:e2e-ext
 *   npx playwright test tests/e2e/overlay-activation-chain.spec.ts
 *
 * Network-dependent (real articles). Not part of the standard CI gate.
 */
import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '..', '..', 'dist-e2e-ext');

// Network-dependent + requires `npm run build:e2e-ext` upfront. Opt-in
// only; same pattern as tests/e2e/profiling/cs-heap-fanout.spec.ts.
// Run locally with RUN_ACTIVATION_CHAIN=1.
test.skip(
  !process.env.RUN_ACTIVATION_CHAIN,
  'Network-dependent activation-chain spec — set RUN_ACTIVATION_CHAIN=1 to run',
);

function findContentScriptLoader(): string {
  // Production uses the crxjs loader chunk (index.ts-loader-*.js) which
  // dynamically imports the actual CS module via chrome.runtime.getURL.
  // executeScript({ files: [loader] }) wraps the ESM import correctly;
  // executing the inner module chunk directly fails because ESM
  // top-level `import` statements aren't supported in classic scripts.
  const assetsDir = join(extensionPath, 'assets');
  const files = readdirSync(assetsDir).filter(
    (f) => /^index\.ts-loader-.*\.js$/.test(f),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one CS loader in ${assetsDir}, found ${files.length}: ${files.join(', ')}`,
    );
  }
  return `assets/${files[0]}`;
}

let context: BrowserContext | undefined;
let sw: Worker | undefined;
let userDataDir: string | undefined;
let csFile: string;

test.describe('full activation chain on real article (#19)', () => {
  test.beforeAll(async () => {
    if (!existsSync(extensionPath)) {
      throw new Error(
        `${extensionPath} missing. Run \`npm run build:e2e-ext\` first.`,
      );
    }
    csFile = findContentScriptLoader();
    userDataDir = mkdtempSync(resolve(tmpdir(), 'speedreader-activation-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: { width: 1280, height: 720 },
    });
    const existing = context.serviceWorkers();
    sw = existing[0] ?? (await context.waitForEvent('serviceworker'));
  });

  test.afterAll(async () => {
    await context?.close().catch(() => undefined);
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  });

  for (const url of [
    'https://en.wikipedia.org/wiki/Rapid_serial_visual_presentation',
    'https://developer.mozilla.org/en-US/docs/Web/HTML',
  ]) {
    test(`overlay mounts via SW→CS chain on ${new URL(url).host}`, async () => {
      if (!context || !sw) throw new Error('context not initialized');
      test.setTimeout(60_000);

      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // A/B baseline screenshot (page without overlay)
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `test-results/activation-${new URL(url).host}-baseline.png`,
        fullPage: false,
      });

      const tabId = await sw.evaluate(async () => {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const id = tabs[0]?.id;
        if (typeof id !== 'number') throw new Error('no active tab id');
        return id;
      });

      // 1. Inject CS into the article tab (isolated world)
      // 2. Dispatch activate-reader (CS handler mounts overlay)
      await sw.evaluate(
        async ({ tabId, file }) => {
          await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
        },
        { tabId, file: csFile },
      );
      // The loader dynamic-imports the actual CS module asynchronously.
      // Wait for the listener registration by polling the marker the CS
      // logs on module load.
      await page.waitForFunction(
        () => {
          // The CS console.log fires AFTER the listener registration.
          // We can't read the log buffer; instead, the CS sets up the
          // listener which sendMessage will hit. Re-attempt sendMessage
          // until it succeeds (caught here as no thrown error from the
          // SW eval below).
          return true;
        },
        { timeout: 5000 },
      );
      // Retry sendMessage until the CS listener is registered.
      await test.step('sendMessage with retry until CS listener present', async () => {
        if (!sw) throw new Error('sw not initialized');
        const deadline = Date.now() + 5000;
        let lastErr: unknown = null;
        while (Date.now() < deadline) {
          try {
            await sw.evaluate(async (tabId) => {
              await chrome.tabs.sendMessage(tabId, { type: 'activate-reader' });
            }, tabId);
            return;
          } catch (e) {
            lastErr = e;
            await new Promise((r) => setTimeout(r, 100));
          }
        }
        throw new Error(`sendMessage retry exhausted: ${String(lastErr)}`);
      });

      // Overlay should appear via the real production chain
      await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(1, {
        timeout: 5000,
      });

      // Screenshot for visual review
      await page.screenshot({
        path: `test-results/activation-${new URL(url).host}-mounted.png`,
        fullPage: false,
      });

      // axe scan against the OPEN shadow root in the CS isolated world
      const results = await new AxeBuilder({ page })
        .include('[data-speedreader-overlay]')
        .analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);

      // Esc teardown
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-speedreader-overlay]')).toHaveCount(0);

      await page.close();
    });
  }
});
