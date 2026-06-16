/**
 * position-isolation.spec.ts — #196 headline E2E: the runtime proof that a
 * content script CANNOT reach `chrome.storage.local` after the SW gates it,
 * inside the REAL extension (not just the `experiments/idb-isolation-check`
 * reproducer harness).
 *
 * Acceptance criterion (spec §Acceptance Criteria / §Test Strategy):
 *   after the SW has gated `local`, from a CS context attempt
 *   `chrome.storage.local.get(null)` and `chrome.storage.local.get('position:…')`
 *   — confirm BOTH fail (access denied, no records), so neither this page's nor
 *   any other origin's position is reachable; and confirm the trusted SW
 *   context still reads the seeded record.
 *
 * Bypass mechanism: the e2e build (`dist-e2e-ext/`) adds
 * `host_permissions: ['<all_urls>']` so `executeScript` succeeds without a
 * gesture (CDP cannot dispatch gesture-provenance). The SW's top-level
 * access-gate (`setAccessLevel('TRUSTED_CONTEXTS')`) is identical to production.
 *
 * Requires the Chrome-140+ `local.setAccessLevel` floor — Playwright's bundled
 * Chrome for Testing (148) satisfies it.
 *
 * Run on demand (opt-in; not part of the standard CI gate — same convention as
 * the other extension-loading specs):
 *   npm run build:e2e-ext
 *   RUN_POSITION_ISOLATION=1 npx playwright test tests/e2e/position-isolation.spec.ts
 */
import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '..', '..', 'dist-e2e-ext');

test.skip(
  !process.env.RUN_POSITION_ISOLATION,
  'Extension-loading isolation spec — set RUN_POSITION_ISOLATION=1 to run (needs `npm run build:e2e-ext`)',
);

const PORT = 5174;
const PAGE_URL = `http://127.0.0.1:${PORT}/article.html`;

function findContentScriptLoader(): string {
  const assetsDir = join(extensionPath, 'assets');
  const files = readdirSync(assetsDir).filter((f) => /^index\.ts-loader-.*\.js$/.test(f));
  if (files.length !== 1) {
    throw new Error(`Expected exactly one CS loader, found ${files.length}: ${files.join(', ')}`);
  }
  return `assets/${files[0]}`;
}

let context: BrowserContext | undefined;
let sw: Worker | undefined;
let userDataDir: string | undefined;
let server: ChildProcess | undefined;
let csFile: string;

test.describe('#196 — CS cannot reach chrome.storage.local after the SW gate', () => {
  test.beforeAll(async () => {
    if (!existsSync(extensionPath)) {
      throw new Error(`${extensionPath} missing. Run \`npm run build:e2e-ext\` first.`);
    }
    csFile = findContentScriptLoader();

    server = spawn(process.execPath, [resolve(here, 'fixtures', 'serve.mjs')], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore',
    });
    // Give the static server a beat to bind.
    await new Promise((r) => setTimeout(r, 500));

    userDataDir = mkdtempSync(resolve(tmpdir(), 'speedreader-isolation-'));
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const existing = context.serviceWorkers();
    sw = existing[0] ?? (await context.waitForEvent('serviceworker'));
  });

  test.afterAll(async () => {
    await context?.close().catch(() => undefined);
    server?.kill();
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  });

  test('CS keyed-get + get(null) enumeration BOTH fail; trusted SW read survives', async () => {
    if (!context || !sw) throw new Error('context not initialized');
    test.setTimeout(60_000);

    // 1. Seed a position record from the trusted SW context (which keeps
    //    full access after setAccessLevel). This is the record the CS must
    //    NOT be able to read or enumerate.
    const positionKey = `position:${PAGE_URL}`;
    await sw.evaluate(
      async ({ key }) => {
        await chrome.storage.local.set({
          [key]: { schemaVersion: 1, wordIndex: 7, totalWords: 100, lastReadAt: Date.now() },
        });
      },
      { key: positionKey },
    );

    // 2. The trusted SW context CAN read it back (inverse of check 5c).
    const swSees = await sw.evaluate(async ({ key }) => {
      const got = await chrome.storage.local.get(key);
      return (got[key] as { wordIndex?: number } | undefined)?.wordIndex ?? null;
    }, { key: positionKey });
    expect(swSees).toBe(7);

    // 3. Open the page and inject the CS via the production loader.
    const page = await context.newPage();
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    const tabId = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const id = tabs[0]?.id;
      if (typeof id !== 'number') throw new Error('no active tab id');
      return id;
    });
    await sw.evaluate(
      async ({ tabId, file }) => {
        await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
      },
      { tabId, file: csFile },
    );
    await page.waitForTimeout(500);

    // 4. Run the isolation probe IN THE CS ISOLATED WORLD via executeScript.
    //    After the SW's setAccessLevel('TRUSTED_CONTEXTS'), every CS local op
    //    must fail with "Access to storage is not allowed from this context."
    const [probe] = await sw.evaluate(
      async ({ tabId, key }) => {
        return chrome.scripting.executeScript({
          target: { tabId },
          func: async (positionKey: string) => {
            const result = {
              keyedFailed: false,
              enumFailed: false,
              sawAnyPosition: false,
            };
            try {
              const got = await chrome.storage.local.get(positionKey);
              // If it resolved, isolation FAILED unless empty AND no record.
              result.keyedFailed = got[positionKey] === undefined && !chrome.runtime.lastError;
              // A resolved keyed get that returned the record is the failure.
              if (got[positionKey] !== undefined) result.keyedFailed = false;
              else result.keyedFailed = true;
            } catch {
              result.keyedFailed = true;
            }
            try {
              const all = await chrome.storage.local.get(null);
              const keys = Object.keys(all);
              result.sawAnyPosition = keys.some((k) => k.startsWith('position:'));
              // Enumeration that resolves AND exposes position keys is the
              // failure; a denied enumeration throws (caught below).
              result.enumFailed = !result.sawAnyPosition && keys.length === 0;
            } catch {
              result.enumFailed = true;
            }
            return result;
          },
          args: [key],
        });
      },
      { tabId, key: positionKey },
    );

    const probeResult = probe?.result as
      | { keyedFailed: boolean; enumFailed: boolean; sawAnyPosition: boolean }
      | undefined;
    if (!probeResult) throw new Error('CS probe returned no result');

    // The CS must NOT have seen any position key …
    expect(probeResult.sawAnyPosition).toBe(false);
    // … and both the keyed read and the enumeration must have failed (access
    // denied — the door is locked).
    expect(probeResult.keyedFailed).toBe(true);
    expect(probeResult.enumFailed).toBe(true);

    await page.close();
  });
});
