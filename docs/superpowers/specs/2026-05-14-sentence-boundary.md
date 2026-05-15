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
  | { kind: 'word'; text: string; sentenceStart: boolean; sentenceEnd: boolean }
  | { kind: 'paragraph'; text: '\n\n' }
  | { kind: 'dash'; text: '—' | '–' };

export function markSentenceBoundaries(tokens: string[]): MarkedToken[];
```

Re-exported from `src/core/tokenize/index.ts` alongside `tokenize`.

### Why both `sentenceStart` AND `sentenceEnd`

A naive design would emit only `sentenceStart` and ask consumers to derive "does the current word end a sentence" via lookahead (`tokens[i+1]?.sentenceStart`). That breaks down across sentinels: a word followed by `kind: 'dash'` then a word doesn't have a clean `sentenceStart` answer, and `kind: 'paragraph'` carries no flag at all. Pacing (#15) — "1.5× delay after a sentence-ending word" — would have to re-implement the regex per call site.

Emitting both flags during the same single-pass walk costs zero extra state (the algorithm already computes "does this word end a sentence" to update `nextWordStartsSentence`) and removes the derivation footgun from every consumer.

### Why a discriminated union and not `Array<string | {text, sentenceStart}>`

Consumers (rsvp-engine for pacing, overlay for context preview, future chunk builder) all need to differentiate words from structural tokens. A discriminated union with `kind` makes that switch ergonomic in TypeScript without `typeof === 'string'` checks and keeps the flag fields on `kind: 'word'` only. Sentinels do not carry either flag — they delimit but do not contain.

### Detection algorithm

Walk the input array left-to-right, carrying one piece of state: `nextWordStartsSentence: boolean`.

1. **Initialize** `nextWordStartsSentence = true`. The first word in any non-empty stream always starts a sentence.
2. **For each token:**
   - If the token is `'\n\n'` → emit `{kind: 'paragraph', text: '\n\n'}`; set `nextWordStartsSentence = true`. Paragraph breaks implicitly end a sentence regardless of the previous word's punctuation.
   - If the token is `'—'` or `'–'` → emit `{kind: 'dash', text}`; **do not change** `nextWordStartsSentence`. Dashes are intra-sentence pause markers.
   - Otherwise (word) →
     a. Compute `endsSentence = SENTENCE_END_RE.test(text) && !ABBREVIATION_RE.test(text)` (rules below).
     b. Emit `{kind: 'word', text, sentenceStart: nextWordStartsSentence, sentenceEnd: endsSentence}`.
     c. Set `nextWordStartsSentence = endsSentence`. Paragraph sentinel may override on the next iteration.

### "Word ends a sentence" — the regex

A word ends a sentence iff it matches the terminator regex AND does NOT match the small abbreviation exemption:

```ts
const SENTENCE_END_RE =
  /[.!?…。！？](?:\[[^\]]*\]|\([^)]*\)|["'”’)\]])*$/u;

const ABBREVIATION_RE =
  /\b(?:Dr|Mr|Mrs|Ms|St|Prof|Sr|Jr)\.(?:\[[^\]]*\]|\([^)]*\)|["'”’)\]])*$/u;
```

`SENTENCE_END_RE` breakdown:

- `[.!?…。！？]` — a sentence-terminating punctuation mark, including:
  - Latin: `. ! ?`
  - Unicode horizontal ellipsis: `…` (U+2026; common in dialog and modern web prose)
  - CJK fullwidth terminators: `。` (U+3002), `！` (U+FF01), `？` (U+FF1F)
- `(?: ... )*` — followed by zero or more trailing closing artifacts:
  - `\[[^\]]*\]` — a complete `[...]` group (footnote refs like `[10]`, `[Smith]`)
  - `\([^)]*\)` — a complete `(...)` group (closing parens after a parenthetical)
  - `["'”’)\]]` — a single closing quote or bracket / paren / square-bracket
- `$` — the word must end here

The three trailing-artifact branches start with distinct characters (`[`, `(`, or a literal closing char), so the alternation does not backtrack. The repetition `*` is bounded by word length — no catastrophic-backtracking surface.

**Interleaving is intentional.** The trailing-artifact group accepts `[..]` groups, `(...)` groups, and single closing chars in any order and quantity. Real-world prose has all of:

- `said.[note]"` — bracket then quote
- `wow!"]` — quote then bracket
- `right?")` — quote then paren

All match. See §Test cases #18–#20.

### "Looks like an abbreviation, not a sentence end" — the exemption

`ABBREVIATION_RE` keeps a small bounded set of period-bearing abbreviations off the sentence-boundary path, with the same trailing-artifact tail so `Dr.[Smith]` matches the exemption (not just bare `Dr.`):

- `Dr Mr Mrs Ms St Prof Sr Jr` — common English honorifics

The set is deliberately small — adding more (`No.` for Number, `e.g.` for "for example", `i.e.`, `Inc.`, `Ph.D.`, etc.) widens both correct exemptions and false negatives (e.g., `No.` at end of sentence) and is out of scope for v1. Expanding the set is a follow-up ADR.

### Chrome divergence from Safari — what and why

Three of the regex's choices diverge from the Safari reference (`chriscantu/speed-reader/Resources/rsvp/word-processor.js`). All are documented here so future supersession decisions have an audit trail:

| Item | Safari | Chrome | Why |
|---|---|---|---|
| Ellipsis `…` as terminator | Not handled (no test exists; behavior unverified) | Treated as a sentence terminator | Modern web prose uses ellipsis as a soft full-stop. The cost is one codepoint in the char class. |
| CJK terminators `。！？` | Not handled | Treated as sentence terminators | Audience includes non-English neurodivergent readers per `CLAUDE.md`. tokenize already preserves CJK terminators when authors space-separate; adding them costs three codepoints. The non-spaced CJK case (one giant token per line) is out of scope — see Non-goals. |
| `Dr.[Smith]` and other honorific+bracket constructions | Mis-detected as sentence boundary (Safari quirk) | Honorific exemption avoids the quirk | Per `CLAUDE.md` memory "parity is floor, not ceiling." The cost is one regex and a small abbreviation set. The benefit is correct pacing on every "Dr. Smith arrived." / "Dr.[1] noted that..." construction — a non-trivial fraction of long-form reading material. Diverges from Safari test case #7. |

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
| **#51 Chunks** (future) | Chunk builder respects sentence boundaries — chunks never cross a sentence end. | Reads `sentenceEnd` while filling a chunk; closes the chunk on the word whose `sentenceEnd === true`. |
| **#30 Options page preview** (transitive) | If the Options page renders sample RSVP playback through `createRsvpEngine`, it inherits whatever consumers above the engine call. Pacing's use of `sentenceEnd` makes this a transitive consumer. | No direct read; rides on rsvp-engine's apply. |

The flags are computed once per input stream (cheap — single linear pass). Consumers that derive sub-indices from `sentenceStart` (#23 boundary list, #20 slice anchors) cache them; the helper itself does no caching.

## Test cases

The implementation PR (separate; see DoD below) must port all 8 Safari `processText` sentence-boundary cases from `chriscantu/speed-reader/tests/js/word-processor.test.js` (lines 35-87), expressed against the new `markSentenceBoundaries` API.

Each row lists both `sentenceStart` and `sentenceEnd` arrays for the word tokens only. Sentinels are noted inline.

### Safari parity cases (cases 1–6 + 8 match Safari; case 7 deliberately diverges)

| # | Input text | `tokenize` output | `sentenceStart` (words) | `sentenceEnd` (words) |
|---|---|---|---|---|
| 1 | `'First sentence. Second sentence.'` | `['First', 'sentence.', 'Second', 'sentence.']` | `[true, false, true, false]` | `[false, true, false, true]` |
| 2 | `'Is this right? Yes it is.'` | `['Is', 'this', 'right?', 'Yes', 'it', 'is.']` | `[true, false, false, true, false, false]` | `[false, false, true, false, false, true]` |
| 3 | `'Wow! That is great.'` | `['Wow!', 'That', 'is', 'great.']` | `[true, true, false, false]` | `[true, false, false, true]` |
| 4 | `'increase retention.[10][11][2] There are three types'` | `['increase', 'retention.[10][11][2]', 'There', 'are', 'three', 'types']` | `[true, false, true, false, false, false]` | `[false, true, false, false, false, false]` |
| 5 | `'(see footnote.) The next'` | `['(see', 'footnote.)', 'The', 'next']` | `[true, false, true, false]` | `[false, true, false, false]` |
| 6 | `'she said." He left.'` | `['she', 'said."', 'He', 'left.']` | `[true, false, true, false]` | `[false, true, false, true]` |
| 7 | `'Dr.[Smith] gave'` | `['Dr.[Smith]', 'gave']` | `[true, false]` ⚠️ **Chrome diverges from Safari** (Safari emits `[true, true]`) | `[false, false]` |
| 8 | `'see [10] for details'` | `['see', '[10]', 'for', 'details']` | `[true, false, false, false]` | `[false, false, false, false]` (negative: bare brackets without preceding punctuation do NOT end a sentence) |

### Additional Chrome-side cases (this spec pins them)

| # | Input text | Notes |
|---|---|---|
| 9 | `''` | Empty input → empty output. |
| 10 | `'one'` | Single word → `[{kind:'word', text:'one', sentenceStart: true, sentenceEnd: false}]`. |
| 11 | `'hello\n\nworld'` | Paragraph break ends a sentence even without `.!?`. Expected: `word(start:true,end:false)`, `paragraph`, `word(start:true,end:false)`. |
| 12 | `'a — b'` | Em-dash does NOT end a sentence. Expected: `word(true,false)`, `dash`, `word(false,false)`. |
| 13 | `'first.\n\nsecond.'` | Sentence-end then paragraph stay consistent. Expected: `word(true,true)`, `paragraph`, `word(true,true)`. |
| 14 | `'e.g., for example'` | Mid-word `.` followed by `,` does NOT end a sentence. Expected: `word(true,false)`, `word(false,false)`, `word(false,false)`. |
| 15 | `'a — \n\nb'` (em-dash before paragraph) | Dash leaves state unchanged; paragraph forces start. Tokenize output: `['a', '—', '\n\n', 'b']`. Expected: `word(true,false)`, `dash`, `paragraph`, `word(true,false)`. Pins behavior for cutoff-utterance prose. |
| 16 | `'Dr. Smith arrived. He left.'` | Honorific exemption: `Dr.` does NOT end a sentence even though it ends in `.`. Tokenize output: `['Dr.', 'Smith', 'arrived.', 'He', 'left.']`. Expected starts: `[true, false, false, true, false]`. Expected ends: `[false, false, true, false, true]`. |
| 17 | `'Wait… what?'` | Ellipsis terminator. Tokenize output: `['Wait…', 'what?']`. Expected starts: `[true, true]`. Expected ends: `[true, true]`. |
| 18 | `'said.[note]" he wrote.'` | Mixed trailing artifacts: bracket then quote. Tokenize: `['said.[note]"', 'he', 'wrote.']`. Expected starts: `[true, true, false]`. Expected ends: `[true, false, true]`. |
| 19 | `'wow!"] The end.'` | Mixed trailing: quote then bracket. Tokenize: `['wow!"]', 'The', 'end.']`. Expected starts: `[true, true, false]`. Expected ends: `[true, false, true]`. |
| 20 | `'wow?! Really.'` | Adjacent terminators. Tokenize: `['wow?!', 'Really.']`. Expected starts: `[true, true]`. Expected ends: `[true, true]`. The regex matches `?!`$ via `[.!?]` (greedy `?`) followed by `[.!?]` (greedy `!`) — actually `[.!?](?:...)*$` matches starting at the `!`, since `[.!?]` greedily matches `!` then `$`. Either anchor position matches; result is the same. |
| 21 | `'中文。 한글？'` | CJK terminators. Tokenize: `['中文。', '한글？']`. Expected starts: `[true, true]`. Expected ends: `[true, true]`. |

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

- **Locale-aware sentence detection at the tokenize layer.** CJK terminator codepoints (`。！？`) ARE recognized by the regex (see §"Chrome divergence from Safari"). What is NOT in scope is CJK *segmentation* — tokenize splits on whitespace, so non-spaced CJK prose comes through as one giant token per line and the helper's per-token detection cannot subdivide it. Real CJK support requires a separate segmenter, tracked as a follow-up.
- **NLP-style sentence segmentation.** No ML, no statistical models. The regex-based heuristic + small abbreviation set is the contract.
- **Large abbreviation dictionary.** Only common English honorifics are exempted (`Dr Mr Mrs Ms St Prof Sr Jr`). Expanding to `No.`, `e.g.`, `i.e.`, `Inc.`, `Ph.D.`, etc. is a follow-up ADR — each addition trades off correct exemption against false negatives (e.g., `No.` at end of sentence).
- **File-organization growth.** If `sentence-boundary.ts` exceeds ~150 LOC or grows non-sentence-boundary helpers, extract to `src/core/sentence/`. This spec co-locates with tokenize as the right call *while the helper stays small*; the threshold is a guardrail against the file becoming a dumping ground.

## References

- Safari reference: `chriscantu/speed-reader/Resources/rsvp/word-processor.js` (`processText`, `sentenceStart` field)
- Safari test cases: `chriscantu/speed-reader/tests/js/word-processor.test.js` lines 35-87
- Gap analysis that surfaced #90: closing comment on [#84](https://github.com/chriscantu/speedreader-chrome/issues/84)
- Related issues that consume this primitive: #15, #20, #23, #51, #97
- `src/core/tokenize/tokenize.ts` — the function this layer wraps
- `src/core/tokenize/__tests__/tokenize.test.ts` — the test file this spec composes with
