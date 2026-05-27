/**
 * extraction.spec.ts — "extraction runs on a fixture page" cover spec (#38).
 *
 * Constraints documented inline (state of the codebase, 2026-05-26):
 *
 * 1. The article-extraction pipeline + overlay mount are TODO(#5) — see
 *    `src/chrome/content/index.ts`. The activation handler returns
 *    `{ ok: true }` WITHOUT mounting an overlay, ahead of the overlay
 *    implementation (issues #17 / #19 / #20).
 *
 * 2. `activeTab` is gesture-bound. Playwright cannot dispatch the
 *    gesture-provenance signal Chromium requires to grant host access
 *    via `activeTab` — the SW's `chrome.scripting.executeScript` against
 *    a tab fails with "Extension manifest must request permission to
 *    access the respective host." This is documented in
 *    `experiments/activeTab-commands-check/tests/d10.spec.ts` (see its
 *    T2/T4 scope note) and IS the correct Chromium behavior, not a bug.
 *
 * Closest viable assertion path under those constraints: verify the
 * fixture page is reachable over http (not file://), and verify the
 * funnel's preconditions hold inside the SW — namely that the funnel's
 * `CONTENT_SCRIPT_FILE` constant resolves to a real chunk in dist, that
 * the chunk contains the CS-side `activate-reader` handler, and that
 * `chrome.scripting.executeScript` is available. When extraction (#17)
 * lands, replace this with an end-to-end extraction → overlay assertion
 * driven through whatever gesture-surrogate the gesture-bearing path
 * acquires (e.g., a test-only externally-connectable bridge, or a
 * page-side click that the popup wires).
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  launchExtensionContext,
  closeExtensionContext,
  findContentScriptFile,
  extensionPath,
  type ExtensionHandle,
} from './fixtures/extension';

let handle: ExtensionHandle | undefined;

test.beforeAll(async () => {
  handle = await launchExtensionContext();
});

test.afterAll(async () => {
  await closeExtensionContext(handle);
  handle = undefined;
});

test('fixture article is reachable over http and funnel preconditions hold', async () => {
  if (!handle) throw new Error('extension context not initialized');

  // 1. Fixture loads over http (not file://) — the funnel treats file://
  //    URLs as restricted, so an http-served fixture is load-bearing.
  const page = await handle.context.newPage();
  const response = await page.goto('http://127.0.0.1:5173/article.html');
  expect(response?.ok()).toBe(true);
  expect(page.url().startsWith('http://')).toBe(true);
  await expect(page.locator('h1')).toHaveText('The Quiet Power of Slow Reading');
  // Fixture has 1 byline + 5 body paragraphs.
  await expect(page.locator('article p')).toHaveCount(6);

  // 2. The CS chunk emitted by the build contains the activate-reader
  //    handler keyword — proves the bundle the funnel injects actually
  //    carries the listener that responds to `{ type: 'activate-reader' }`.
  const csFile = findContentScriptFile();
  const csBody = readFileSync(join(extensionPath, csFile), 'utf8');
  expect(csBody).toContain('activate-reader');

  // 3. SW has the APIs the funnel relies on, and the manifest declares
  //    the permissions the runtime path needs.
  const swSurface = await handle.serviceWorker.evaluate(() => {
    const manifest = chrome.runtime.getManifest();
    return {
      hasScripting: typeof chrome.scripting?.executeScript === 'function',
      hasTabsSendMessage: typeof chrome.tabs?.sendMessage === 'function',
      permissions: manifest.permissions ?? [],
    };
  });
  expect(swSurface.hasScripting).toBe(true);
  expect(swSurface.hasTabsSendMessage).toBe(true);
  expect(swSurface.permissions).toEqual(expect.arrayContaining(['activeTab', 'scripting']));

  await page.close();
});
