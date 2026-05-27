/**
 * Shared persistent-context setup for extension-loading specs.
 *
 * Each spec calls `launchExtensionContext()` in `beforeAll` and
 * `closeExtensionContext()` in `afterAll`. The pattern follows the
 * working reference in `experiments/activeTab-commands-check/tests/`.
 *
 * IMPORTANT: the extension under test is the BUILT output at
 * `dist/` — run `npm run build` before `npm run test:e2e`.
 */
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
export const extensionPath = resolve(here, '..', '..', '..', 'dist');

export type ExtensionHandle = {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
  userDataDir: string;
};

export async function launchExtensionContext(): Promise<ExtensionHandle> {
  if (!existsSync(extensionPath)) {
    throw new Error(
      `Extension build not found at ${extensionPath}. Run \`npm run build\` first.`,
    );
  }
  const userDataDir = mkdtempSync(resolve(tmpdir(), 'speedreader-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  // The MV3 service worker may already be registered, or may register lazily.
  const existing = context.serviceWorkers();
  const serviceWorker = existing[0] ?? (await context.waitForEvent('serviceworker'));

  // Derive the extension id from the service-worker URL: chrome-extension://<id>/...
  const swUrl = serviceWorker.url();
  const match = /^chrome-extension:\/\/([a-p]+)\//.exec(swUrl);
  if (!match) {
    throw new Error(`Could not parse extension id from SW url: ${swUrl}`);
  }
  const extensionId = match[1];

  return { context, serviceWorker, extensionId, userDataDir };
}

/**
 * Locate the built content-script chunk inside `dist/assets/` by
 * content-grepping for the CS-side console marker. The chunk name is
 * hash-suffixed and changes per build, so a content probe is stabler
 * than a filename glob. Used by specs that need to call
 * `chrome.scripting.executeScript({ files: [...] })` from the SW —
 * dynamic `import()` is forbidden in SW scope, so we cannot reach the
 * `CONTENT_SCRIPT_FILE` re-export at runtime.
 */
export function findContentScriptFile(): string {
  const assetsDir = join(extensionPath, 'assets');
  const marker = '[SpeedReader] Content script loaded';
  const files = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const body = readFileSync(join(assetsDir, f), 'utf8');
    if (body.includes(marker)) return `assets/${f}`;
  }
  throw new Error(
    `Could not locate content-script chunk in ${assetsDir} (looked for marker "${marker}"). ` +
      `Did the CS console marker change? Update findContentScriptFile() or the marker in src/chrome/content/index.ts.`,
  );
}

export async function closeExtensionContext(handle: ExtensionHandle | undefined): Promise<void> {
  if (!handle) return;
  await handle.context.close().catch(() => undefined);
  if (handle.userDataDir) {
    rmSync(handle.userDataDir, { recursive: true, force: true });
  }
}
