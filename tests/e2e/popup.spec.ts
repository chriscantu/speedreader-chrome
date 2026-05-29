/**
 * popup.spec.ts — "popup opens, renders" cover spec (issue #38).
 *
 * The popup is `src/chrome/popup/index.html` + `index.ts`. Issue #18 turned
 * the prior "Ready" stub into a two-button surface:
 *   - h1 "SpeedReader"
 *   - <button id="read-article">Read article</button>
 *   - <button id="read-selection">Read selection</button> (gated on a
 *     selection probe of the active tab)
 *   - <div id="status" role="status"> that the bootstrap fills with
 *     state ("No active tab…", "Activating…", error text, etc.)
 *
 * Constraint documented inline (issue #38 ask: "open extension popup, assert
 * renders"): Chrome browser-action popups can only be opened by a real user
 * click on the toolbar icon, which Playwright cannot dispatch with gesture
 * provenance against an extension action. The next-best assertion is to
 * navigate directly to the popup's html URL inside an extension-origin tab
 * — this exercises the SAME html + js bundle the toolbar click would load.
 * Behavior delta: in this mode the popup is NOT bound to a target tab, but
 * the render assertions ("does the popup html load + the script run") are
 * unchanged.
 */
import { test, expect } from '@playwright/test';
import {
  launchExtensionContext,
  closeExtensionContext,
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

test('popup renders heading and the two activation buttons', async () => {
  if (!handle) throw new Error('extension context not initialized');
  const popupUrl = `chrome-extension://${handle.extensionId}/src/chrome/popup/index.html`;
  const page = await handle.context.newPage();
  await page.goto(popupUrl);

  await expect(page.locator('h1')).toHaveText('SpeedReader');
  await expect(page.locator('#read-article')).toBeVisible();
  await expect(page.locator('#read-selection')).toBeVisible();
  // Status element is wired with role=status; visible regardless of the
  // text the bootstrap settles on (which depends on whether a target tab
  // is reachable through the extension-origin navigation).
  await expect(page.locator('#status')).toHaveAttribute('role', 'status');

  await page.close();
});
