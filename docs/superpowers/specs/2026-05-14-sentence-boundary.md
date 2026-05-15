# Sentence-Boundary Detection Spec

**Date:** 2026-05-14
**Status:** Proposed
**Issue:** [#90 — Add sentence-boundary detection (Safari parity, sentenceStart flag)](https://github.com/chriscantu/speedreader-chrome/issues/90)
**Milestone:** M1 (MVP parity)
**Scope:** Define a portable helper that overlays a `sentenceStart` flag on the token stream emitted by `src/core/tokenize`, the detection algorithm it uses (Safari parity, including documented quirks), the consumer surface (which features call it and what they get), and the test contract (8 Safari cases plus edge cases this spec pins).

---

## Problem Statement

Three M1 features need to know where sentences begin or end inside the RSVP word stream:

- **#15 Punctuation pacing** — the engine slows the cadence after sentence-ending punctuation (1.5× base delay per Safari `calculateDelay`). "Sentence ends" must be detectable in a way that survives bracket / paren / quote suffixes.
- **#23 Previous / next sentence** — overlay controls let the user skip backward or forward by sentence. The engine needs to know which token indexes are sentence starts so a "next sentence" call can advance to the right index.
- **#20 Context preview on pause** — when paused, the overlay shows the full sentence around the current word. Sentence boundaries delimit the slice.

Plus two future-tracked features (#51 Chunks, #97 contextSentence API) inherit the same dependency.

Today, `src/core/tokenize` returns `string[]` — words and structural sentinels (`\n\n`, `—`, `–`). There is no per-token signal indicating which words start a new sentence. Per gap analysis in #84, this is the highest-leverage missing primitive in the core engine: five downstream features wait on it.

The Safari reference encodes the same primitive as a `sentenceStart: boolean` flag on every word object emitted by `processText` (`chriscantu/speed-reader/Resources/rsvp/word-processor.js`). The 8 Safari test cases in `tests/js/word-processor.test.js` pin the detection's behavior — including a deliberately documented quirk (`Dr.[Smith]` is treated as a sentence boundary by Safari, and Chrome inherits the quirk for parity).

## Constraints

- **`src/core/` boundary.** Helper lives under `src/core/`; no `chrome.*` / `browser.*` / DOM imports. Keeps the core portable for the future shared-core extraction.
- **Pure function.** Detection has no side effects, no state, no dependency on time, locale, or any setting. Same input → same output, forever. Memoizable if a consumer cares.
- **Additive to `tokenize`, not breaking.** `tokenize()` returns `string[]` today and is consumed in 4 modules. Changing its return type cascades into all 4. The new behavior MUST be layered, not in-place.
- **Operates on token stream, not raw text.** Two passes (raw → tokens → marked tokens) keeps each pass single-purpose and testable in isolation.
- **Safari parity is the floor, not the ceiling** (`CLAUDE.md`). Documented Safari quirks (the `Dr.[Smith]` case) are inherited; Chrome may extend later but must not regress.

## Decision

### API shape — layered helper, not tokenize extension

A new exported function lives in `src/core/tokenize/` (alongside `tokenize.ts`) — the conceptual unit is "text-to-tokens-with-metadata," so co-locating with `tokenize` reads correctly to a contributor; the apply-layer split between `core` and `chrome` is unaffected.

```ts
// src/core/tokenize/sentence-boundary.ts

export type MarkedToken =
  | { kind: 'word'; text: string; sentenceStart: boolean }
  | { kind: 'paragraph'; text: '\n\n' }
  | { kind: 'dash'; text: '—' | '–' };

export function markSentenceBoundaries(tokens: string[]): MarkedToken[];
```

Re-exported from `src/core/tokenize/index.ts` alongside `tokenize`.

### Why a discriminated union and not `Array<string | {text, sentenceStart}>`

Consumers (rsvp-engine for pacing, overlay for context preview, future chunk builder) all need to differentiate words from structural tokens. A discriminated union with `kind` makes that switch ergonomic in TypeScript without `typeof === 'string'` checks and gives `sentenceStart` a single typed home (only on `kind: 'word'`). Sentinels do not carry `sentenceStart` because the next word does.

### Detection algorithm

Walk the input array left-to-right, carrying one piece of state: `nextWordStartsSentence: boolean`.

1. **Initialize** `nextWordStartsSentence = true`. The first word in any non-empty stream always starts a sentence.
2. **For each token:**
   - If the token is `'\n\n'` → emit `{kind: 'paragraph', text: '\n\n'}`; set `nextWordStartsSentence = true`. Paragraph breaks implicitly end a sentence regardless of the previous word's punctuation.
   - If the token is `'—'` or `'–'` → emit `{kind: 'dash', text}`; **do not change** `nextWordStartsSentence`. Dashes are intra-sentence pause markers.
   - Otherwise (word) → emit `{kind: 'word', text, sentenceStart: nextWordStartsSentence}`. Then compute whether this word ends a sentence (rule below); set `nextWordStartsSentence` to that result.

### "Word ends a sentence" — the regex

A word ends a sentence iff it matches:

```ts
const SENTENCE_END_RE = /[.!?](?:\[[^\]]*\]|\([^)]*\)|["'”’)\]])*$/u;
```

Breakdown:

- `[.!?]` — a sentence-terminating punctuation mark
- `(?: ... )*` — followed by zero or more trailing artifacts:
  - `\[[^\]]*\]` — a complete `[...]` group (footnote refs, e.g., `[10]`, `[Smith]`)
  - `\([^)]*\)` — a complete `(...)` group (closing parens after a parenthetical)
  - `["'”’)\]]` — a single closing quote or bracket / paren / square-bracket
- `$` — the word must end here

This matches Safari's behavior on all 8 sentence-boundary test cases (see §Test Cases below), including the documented `Dr.[Smith]` quirk.

### Why this regex catches `Dr.[Smith]`

`Dr.[Smith]` contains a `.` followed by `[Smith]` (a complete `[...]` group). The regex's `(?:\[[^\]]*\])*` arm consumes `[Smith]` as one bracket group; `$` then asserts end-of-string. The `.` qualifies as a sentence terminator, so the regex matches.

This is a known Safari quirk: an abbreviation like `Dr.` immediately followed by a bracketed annotation is mis-detected as a sentence boundary. We inherit it for parity. The cost is rare (`Dr.[Smith]`-style constructions are unusual in long-form reading material); the alternative — diverging from Safari to fix the quirk — adds complexity to the algorithm and would make porting the 8 Safari tests harder.

A future ADR may revisit if user-visible defects accumulate.

### What the regex does NOT match (negative cases)

- `see [10] for details` — `[10]` contains no `.!?`. Words `see`, `for`, `details` are not sentence-enders.
- `e.g.,` — the mid-word `.` is followed by `,`. Comma is not in the closing-char set; not a sentence boundary. Pacing-wise this gets the 1.2× comma multiplier from #15, not the 1.5× sentence-end multiplier.
- `U.S.:` — ends with `:`. Not in the closing set; not a sentence end.

### Paragraph-sentinel interaction

`'\n\n'` always sets the next word to `sentenceStart: true`, even if the preceding word did not end in sentence punctuation (e.g., a paragraph that ends mid-thought with a hyphen or a comma). Two reasons:

1. **Reader intent.** Paragraph breaks are an author signal that a thought has concluded. The overlay's context preview and the engine's pacing should both treat them as boundaries.
2. **Symmetry.** The opposite policy ("only `.!?` ends a sentence") would mean a deliberate paragraph break has no semantic weight in the token stream, which contradicts what writers signal by inserting it.

### Em-dash and en-dash interaction

`—` and `–` are intra-sentence pause markers in tokenize's current output (see existing tokenize tests: em-dash between clauses). They do NOT end a sentence; the word before a dash may or may not end a sentence by its own punctuation. Dashes leave `nextWordStartsSentence` unchanged.

### First-token handling

The first word in a non-empty stream is `sentenceStart: true` by the initialization rule. Empty input produces empty output. Whitespace-only input is already empty after `tokenize`.

### Output guarantees

For any input `tokens: string[]`:
- `markSentenceBoundaries(tokens).length === tokens.length`
- Order-preserved: the i-th input token corresponds to the i-th output token.
- `sentenceStart` is only present on `kind: 'word'` entries; the type system enforces this.

## Consumer surface

| Consumer | When it calls `markSentenceBoundaries` | What it reads |
|---|---|---|
| **#15 Punctuation pacing** (rsvp-engine) | At engine construction, once, after tokenize. The marked array is iterated alongside word emission. | `sentenceStart` on the NEXT token to derive "current word ends a sentence" (= `tokens[i+1].sentenceStart`). Used to pick the 1.5× delay multiplier. |
| **#23 Previous / next sentence** (controls) | At engine construction, once. The result is held as a sidecar index. | `sentenceStart === true` positions form the index of seekable boundaries. `nextSentence` advances to the next `true`; `prevSentence` walks back. |
| **#20 Context preview on pause** (overlay) | When the user pauses, called on the slice around `currentIndex`. | Uses both `sentenceStart === true` boundaries and paragraph sentinels to delimit the displayed sentence. |
| **#97 contextSentence API** (rsvp-engine) | Builds on #20's slicing logic; exposed as an engine method. | Same as #20. |
| **#51 Chunks** (future) | Chunk builder respects sentence boundaries — chunks never cross a sentence end. | Reads sentenceStart on the next token while filling a chunk; closes the chunk before crossing. |

The flag is computed once per input stream (cheap — single linear pass). Consumers that derive sub-indices from it cache them; the helper itself does no caching.

## Test cases

The implementation PR (separate; see DoD below) must port all 8 Safari `processText` sentence-boundary cases from `chriscantu/speed-reader/tests/js/word-processor.test.js` (lines 35-87), expressed against the new `markSentenceBoundaries` API.

### Safari parity cases

| # | Input text | `tokenize` output | `sentenceStart` array (word tokens only) |
|---|---|---|---|
| 1 | `'First sentence. Second sentence.'` | `['First', 'sentence.', 'Second', 'sentence.']` | `[true, false, true, false]` |
| 2 | `'Is this right? Yes it is.'` | `['Is', 'this', 'right?', 'Yes', 'it', 'is.']` | `[true, false, false, true, false, false]` |
| 3 | `'Wow! That is great.'` | `['Wow!', 'That', 'is', 'great.']` | `[true, true, false, false]` |
| 4 | `'increase retention.[10][11][2] There are three types'` | `['increase', 'retention.[10][11][2]', 'There', 'are', 'three', 'types']` | `[true, false, true, false, false, false]` |
| 5 | `'(see footnote.) The next'` | `['(see', 'footnote.)', 'The', 'next']` | `[true, false, true, false]` |
| 6 | `'she said." He left.'` | `['she', 'said."', 'He', 'left.']` | `[true, false, true, false]` |
| 7 | `'Dr.[Smith] gave'` | `['Dr.[Smith]', 'gave']` | `[true, true]` (documented quirk) |
| 8 | `'see [10] for details'` | `['see', '[10]', 'for', 'details']` | `[true, false, false, false]` (negative: bare brackets without preceding punctuation do NOT end a sentence) |

### Additional Chrome-side cases (the spec pins these)

| # | Input text | Notes |
|---|---|---|
| 9 | `''` | Empty input → empty output. |
| 10 | `'one'` | Single-word input → `[{kind:'word', text:'one', sentenceStart: true}]`. |
| 11 | `'hello\n\nworld'` | Paragraph break ends a sentence even without `.!?`. Expected: `word(true)`, `paragraph`, `word(true)`. |
| 12 | `'a — b'` | Em-dash does NOT end a sentence. Expected: `word(true)`, `dash`, `word(false)`. |
| 13 | `'first.\n\nsecond.'` | Sentence end + paragraph break stay consistent: `word(true)`, `paragraph`, `word(true)`. |
| 14 | `'e.g., for example'` | Mid-word `.` followed by `,` does NOT end a sentence. Expected: `word(true)`, `word(false)`, `word(false)`. |

The implementation PR adds these as vitest cases under `src/core/tokenize/__tests__/sentence-boundary.test.ts`.

## Open questions — resolved

The three open questions in #90's issue body:

- **Where does this live?** ✅ A new helper `markSentenceBoundaries(tokens)` co-located with `tokenize` under `src/core/tokenize/`, exported through `src/core/tokenize/index.ts`. The existing `tokenize` signature is **not** changed.
- **Who consumes the flag?** ✅ Five issues per the §Consumer surface table: #15, #20, #23, #51, #97. Each consumer opts in by calling the helper; tokenize-only consumers (e.g., a future word-counter) stay on `string[]`.
- **Paragraph-sentinel interaction?** ✅ Paragraph breaks ARE sentence boundaries — the next word after `'\n\n'` always has `sentenceStart: true`, regardless of the preceding word's punctuation.

## Definition of Done

For this spec PR:

- [x] Spec lands in `docs/superpowers/specs/`
- [x] Algorithm and regex spelled out with worked examples
- [x] Safari parity cases enumerated; negative cases enumerated; Chrome-side additions enumerated
- [x] API surface chosen (layered helper, not tokenize extension)
- [x] Consumer surface mapped to specific downstream issues

Out of scope (lives in the follow-on implementation PR):

- Implementing `markSentenceBoundaries` in `src/core/tokenize/sentence-boundary.ts`
- Writing the vitest test suite (Safari 8 + Chrome 6 cases)
- Wiring rsvp-engine pacing (#15) and downstream consumers — those are separate issues that will *use* this helper

## Non-goals

- **Locale-aware sentence detection.** This spec is for English-with-Latin-punctuation text, matching Safari's heuristic. CJK sentence-final punctuation (`。`, `！`, `？`) is NOT in this v1; if it's needed, it lands in a follow-up.
- **NLP-style sentence segmentation.** No ML, no statistical models. The regex-based heuristic is the contract.
- **Sentence END flag.** The spec emits `sentenceStart` only; "ends a sentence" is derived by consumers via lookahead (`tokens[i+1].sentenceStart`). One flag, one direction; consumer-derived inverse.
- **Abbreviation handling beyond Safari parity.** `Dr.[Smith]` is treated as a boundary per Safari; we do NOT add an abbreviation dictionary to fix the quirk.

## References

- Safari reference: `chriscantu/speed-reader/Resources/rsvp/word-processor.js` (`processText`, `sentenceStart` field)
- Safari test cases: `chriscantu/speed-reader/tests/js/word-processor.test.js` lines 35-87
- Gap analysis that surfaced #90: closing comment on [#84](https://github.com/chriscantu/speedreader-chrome/issues/84)
- Related issues that consume this primitive: #15, #20, #23, #51, #97
- `src/core/tokenize/tokenize.ts` — the function this layer wraps
- `src/core/tokenize/__tests__/tokenize.test.ts` — the test file this spec composes with
