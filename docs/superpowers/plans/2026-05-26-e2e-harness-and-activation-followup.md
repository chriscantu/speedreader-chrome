# Plan: E2E harness + activation follow-up bundle

**Date:** 2026-05-26
**Branch:** `feature/e2e-harness-and-activation-followup`
**Closes:** #38, #141. **Partial:** #139, #142 (profiling infra; decision PRs separate).

## Scope

Bundle Playwright E2E harness (#38) with the #141 orphan-abort security fix and profiling utilities for #139 (SW lifetime under burst) and #142 (CS listener heap at N tabs). Decision/doc PRs for #139 and #142 land in a follow-up after profiles are taken.

## Sequence

Independent tracks run parallel. Profiling tasks serialize behind harness scaffold.

### Track A — harness (#38)

1. **Scaffold Playwright** — `playwright.config.ts`, persistent context with `--load-extension=./dist`, fixture HTML article served via `webServer` block.
   Verify: `npx playwright test --list` lists specs; headed run loads extension in `chrome://extensions`.

2. **E2E coverage** — four specs against fixture page: popup opens, extraction runs, overlay renders, play/pause toggles word advance.
   Verify: `npm run test:e2e` green.

3. **CI wire** — `.github/workflows/ci.yml` adds e2e job (headless, Playwright deps cached).
   Verify: workflow run on this branch green.

### Track B — #141 orphan abort

4. **Per-tab Set tracking** — alongside `injectionLocks: Map<number, InjectionLock>` add `inFlightByTab: Map<number, Set<InjectionLock>>`. `onRemoved` iterates the set, sets `aborted=true` on every pending entry. Settle path removes entry from set.
   Verify: existing dispatch/eviction tests pass.

5. **Regression test** — `eviction.test.ts` pins three paths:
   - (a) slot-replace + onRemoved orphans entryA → A returns `inject-failed`
   - (b) followers of entryA also surface `inject-failed`
   - (c) normal URL-replacement (no onRemoved) unchanged
   Verify: tests fail on `main`, pass on branch.

### Track C — profiling utilities (depends on Track A scaffold)

6. **SW lifetime burst profiler (#139)** — e2e spec drives N dispatches at 4 s intervals, samples SW state via CDP `ServiceWorker.workerVersionUpdated` or `chrome://serviceworker-internals` scrape.
   Verify: utility outputs numeric SW-alive duration; baseline recorded in issue comment.

7. **N-tab heap profiler (#142)** — e2e spec opens N=50/100/200 fixture tabs, takes CS isolated-world heap snapshot via CDP `HeapProfiler.takeHeapSnapshot`, reports delta vs N=1.
   Verify: numeric heap delta at each N.

### Track D — close-out

8. **CHANGELOG + PR** — keep-a-changelog entry; `gh pr create` body lists closed/partial issues.
   Verify: PR URL returned, CI green.

## Agent routing

Per `CLAUDE.md` project routing:

- Track A: `extension-quality-engineer`
- Track B: `chrome-extension-engineer`
- Track C: `extension-quality-engineer` (after scaffold lands)
- Track D: controller (this session)
- Final pass: `reviewer`

## Verify gate (end-of-work)

`npm run lint && npm run format:check && npm run test && npm run build && npm run test:e2e` all green before declaring PR ready (per `rules/pr-validation.md`).

## Out of scope

- Removing 5 s `withInjectionTimeout` (issue #128 requires it).
- Removing CS-side onMessage gate (closes residual #134 race).
- Decision/doc resolution of #139 + #142 — separate PR after profiles are read.
