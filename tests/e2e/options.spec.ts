/**
 * options.spec.ts — options page renders and persists settings (#31).
 *
 * Loads the unpacked extension, opens `chrome-extension://<id>/.../options/index.html`,
 * changes WPM + theme via the rendered form, reopens the page, and asserts
 * the values survived `chrome.storage.sync`.
 *
 * Constraint: relies on the V4 settings storage layer
 * (`src/chrome/settings/storage.ts`), which round-trips through
 * `chrome.storage.sync`. Persistence is observable across same-extension
 * tab reloads inside the persistent context.
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

test('options page renders V4 form surface', async () => {
  if (!handle) throw new Error('extension context not initialized');
  const url = `chrome-extension://${handle.extensionId}/src/chrome/options/index.html`;
  const page = await handle.context.newPage();
  await page.goto(url);

  await expect(page.locator('h1')).toHaveText('SpeedReader Options');
  // Every V4 editable field is present.
  for (const id of [
    'wpm',
    'theme',
    'font',
    'fontSize',
    'alignment',
    'openDyslexic',
    'punctuationPacing',
    'contextLine',
    'startFromWordOne',
  ]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  // Theme select exposes the V4 7-value enum.
  const themeValues = await page.locator('#theme option').evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value),
  );
  expect(themeValues).toEqual(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord']);

  await page.close();
});

test('options page persists WPM + theme across reload', async () => {
  if (!handle) throw new Error('extension context not initialized');
  const url = `chrome-extension://${handle.extensionId}/src/chrome/options/index.html`;

  const page = await handle.context.newPage();
  await page.goto(url);
  // Wait for initial populate (loadSettings + populate runs on DOMContentLoaded).
  await expect(page.locator('#wpm')).not.toHaveValue('');

  await page.locator('#wpm').fill('420');
  await page.locator('#wpm').dispatchEvent('change');
  await page.locator('#theme').selectOption('nord');

  // Visibility-hidden flushes the 300ms debounce window deterministically.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // Small grace for the flush's awaited set() to resolve.
  await page.waitForTimeout(200);
  await page.close();

  const page2 = await handle.context.newPage();
  await page2.goto(url);
  await expect(page2.locator('#wpm')).toHaveValue('420');
  await expect(page2.locator('#theme')).toHaveValue('nord');
  await page2.close();
});
