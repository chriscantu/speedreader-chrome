# Plan: Play/Pause control + scoped mini-modal scope-swap

**Date:** 2026-05-27
**Branch:** `feature/play-pause-and-scoped-modal`
**Closes:** #22, #131. **Covers ACs:** #10, #11, #15, #16 from `docs/superpowers/specs/2026-05-25-context-menu-integration.md`.

## Scope

Bundle phase-1 play/pause control (#22) with the deferred scoped mini-modal ACs from #131. Bundled because AC #16 (focus on play/pause within 1 rAF) and AC #11 (engine state to `paused`) both depend on a play/pause DOM control that does not yet exist. Splitting would land #22 without a consumer and #131 depending on just-merged DOM.

**In scope:**
- Play/pause button + Space-key toggle inside the shadow-DOM modal
- Scoped header `SELECTION · N words · ~M sec` for `scope: 'selection'` activations
- `← Full article` button visible only in scoped mode; click triggers in-place scope swap
- Empty-selection fallback: silent → full-page mode + visible subtitle + polite announcement
- `aria-labelledby="sr-scope-header"`, focus on play/pause within 1 rAF of mount, focus restore on unmount
- Engine `setWords(words)` API to support content-list swap without engine recreation

**Out of scope:**
- Speed slider inside overlay (#21)
- Wider keyboard shortcuts beyond Space — J/K/L, arrows (#33)
- "Loading full article…" header state for cold-cache extraction path (spec §"Expand to full" loading state) — current CS pre-tokenizes both lists at mount; lazy first-extraction lands with #17 article-extraction work
- Reverse direction (full → selection) — explicitly out per spec
- Scope-swap from sources other than `contextMenu` — spec scopes this to context-menu activations

## Sequence

Tracks A and B run in parallel; C depends on A (overlay) and B (CS) landing.

### Track A — engine + overlay core

1. **Engine `setWords()` API** → verify: `npm test -- rsvp-engine` green. New test covers `setWords` from each of `idle | playing | paused | done`. Post-call: `state === 'idle'`, no scheduled tick, no replay event, `progress().total === newWords.length`.

2. **Overlay types extension** (`src/core/overlay/types.ts`) → verify: `npm run typecheck` green. New fields: `scope: 'selection' | 'full'`, `selectionWords?: string[]`, `fullWords: string[]` (always provided), `articleTitle?: string`. `words` field removed; jsdoc on `scope`-aware mount.

3. **Play/Pause button + Space-key toggle (#22)** → verify: new test in `src/core/overlay/__tests__/play-pause.test.ts`. Asserts: button renders with text `▶ Play` when engine paused, `⏸ Pause` when playing; click toggles engine state and label; Space keydown inside modal toggles; `aria-pressed` mirrors engine state; click outside shadow does not toggle.

4. **Scoped header + `← Full article` button + `aria-labelledby` (AC #10, AC #16 ARIA part)** → verify: new test in `src/core/overlay/__tests__/scope-header.test.ts`. Asserts: scope='selection' renders `<h2 id="sr-scope-header">SELECTION · N words · ~M sec</h2>` and `← Full article` button present; scope='full' renders article-title header (or `Whole page — N words` fallback when title absent) and no swap button; modal carries `aria-labelledby="sr-scope-header"` (not `aria-label`).

5. **Scope-swap state machine (AC #11)** → verify: new test in `src/core/overlay/__tests__/scope-swap.test.ts`. After `← Full article` click: engine state === `paused`, `progress().index === 0`, `progress().total === fullWords.length`, header text updated, swap button removed from DOM, live-region text === `"Expanded to full article. Restarting from word 1 of N. Paused."`, `document.activeElement` (within shadow) === play/pause button.

6. **Empty-selection fallback (AC #15)** → verify: extension of `scope-header.test.ts`. When `scope='selection'` and `selectionWords.length === 0`: no `← Full article` button rendered, subtitle node `"No selection detected. Reading full article instead."` present in DOM and visible in forced-colors mode (style assertion), live-region text fires once on mount with same message.

7. **Mount focus management (AC #16 focus part)** → verify: extension of `play-pause.test.ts`. Pre-mount sets `document.body.appendChild(triggerBtn); triggerBtn.focus();` → mount → after 1 rAF tick: `shadow.activeElement === playPauseBtn`. Unmount → `document.activeElement === triggerBtn`.

### Track B — content script plumbing

8. **CS selection read + scope plumb** (`src/chrome/content/index.ts`) → verify: new test in `src/chrome/content/__tests__/activate-handler-scope.test.ts` (jsdom). On `activate-reader` with `scope: 'selection'`: handler reads `window.getSelection().toString()`, tokenizes both selection and `body.innerText`, passes `scope`, `selectionWords`, `fullWords`, `articleTitle = document.title` to `createOverlay`. On `scope: 'full'`: passes `selectionWords = []`, `fullWords = tokenize(body)`.

### Track C — e2e + close-out (depends on A + B)

9. **Playwright e2e: scope flow** (`tests/e2e/scope-swap.spec.ts`) → verify: `npm run test:e2e` green. Spec: load fixture article with `<p data-selectable>Lorem ipsum…</p>` (~30 words), open popup or simulate context-menu intent (existing harness), assert scoped header text matches `/SELECTION · 30 words · ~\d+ sec/`, click `← Full article`, assert article-title header rendered + Play button has focus + engine paused (peek via shadow-DOM probe).

10. **CHANGELOG + PR** → verify: `npm run lint && npm run format:check && npm run test && npm run build && npm run test:e2e` all green per `rules/pr-validation.md`. PR body lists closed issues, covered ACs, and the deferred items (loading state, J/K/L) with their tracking issues.

## Agent routing

- **Tasks 1, 2, 5**: `coder` (portable engine + overlay state machine; no `chrome.*`)
- **Tasks 3, 4, 6, 7**: `a11y-extension-designer` then `coder` (a11y designs the focus/aria contract, coder implements; co-located because ARIA + focus + reduced-motion span them all)
- **Task 8**: `chrome-extension-engineer` (CS + `chrome.*` surface)
- **Task 9**: `extension-quality-engineer` (Playwright + extension harness)
- **Task 10**: controller (this session)
- **Final pass**: `reviewer`

## Verify gate (end-of-work)

Per `rules/pr-validation.md`:

```
npm run lint
npm run format:check
npm run test
npm run build
npm run test:e2e
```

All green before `gh pr ready`. Test plan checkboxes in PR body executed (load extension headless, screenshot scoped + post-swap modals, confirm focus + announce via accessibility tree dump).

## Open shape decisions (locked)

- **`~M sec` formula:** `Math.round(words.length * 60 / settings.wpm)` seconds. Single source of truth; no minute-formatting at MVP.
- **Play/pause keyboard:** Space only. K deferred to #33.
- **Test home for scope-swap:** `src/core/overlay/__tests__/scope-swap.test.ts` (spec mentioned `src/core/reader/` — that dir does not exist; overlay owns the state machine).

## Risks + mitigations

- **`setWords()` mid-tick race:** caller must `pause()` before `setWords()` per contract. Engine `setWords()` internally clears scheduled timer to be defensive — covered in task-1 test.
- **Focus inside shadow DOM + jsdom:** focus testing through `shadow.activeElement` works in jsdom 22+. If flaky, fall back to spy on `focus()` call site.
- **forced-colors subtitle visibility:** spec §"Forced colors" demands `CanvasText`/`Canvas`; `styles.ts` already sets system colors on text — extend pattern to new subtitle element.
- **Engine `setWords` API addition** is a public-API extension to the portable `src/core/` engine; document in `RsvpEngine` interface jsdoc.
