/**
 * cs-heap-fanout.spec.ts — profiling utility for issue #142.
 *
 * WHAT CHANGED (correction of the original N-tab harness)
 * ------------------------------------------------------
 * The first version of this spec opened N copies of the fixture in one
 * persistent context and snapshotted ONE tab's renderer, then divided the
 * snapshot bytes by N. That measured nothing useful:
 *   - Each tab is a separate renderer process (site isolation), so a
 *     single-tab snapshot is constant regardless of N — the recorded
 *     `snapshotBytes` was ~6.00 MB flat across N=1/50/100/200 (Δ ±50 B,
 *     i.e. noise), and `perTabSnapshotBytes = snapshotBytes / N` was just
 *     `6.00 MB / N`, an arithmetic artifact, not a measurement.
 *   - More fundamentally, issue #142's premise — "the listener registers
 *     at CS module load on every page that matches the content_scripts
 *     pattern" — does NOT hold for this extension. There is NO
 *     `content_scripts` entry (see `src/chrome/manifest.ts`): the content
 *     script is injected lazily via `chrome.scripting.executeScript` ONLY
 *     into a tab the user actively opens the reader on. Open background
 *     tabs the user never activated carry ZERO CS cost.
 *
 * WHAT THIS MEASURES NOW
 * ----------------------
 * The honest question is the per-ACTIVATED-tab marginal heap cost: when
 * the user activates the reader on a tab, the SW injects the CS, which
 * registers the `onMessage` listener and instantiates its static import
 * graph (`activate-handler` → `core/restricted`, plus the overlay /
 * rsvp-engine / storage modules pulled in at the top of `content/index.ts`).
 * That resident cost persists for the tab's document lifetime even with the
 * overlay closed.
 *
 * Method (clean same-renderer delta — no cross-process confound):
 *   1. Open the local fixture article in one tab; snapshot its renderer
 *      heap BEFORE injection (page only — proves a non-activated tab has
 *      no CS world).
 *   2. Drive the real production path: SW `chrome.scripting.executeScript`
 *      injects the CS loader; poll until the `onMessage` listener answers.
 *   3. Snapshot the SAME renderer AFTER injection (page + CS isolated
 *      world, listener resident, overlay NOT mounted).
 *   4. Delta = the marginal per-activated-tab CS cost. Browser-wide cost =
 *      delta × (number of tabs the user activated the reader on), which is
 *      realistically a small handful — NOT the open-tab count.
 *
 * Uses the `dist-e2e-ext/` build (adds `host_permissions: ['<all_urls>']`)
 * so `executeScript` succeeds without a user gesture — identical pattern to
 * `overlay-activation-chain.spec.ts`. Run on demand:
 *   npm run build:e2e-ext
 *   RUN_PROFILES=1 npx playwright test tests/e2e/profiling
 *
 * NOT a unit assertion — measurement tool, gated behind RUN_PROFILES=1.
 */
import { test, expect, chromium, type BrowserContext, type Worker, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = resolve(here, 'results', 'cs-heap-fanout.json');
const extensionPath = resolve(here, '..', '..', '..', 'dist-e2e-ext');
const FIXTURE_URL = 'http://127.0.0.1:5173/article.html';
// Projection cohorts — these are ACTIVATED tabs, not open tabs.
const PROJECTION_N = [1, 5, 50, 100, 200] as const;

function findContentScriptLoader(): string {
  // crxjs emits a loader chunk (index.ts-loader-*.js) that dynamically
  // imports the real CS module; executeScript({ files: [loader] }) wraps
  // the ESM import correctly. Same lookup as overlay-activation-chain.spec.
  const assetsDir = join(extensionPath, 'assets');
  const files = readdirSync(assetsDir).filter((f) => /^index\.ts-loader-.*\.js$/.test(f));
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one CS loader in ${assetsDir}, found ${files.length}: ${files.join(', ')}`,
    );
  }
  return `assets/${files[0]}`;
}

async function snapshotRendererBytes(context: BrowserContext, page: Page): Promise<number> {
  const client = await context.newCDPSession(page);
  await client.send('HeapProfiler.enable');
  // Force GC first so the delta reflects retained (not transient) heap.
  await client.send('HeapProfiler.collectGarbage').catch(() => undefined);
  const chunks: string[] = [];
  client.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
  await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  await client.send('HeapProfiler.disable');
  await client.detach();
  return chunks.reduce((sum, c) => sum + c.length, 0);
}

async function usedJSHeap(page: Page): Promise<number | null> {
  return page
    .evaluate(() => {
      const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
      return typeof mem?.usedJSHeapSize === 'number' ? mem.usedJSHeapSize : null;
    })
    .catch(() => null);
}

test.describe.serial('CS onMessage listener per-activated-tab cost (#142)', () => {
  test.skip(!process.env.RUN_PROFILES, 'Profiling spec — set RUN_PROFILES=1 to run');
  test.slow();

  let context: BrowserContext | undefined;
  let sw: Worker | undefined;
  let userDataDir: string | undefined;
  let csFile: string;

  test.beforeAll(async () => {
    if (!existsSync(extensionPath)) {
      throw new Error(`${extensionPath} missing. Run \`npm run build:e2e-ext\` first.`);
    }
    csFile = findContentScriptLoader();
    userDataDir = mkdtempSync(resolve(tmpdir(), 'speedreader-profile-'));
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

  test('measure marginal CS cost in an activated tab', async () => {
    if (!context || !sw) throw new Error('context not initialized');
    const started = Date.now();

    const page = await context.newPage();
    await page.goto(FIXTURE_URL, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // BEFORE: page-only renderer (no CS injected — proves a non-activated
    // tab carries no CS world). A sendMessage now must find no listener.
    // NOTE: the usedJSHeap read MUST immediately follow the snapshot call —
    // `snapshotRendererBytes` forces `HeapProfiler.collectGarbage`, so the
    // delta reflects retained (not transient) heap. Do not reorder.
    const beforeBytes = await snapshotRendererBytes(context, page);
    const beforeUsedJSHeap = await usedJSHeap(page);
    const tabId = await sw.evaluate(async (origin) => {
      // Match OUR fixture tab by URL — the persistent context opens with an
      // initial about:blank tab, so {active:true} can resolve to a tab
      // executeScript cannot touch ("Cannot access contents of the page").
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((tab) => typeof tab.url === 'string' && tab.url.startsWith(origin));
      if (typeof t?.id !== 'number') {
        throw new Error(`fixture tab not found among: ${JSON.stringify(tabs.map((x) => x.url))}`);
      }
      return t.id;
    }, 'http://127.0.0.1:5173/');
    const listenerBeforeInjection = await sw.evaluate(async (tabId) => {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'noop-probe' });
        return true; // a listener answered — unexpected pre-injection
      } catch {
        return false; // no receiving end — confirms no CS resident
      }
    }, tabId);
    // Empirical premise check: a tab the user has not activated has no CS.
    expect(listenerBeforeInjection).toBe(false);

    // Inject the CS the way production does (SW executeScript).
    await sw.evaluate(
      async ({ tabId, file }) => {
        await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
      },
      { tabId, file: csFile },
    );
    // Wait for the listener to come up (loader dynamic-imports the module).
    await test.step('poll until CS listener answers', async () => {
      if (!sw) throw new Error('sw not initialized');
      const deadline = Date.now() + 5000;
      let up = false;
      while (Date.now() < deadline) {
        up = await sw.evaluate(async (tabId) => {
          try {
            // A non-activate message hits the listener's sender check and
            // early-return; the call resolving (no "receiving end" error)
            // proves the listener is registered. We do NOT send
            // 'activate-reader' — overlay must stay UNMOUNTED so we measure
            // resident listener + import-graph cost, not overlay cost.
            await chrome.tabs.sendMessage(tabId, { type: 'noop-probe' });
            return true;
          } catch {
            return false;
          }
        }, tabId);
        if (up) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(up).toBe(true);
    });

    // Let the isolated world settle (module instantiation finished).
    await page.waitForTimeout(500);

    // AFTER: page + resident CS isolated world (overlay NOT mounted).
    const afterBytes = await snapshotRendererBytes(context, page);
    const afterUsedJSHeap = await usedJSHeap(page);

    const marginalSnapshotBytes = afterBytes - beforeBytes;
    // Sanity: the CS world adds real bytes; if this is <= 0 the snapshot
    // didn't capture the isolated world (method regression).
    expect(marginalSnapshotBytes).toBeGreaterThan(0);

    // Headline metric: per-isolate real heap (the CS isolated world shares
    // the page's V8 isolate, so the main-world usedJSHeapSize delta reflects
    // the CS's actual retained heap). Snapshot-byte delta is serialized
    // snapshot size (~5x inflated) — recorded as a secondary cross-check.
    const marginalUsedJSHeap =
      typeof beforeUsedJSHeap === 'number' && typeof afterUsedJSHeap === 'number'
        ? afterUsedJSHeap - beforeUsedJSHeap
        : null;

    // Project the real-heap figure over ACTIVATED tabs (not open tabs).
    const projectionBasis = marginalUsedJSHeap ?? marginalSnapshotBytes;
    const projection = PROJECTION_N.map((n) => ({
      activatedTabs: n,
      projectedHeapBytes: projectionBasis * n,
    }));

    mkdirSync(dirname(RESULTS_FILE), { recursive: true });
    const payload = {
      issue: 142,
      spec: 'tests/e2e/profiling/cs-heap-fanout.spec.ts',
      generatedAt: new Date().toISOString(),
      fixtureUrl: FIXTURE_URL,
      injectionModel:
        'Lazy: no content_scripts entry; CS injected via chrome.scripting.executeScript only into tabs the user activates. Open/background tabs carry ZERO CS cost.',
      method:
        'Same-renderer HeapProfiler.takeHeapSnapshot before vs after SW executeScript injection (overlay unmounted). Delta = marginal per-activated-tab CS cost.',
      nonActivatedTabHasListener: listenerBeforeInjection,
      marginalUsedJSHeapBytesPerActivatedTab: marginalUsedJSHeap,
      beforeUsedJSHeap,
      afterUsedJSHeap,
      marginalSnapshotBytesPerActivatedTab: marginalSnapshotBytes,
      beforeSnapshotBytes: beforeBytes,
      afterSnapshotBytes: afterBytes,
      snapshotByteNote:
        'Serialized HeapProfiler snapshot size (~5x retained heap); cross-check only. Use usedJSHeap for memory.',
      projectionOverActivatedTabs: projection,
      durationMs: Date.now() - started,
    };
    writeFileSync(RESULTS_FILE, JSON.stringify(payload, null, 2));
    console.log(renderMarkdownTable(payload));
  });
});

function renderMarkdownTable(p: {
  marginalUsedJSHeapBytesPerActivatedTab: number | null;
  marginalSnapshotBytesPerActivatedTab: number;
  projectionOverActivatedTabs: { activatedTabs: number; projectedHeapBytes: number }[];
}): string {
  const lines = [
    '',
    '### CS per-activated-tab marginal cost (#142)',
    '',
    `Marginal usedJSHeapSize / activated tab (real heap): ${
      p.marginalUsedJSHeapBytesPerActivatedTab === null
        ? '—'
        : p.marginalUsedJSHeapBytesPerActivatedTab.toLocaleString()
    }`,
    `Marginal snapshot bytes / activated tab (serialized, ~5x): ${p.marginalSnapshotBytesPerActivatedTab.toLocaleString()}`,
    '',
    '| Activated tabs | Projected heap bytes |',
    '| -------------: | -------------------: |',
  ];
  for (const r of p.projectionOverActivatedTabs) {
    lines.push(
      `| ${String(r.activatedTabs).padStart(14)} | ${r.projectedHeapBytes.toLocaleString().padStart(20)} |`,
    );
  }
  return lines.join('\n');
}
