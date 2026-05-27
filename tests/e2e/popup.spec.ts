/**
 * popup.spec.ts — "popup opens, renders" cover spec (issue #38).
 *
 * The popup is `src/chrome/popup/index.html` + `index.ts`. Today (2026-05-26)
 * the popup is a stub: it renders an <h1>SpeedReader</h1>, an instructional
 * <p>, and a status <div id="status"> whose text the script sets to "Ready".
 * See `src/chrome/popup/index.ts` (TODO(#5)).
 *
 * Constraint documented inline (issue #38 ask: "open extension popup, assert
 * renders"): Chrome browser-action popups can only be opened by a real user
 * click on the toolbar icon, which Playwright cannot dispatch with gesture
 * provenance against an extension action. The next-best assertion is to
 * navigate directly to the popup's html URL inside an extension-origin tab
 * — this exercises the SAME html + js bundle the toolbar click would load.
 * Behavior delta: in this mode the popup is NOT bound to a target tab, but
 * the render assertions ("does the popup html load + the script run + the
 * status element populate") are unchanged.
 */
import { test, expect } from '@playwright/test';
import { launchExtensionContext, closeExtensionContext, type ExtensionHandle } from './fixtures/extension';

let handle: ExtensionHandle | undefined;

test.beforeAll(async () => {
  handle = await launchExtensionContext();
});

test.afterAll(async () => {
  await closeExtensionContext(handle);
  handle = undefined;
});

test('popup renders heading and status', async () => {
  if (!handle) throw new Error('extension context not initialized');
  const popupUrl = `chrome-extension://${handle.extensionId}/src/chrome/popup/index.html`;
  const page = await handle.context.newPage();
  await page.goto(popupUrl);

  await expect(page.locator('h1')).toHaveText('SpeedReader');
  // index.ts sets #status textContent to "Ready" on DOMContentLoaded.
  await expect(page.locator('#status')).toHaveText('Ready');

  await page.close();
});
