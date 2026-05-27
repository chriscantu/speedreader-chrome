/**
 * overlay.spec.ts — "overlay element + ORP word appears" cover spec (#38).
 *
 * Constraints documented inline (state of the codebase, 2026-05-26):
 *
 * 1. The RSVP overlay implementation is TODO(#5) / tracked under #19
 *    and #20. `src/chrome/content/index.ts` does NOT mount an overlay
 *    today; the activation handler returns `{ ok: true }` ahead of
 *    overlay code (see the comment block in
 *    `src/chrome/content/activate-handler.ts`).
 *
 * 2. `activeTab` is gesture-bound; Playwright cannot drive
 *    SW → executeScript against the active tab (see extraction.spec.ts
 *    constraint #2 and `experiments/activeTab-commands-check/`).
 *
 * Closest viable assertion path: simulate the overlay-injection target
 * by inline-injecting the built CS chunk into the page via Playwright
 * (`page.addScriptTag({ content: ... })`). The injected script runs in
 * the page's main world, which is NOT the isolated-world context the
 * extension uses — `chrome.runtime` is not available. So we cannot
 * exercise the `chrome.runtime.onMessage` listener path from this seam.
 *
 * The remaining cheap-but-honest assertion: verify the built CS chunk
 * declares the overlay-related selectors / no-overlay-yet contract the
 * design pack documents. When #19 lands and the overlay mounts, flip
 * this to a positive `page.locator('#speedreader-overlay').isVisible()`
 * assertion driven through whatever gesture-surrogate the overlay path
 * exposes.
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

test('overlay slot reserved; no overlay in DOM until #19 lands', async () => {
  if (!handle) throw new Error('extension context not initialized');
  const page = await handle.context.newPage();
  await page.goto('http://127.0.0.1:5173/article.html');

  // The fixture page is clean before any extension activity.
  await expect(page.locator('#speedreader-overlay')).toHaveCount(0);

  // The built CS chunk loads the activate-handler module — proves the
  // overlay's prerequisite (a registered activate-reader listener) is
  // shipped. When #19 lands, the CS chunk will additionally contain
  // overlay DOM construction; tighten this assertion then.
  const csFile = findContentScriptFile();
  const csBody = readFileSync(join(extensionPath, csFile), 'utf8');
  expect(csBody).toContain('Content script loaded');
  expect(csBody).toContain('activate-reader');
  // Pre-#19 negative: no overlay-mount marker in the bundle yet. When
  // #19 lands and adds `#speedreader-overlay`, flip this to a positive
  // contains() check.
  expect(csBody.includes('speedreader-overlay')).toBe(false);

  await page.close();
});
