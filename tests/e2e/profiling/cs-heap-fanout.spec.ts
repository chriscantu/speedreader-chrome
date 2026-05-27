/**
 * cs-heap-fanout.spec.ts — profiling utility for issue #142.
 *
 * Measures the resident heap cost of the per-tab `chrome.runtime.onMessage`
 * listener registered by `src/chrome/content/index.ts` (added in PR #140 as
 * the CS-side `isRestricted` gate that closes the residual #134 TOCTOU
 * window). Each top-level document hosting the content script holds:
 *   - one listener closure
 *   - one copy of the `handleActivateReader` import graph
 *     (`activate-handler.ts` → `core/restricted.ts`)
 *
 * Open N copies of the fixture article in the same persistent context,
 * snapshot the renderer heap of one tab in each cohort via CDP, and
 * report the per-tab delta vs N=1.
 *
 * NOT a unit assertion — this spec is a measurement tool. It is hidden
 * from `npm run test:e2e` via `RUN_PROFILES=1` gating and exposed as
 * `npm run test:profile`.
 *
 * CDP approach taken: full-renderer `HeapProfiler.takeHeapSnapshot`
 * against the target tab via `context.newCDPSession(page)`. The snapshot
 * covers ALL JS contexts in that renderer (main world + all isolated
 * worlds, including the extension content-script world). Per-tab cost
 * of the CS listener is therefore reflected in the total snapshot size;
 * isolating the CS world specifically would require enumerating
 * `Runtime.executionContextCreated` events and filtering on
 * `auxData.frameId` + extension origin, which is brittle and unnecessary
 * for the cliff question issue #142 asks (does total heap scale linearly
 * with N? at what N does it become user-visible?). The snapshot byte
 * length is the primary signal; `performance.memory.usedJSHeapSize` from
 * the main world is recorded as a cross-check.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launchExtensionContext,
  closeExtensionContext,
  type ExtensionHandle,
} from '../fixtures/extension';

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS_FILE = resolve(here, 'results', 'cs-heap-fanout.json');
const COHORTS = [1, 50, 100, 200] as const;
const FIXTURE_URL = 'http://127.0.0.1:5173/article.html';

type CohortResult = {
  n: number;
  snapshotBytes: number;
  snapshotChunks: number;
  usedJSHeapBytes: number | null;
  perTabSnapshotBytes: number;
  perTabUsedJSHeapBytes: number | null;
  deltaVsBaselineBytes: number;
  durationMs: number;
};

test.describe.serial('CS onMessage listener heap fan-out (#142)', () => {
  test.skip(!process.env.RUN_PROFILES, 'Profiling spec — set RUN_PROFILES=1 to run');
  test.slow();

  let handle: ExtensionHandle | undefined;
  const results: CohortResult[] = [];

  test.beforeAll(async () => {
    handle = await launchExtensionContext();
  });

  test.afterAll(async () => {
    // Emit results before tearing down so a partial run still produces output.
    if (results.length > 0) {
      mkdirSync(dirname(RESULTS_FILE), { recursive: true });
      const baseline = results.find((r) => r.n === 1);
      writeFileSync(
        RESULTS_FILE,
        JSON.stringify(
          {
            issue: 142,
            spec: 'tests/e2e/profiling/cs-heap-fanout.spec.ts',
            generatedAt: new Date().toISOString(),
            fixtureUrl: FIXTURE_URL,
            cdpApproach:
              'HeapProfiler.takeHeapSnapshot via context.newCDPSession(page); whole-renderer (main + isolated worlds).',
            baselineN: baseline?.n ?? null,
            baselineSnapshotBytes: baseline?.snapshotBytes ?? null,
            cohorts: results,
          },
          null,
          2,
        ),
      );
      console.log(renderMarkdownTable(results, baseline));
    }
    await closeExtensionContext(handle);
    handle = undefined;
  });

  for (const n of COHORTS) {
    test(`cohort N=${n}`, async () => {
      if (!handle) throw new Error('extension context not initialized');
      const started = Date.now();

      const pages: Page[] = [];
      for (let i = 0; i < n; i++) {
        const page = await handle.context.newPage();
        await page.goto(FIXTURE_URL, { waitUntil: 'load' });
        pages.push(page);
      }
      // Settle: ensure all tabs reached networkidle so the CS module has
      // executed and registered its listener on each.
      await Promise.all(pages.map((p) => p.waitForLoadState('networkidle').catch(() => undefined)));
      expect(pages).toHaveLength(n);

      // Target the LAST tab opened for snapshotting — same CS code path,
      // arbitrary choice; the question is per-tab cost, and they're peers.
      const target = pages[pages.length - 1];
      const client = await handle.context.newCDPSession(target);
      await client.send('HeapProfiler.enable');
      const chunks: string[] = [];
      client.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
      await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      await client.send('HeapProfiler.disable');
      await client.detach();
      // Soft assertion #1 — snapshot taken.
      expect(chunks.length).toBeGreaterThan(0);
      const snapshotBytes = chunks.reduce((sum, c) => sum + c.length, 0);

      // Cross-check via main-world performance.memory (Chromium-only;
      // best-effort, may be null in some configurations).
      const usedJSHeapBytes = await target
        .evaluate(() => {
          const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
          return typeof mem?.usedJSHeapSize === 'number' ? mem.usedJSHeapSize : null;
        })
        .catch(() => null);

      const baseline = results.find((r) => r.n === 1);
      const deltaVsBaselineBytes = baseline ? snapshotBytes - baseline.snapshotBytes : 0;

      results.push({
        n,
        snapshotBytes,
        snapshotChunks: chunks.length,
        usedJSHeapBytes,
        perTabSnapshotBytes: Math.round(snapshotBytes / n),
        perTabUsedJSHeapBytes:
          typeof usedJSHeapBytes === 'number' ? Math.round(usedJSHeapBytes / n) : null,
        deltaVsBaselineBytes,
        durationMs: Date.now() - started,
      });

      // Tear down pages so cohorts don't accumulate.
      for (const p of pages) {
        await p.close().catch(() => undefined);
      }
    });
  }
});

function renderMarkdownTable(rows: CohortResult[], baseline: CohortResult | undefined): string {
  const lines = [
    '',
    '### CS onMessage listener heap fan-out (#142)',
    '',
    '| N    | Snapshot bytes | Per-tab bytes | usedJSHeapSize | Δ vs N=1     | Duration ms |',
    '| ---- | --------------:| -------------:| --------------:| ------------:| -----------:|',
  ];
  for (const r of rows) {
    const used = r.usedJSHeapBytes ?? '—';
    const delta = baseline ? r.deltaVsBaselineBytes.toLocaleString() : '—';
    lines.push(
      `| ${String(r.n).padEnd(4)} | ${r.snapshotBytes.toLocaleString().padStart(14)} | ${r.perTabSnapshotBytes.toLocaleString().padStart(13)} | ${String(used).padStart(14)} | ${delta.padStart(12)} | ${String(r.durationMs).padStart(11)} |`,
    );
  }
  return lines.join('\n');
}
