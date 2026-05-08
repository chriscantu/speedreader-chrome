# Article Extraction Spec

**Date:** 2026-05-08
**Status:** Approved
**Issue:** [#17 — Article extraction via Readability](https://github.com/chriscantu/speedreader-chrome/issues/17)
**Milestone:** M1 (MVP parity)
**Scope:** Decide the extraction strategy, define the extractor / tokenizer contract, fixture-test plan, and selection fallback boundary.

---

## Problem Statement

The RSVP engine (`src/core/rsvp-engine/`) needs a stream of normalized words. Nothing in M1 ships meaningful UX without a working extractor — overlay (#19), selection fallback (#18), and the popup "Read this page" affordance all consume this contract. Extraction quality is named in the design doc (`2026-04-19-chrome-port-backlog-design.md`, Key Risks) as the **single biggest UX determinant** for the port.

The Safari reference (`chriscantu/speed-reader`) advertises automatic extraction in its README but does not document the algorithm. Treating Safari as the floor (per `feedback_parity_is_floor_not_ceiling.md`): if a library beats it, take the library.

## Decision

**Use [`@mozilla/readability`](https://github.com/mozilla/readability) as the sole primary extractor. No Safari-port. No hybrid in M1.**

### Options evaluated

| Option | Pros | Cons |
|---|---|---|
| **A. Mozilla Readability** | Battle-tested in Firefox Reader View; MIT; maintained; handles `<article>`, `<main>`, `[role=main]`, then text-density heuristics; understands hydrated SPA DOM. | ~50 KB minified bundle cost; opinionated on listicles; no paywall awareness. |
| **B. Safari-port** | Zero new dependency; theoretically pixel-parity with Safari output. | Safari source is undocumented from outside; reverse-engineering an undisclosed heuristic for a solo maintainer is higher cost than adopting the reference library. Likely no UX win. |
| **C. Hybrid (Readability primary, Safari heuristics secondary)** | Maximum recall on edge cases. | Two extractors to maintain; ambiguous attribution when results diverge; dependency surface grows; not justified without evidence Readability misses on the M1 fixture corpus. |

**Rationale:** Solo-maintainer scope plus "use the library everyone uses." If the fixture corpus exposes a class of pages where Readability fails systematically and a known heuristic fixes them, revisit hybrid in M2. M1 ships A.

**Bundle cost:** ~50 KB minified is accepted. The popup, options page, and service worker do not import Readability — only the content script does. The cost is paid once, lazily, when the user activates SpeedReader on a tab.

## Output Contract

Pure data — no DOM nodes cross the extraction boundary. The engine and overlay never see HTML.

```ts
// src/core/extraction/types.ts
export interface ExtractedArticle {
  /** Tokenized words ready for the RSVP engine. Punctuation stays attached
   *  (e.g. "Hello," "world.") so #15 punctuation pacing can detect it. */
  words: string[];
  /** Normalized plain text, paragraph-preserving (\n\n between paragraphs).
   *  Source of truth — `words` is `tokenize(text)`. */
  text: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  /** location.href at extraction time. */
  sourceUrl: string;
  /** Which path produced this result. */
  source: 'readability' | 'selection';
}

export type ExtractionResult =
  | { ok: true; article: ExtractedArticle }
  | { ok: false; reason: ExtractionFailure };

export type ExtractionFailure =
  | 'restricted-page'   // chrome://, chrome-extension://, view-source:, Web Store
  | 'no-content'        // Readability returned null
  | 'insufficient'      // word count below threshold (see below)
  | 'paywall-suspected' // short visible text + subscribe-density heuristic
  | 'unknown-error';
```

## Tokenization Boundary

Two-stage pipeline. Extraction yields paragraph-preserving plain text; tokenization is a separate pure function so the same tokenizer serves both Readability output and user selections.

```ts
// src/core/tokenize/index.ts
export function tokenize(text: string): string[];
```

**Rules:**

- Split on Unicode whitespace (`\p{White_Space}` regex with `u` flag).
- Punctuation stays attached to the adjacent word — RSVP punctuation pacing (#15) inspects trailing chars to add micro-dwell on `.`, `,`, `;`, `:`, `!`, `?`, `—`, `…`.
- Hyphenated words (`well-being`, `state-of-the-art`) are one token.
- Em/en dashes between words (`life — death`) split into surrounding tokens; the dash itself is dropped.
- Contractions (`don't`, `it's`) are one token.
- Ellipses (`...`, `…`) attach to the preceding word.
- Strip zero-width characters (`U+200B`, `U+200C`, `U+200D`, `U+FEFF`).
- Collapse runs of whitespace to a single space; `\n\n` between paragraphs preserved as a sentinel for #15 paragraph pacing.

The tokenizer is pure, in `src/core/tokenize/`, fully unit-testable.

## Code Layout

| Path | Role | Boundary |
|---|---|---|
| `src/core/tokenize/` | `tokenize(text): string[]` — pure. | `src/core/` (no platform APIs). |
| `src/core/extraction/types.ts` | `ExtractedArticle`, `ExtractionResult`. | `src/core/` (types only). |
| `src/chrome/extraction/extract.ts` | Wraps `@mozilla/readability`, runs in content script, owns lifecycle (DOMContentLoaded gate, retry policy, restricted-page guard). | `src/chrome/`. |
| `src/chrome/extraction/selection.ts` | Reads `window.getSelection()`, runs through `tokenize`. | `src/chrome/`. |

**Boundary trade-off:** `src/core/README.md` previously slotted "Article extraction" under core. We're keeping the *types and tokenizer* in core (portable to Safari) but pushing the *Readability invocation and lifecycle* into `src/chrome/extraction/`. Lifecycle is platform-coupled (content-script timing, restricted-URL list, `chrome.runtime.id` for messaging). When the Safari port lands, it will mirror the wrapper under `src/safari/extraction/` and reuse the core types + tokenizer untouched. The `src/core/README.md` "planned contents" list will be amended to reflect this in the implementation PR.

## Insufficient Content & Selection Fallback

**Threshold:** extraction is "insufficient" when `words.length < 30`. Rationale: at the default 300 WPM, 30 words is ~6 seconds of reading — anything shorter is almost certainly nav chrome, a paywall stub, or an extraction miss, not an article worth RSVP'ing.

**Trigger sequence:**

1. Content script runs `extract()` after `DOMContentLoaded`.
2. If `ok: false` with reason `no-content` or `insufficient`, retry once after `requestIdleCallback` (fallback: `setTimeout(500)`) — covers SPAs that hydrate post-paint.
3. If retry still fails, surface failure to the popup. Popup shows: *"Couldn't find an article on this page. Select some text and click 'Read selection' to start anyway."*
4. Popup exposes a **"Read selection"** button, enabled when the active tab reports a non-empty selection (the content script reports selection state on popup-open via `runtime.sendMessage`).
5. M2-tracked: context-menu entry (`chrome.contextMenus`) "Read selection with SpeedReader." Out of scope for M1.

## Failure Modes

| Mode | Detection | Behavior |
|---|---|---|
| **Restricted page** (`chrome://*`, `chrome-extension://*`, `https://chrome.google.com/webstore/*`, `view-source:*`, `about:*`) | URL match in service worker before content-script injection. | Popup shows "SpeedReader can't run on this page." No extraction attempt. |
| **SPA late hydration** | First extraction returns `insufficient`. | One retry via `requestIdleCallback` / 500 ms; no third attempt — avoids spin on infinite-scroll feeds. |
| **Paywall-suspected** | Visible article body < 200 words AND DOM contains ≥ 2 of: `subscribe`, `paywall`, `metered`, `register to read` (case-insensitive token match in body text). | Return `paywall-suspected`; popup shows "This page may be paywalled — try selecting the visible text." Do NOT attempt bypass. |
| **iframes** | Extractor runs in top frame only. | Out of scope for M1. Documented; tracked under #56 (`future`). |
| **Unknown error** | Readability throws. | Catch, log to `console.warn` with structured `{ url, error }`, return `unknown-error`. No telemetry — local-only constraint. |

## Test Strategy

### Unit (Vitest)

- **Tokenizer** — `src/core/tokenize/__tests__/`. Edge cases: ASCII baseline, contractions, hyphenated compounds, em/en dashes, ellipses, mixed punctuation, Unicode whitespace, zero-width chars, RTL text passthrough (no special handling, just don't crash), CJK (no spaces — produces one mega-token; documented limitation, see Out-of-Scope).
- **Failure-mode classifier** — restricted-URL matcher, paywall heuristic.

### Integration (Vitest + JSDOM)

- **Fixture corpus** — `tests/fixtures/extraction/`. Each fixture is a saved HTML file + a sibling `.expected.json`:

  ```json
  {
    "minWords": 400,
    "maxWords": 1200,
    "firstWords": ["The", "quick", "brown", "fox", "jumped"],
    "lastWords": ["and", "they", "lived", "happily", "ever"],
    "title": "Example Post"
  }
  ```

- **Target corpus (10–12 fixtures):**
  1. Plain blog post (Markdown-rendered)
  2. NYT-style news article
  3. Substack post
  4. Wikipedia article
  5. GitHub issue thread (challenges Readability; confirms behavior)
  6. Listicle (numbered headers + short paragraphs)
  7. Single-paragraph microblog
  8. SPA-rendered post saved post-hydration
  9. Short paywall stub (asserts `paywall-suspected`)
  10. Code-heavy technical post (asserts code blocks survive as text)
  11. (Optional) MDN docs page
  12. (Optional) Non-English (Spanish or German) article — sanity check, no language-specific logic

### E2E

Deferred to Playwright (#38). Smoke: load unpacked, navigate to a fixture URL, click the popup action, assert the overlay opens with the expected first word.

## Acceptance Criteria

- [ ] `@mozilla/readability` added to `dependencies`; bundle delta documented in PR (~50 KB minified expected).
- [ ] `src/core/tokenize/` exports `tokenize(text)` and passes ≥ 20 unit-test cases covering the rules above.
- [ ] `src/core/extraction/types.ts` exports `ExtractedArticle`, `ExtractionResult`, `ExtractionFailure` with the shapes above.
- [ ] `src/chrome/extraction/extract.ts` returns `ExtractionResult` and:
  - Guards restricted URLs.
  - Retries once on `insufficient` after `requestIdleCallback` / 500 ms.
  - Returns `paywall-suspected` when the heuristic fires.
- [ ] Fixture suite green on ≥ 10 fixtures with documented `minWords`/`maxWords`/`firstWords`/`lastWords`.
- [ ] Selection fallback wired: popup "Read selection" button activates when content script reports a non-empty selection.
- [ ] `tsc --noEmit` clean; `npm test` green; lint clean.

## Out of Scope

- Saved articles (#52, future)
- PDF / ePub extraction (#53, future)
- iframe extraction (#56, future)
- Reading-position memory (#48, M2)
- Translation, language detection, RTL-aware tokenization, CJK word segmentation (post-M1)
- Paywall bypass (never — ethical and legal floor)
- Context-menu entry for selection (M2)
