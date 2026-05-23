# Alignment Field + Schema V2 Bump

**Date:** 2026-05-23
**Status:** Proposed
**Issue:** [#93 — Add alignment field (orp/center) to settings (Safari parity)](https://github.com/chriscantu/speedreader-chrome/issues/93)
**Milestone:** M1 (MVP parity)
**Scope:** Add an `alignment: 'orp' | 'center'` field to the persisted settings shape and bump `CURRENT_VERSION` from 1 to 2. Defines the schema change, the V1→V2 migration shape, the Zod validation contract, and the test plan the implementation PR will execute. Does NOT cover Options-page UI or overlay-rendering integration.

---

## Problem Statement

The Safari reference exposes a per-user **word alignment** preference that controls how each RSVP word is positioned within the reader pane:

- **`orp`** — Optimal Recognition Point. The fixation character (typically a slightly off-center letter chosen by RSVP psycholinguistics) is pinned to a fixed horizontal pixel position; the rest of the word floats to either side of that anchor. Eye saccades stay minimal because every word presents its ORP at the same coordinate.
- **`center`** — the whole word is centered in the pane. Easier to reason about visually; requires more saccade adjustment per word because shorter / longer words land different characters under the gaze point.

ORP is the Safari default and the documented benefit for neurodivergent readers (lower saccade load → less fatigue per minute). Centered alignment is the escape hatch for readers who find ORP disorienting or who prefer the "marquee" feel during longer sessions.

Per Safari `tests/js/settings-defaults.test.js`'s `validateAlignment` describe block, the preference is a two-value enum (`'orp' | 'center'`) defaulting to `'orp'`, with all other values rejected at the validation layer. Chrome inherits both the surface and the default as part of the parity floor.

The setting must be persisted (it's a per-user preference, not a per-page state), which puts it inside `SettingsSchemaV1`'s territory. Adding it without bumping `CURRENT_VERSION` would mean existing installs (no `alignment` key in their stored blob) fail Zod parsing and fall back to defaults — losing every other setting in the same blob. A version bump + migrator is the contract `2026-05-08-settings-schema.md` set up exactly for this case.

## Constraints

- **`src/core/` boundary.** All changes land in `src/core/settings/{schema,defaults,migrations}.ts`. No `chrome.*` / `browser.*` imports added.
- **MV3 service-worker reload safety.** The migrator runs on every cold `loadSettings`. Migrations must be pure, synchronous, and side-effect-free (no `console.error`, no `chrome.storage.*`). They run before the worker is fully initialized.
- **Safari parity at MVP bar.** `validateAlignment(value)`, `VALID_ALIGNMENTS = ['orp', 'center']`, and `ALIGNMENT_DEFAULT = 'orp'` are the surface to mirror. Chrome may extend the enum later (e.g., `'left'`, `'right'`) but the MVP ships the two Safari values exactly.
- **Forward-only sequential migration.** Per the V1 spec, the migrator chain is `0 → 1 → 2 → …`, keyed by source version. No graph, no skip-ahead.
- **Corrupt-data resilience preserved.** A V1 payload missing `alignment` must migrate to V2 with `alignment: 'orp'`, NOT fall back to full `DEFAULT_SETTINGS`. Losing the user's WPM because we added a field is a regression.

## Decision

### Add `alignment` to `SettingsSchemaV2`

Source of truth (implementation PR will land it): `src/core/settings/schema.ts`.

```ts
import { z } from 'zod';

export const SettingsSchemaV2 = z.object({
  version: z.literal(2),
  wpm: z.number().int().min(100).max(600).multipleOf(10),
  theme: z.enum(['light', 'dark', 'system']),
  font: z.string(),
  fontSize: z.number().int().min(12).max(48),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
  alignment: z.enum(['orp', 'center']),
});

export type SettingsV2 = z.infer<typeof SettingsSchemaV2>;

export const CURRENT_VERSION = 2 as const;
```

The impl PR will **remove `SettingsSchemaV1` and `SettingsV1` exports from `src/core/settings/schema.ts`; rename to `SettingsSchemaV2` / `SettingsV2`.** There is no install base of v1 payloads outside developer machines yet (the extension has not shipped to the Web Store). Keeping a `V1` export around indefinitely would invite consumers to import the wrong one. The migrator handles old payloads at load time; in-code consumers always read the current version.

**Zod strictness:** `SettingsSchemaV2` uses the **default Zod object mode** (passthrough-then-strip on `.parse`), NOT `.strict()`. This matches the current `SettingsSchemaV1` behavior — unknown keys in stored blobs are silently dropped, not rejected. Switching to `.strict()` would convert any forward-compat field (e.g., a dev-channel V3 blob loaded by a V2 build) into a full `DEFAULT_SETTINGS` fallback, losing user data on downgrade. Default mode is the safer compatibility posture; revisit only if an unknown-key class of bugs forces it.

**Feature flag:** No feature flag for the alignment field — it ships as a single atomic schema bump. Flagging a persisted field shape would require dual-write/dual-read paths, doubling the surface area for a two-value enum.

### Default: `'orp'`

Source of truth (impl PR): `src/core/settings/defaults.ts`.

```ts
export const DEFAULT_SETTINGS: SettingsV2 = {
  version: 2,
  wpm: 250,
  theme: 'system',
  font: 'system-ui',
  fontSize: 20,
  openDyslexic: false,
  punctuationPacing: true,
  alignment: 'orp',
};
```

`'orp'` matches Safari's `ALIGNMENT_DEFAULT` and reflects the feature's primary value proposition (low-saccade reading). Centered alignment is the opt-in escape hatch, not the default.

### Migration: V1 → V2 stamps `alignment: 'orp'`

Source of truth (impl PR): `src/core/settings/migrations.ts`.

```ts
const MIGRATIONS: Record<number, Migrator> = {
  0: (raw) => ({ ...raw, version: 1 }),
  1: (raw) => ({ ...raw, alignment: 'orp', version: 2 }),
};
```

The V1→V2 migrator is a single-field stamp: every existing install gets `alignment: 'orp'` (the safe, Safari-matching default) and a bumped `version`. The shallow-merge step that already runs after the migrator chain (`{ ...DEFAULT_SETTINGS, ...value, version: CURRENT_VERSION }`) means even a V0 payload chained through both migrators arrives at a valid V2 shape with the field present.

### Why land V2 alone (not batched with #101's theme expansion)

Open issue [#101](https://github.com/chriscantu/speedreader-chrome/issues/101) also bumps the schema (theme enum expansion from `['light','dark','system']` to the full 7-theme set documented in `2026-05-08-settings-schema.md`). It is **gated on #74** (theme expansion isn't on the current sprint), and pre-existing spec drift already exists between `2026-05-08-settings-schema.md:56` (7 themes documented) and `src/core/settings/schema.ts:6` (3 themes shipped) — a collision-adjacent risk this spec flags but does not resolve.

The pragmatic call: ship #93 as **V2 alone now**, and let #101 become **V2→V3** later when #74 unblocks it. Rationale:

- **Sequencing latency.** Waiting on #74 → #101 → #93 stacks two upstream dependencies for a one-line schema add. The pacing-impact and overlay-rendering follow-ons (out of scope here) gain nothing from waiting.
- **Migration chain stays cheap.** Each migrator is a single line. Adding `1: alignment-stamp` now and `2: theme-expansion` later costs no more total than batching them.
- **Spec drift is already real.** The 7-theme doc-vs-code split exists today; #101 will close it. Adding `alignment` does not widen or narrow that gap.

### V2 → V3 sketch (for #101's eventual builder)

When #74 unblocks #101, the migrator becomes:

```ts
const MIGRATIONS: Record<number, Migrator> = {
  0: (raw) => ({ ...raw, version: 1 }),
  1: (raw) => ({ ...raw, alignment: 'orp', version: 2 }),
  2: (raw) => ({ ...raw, version: 3 }), // theme enum widened; existing values remain valid
};
```

The V2→V3 migrator is an identity-with-version-bump because the theme enum _widens_ (every V2 value `'light' | 'dark' | 'system'` is also a valid V3 value). If #101 instead renames or removes a theme, the migrator gains a mapping step. The spec for #101 should pin this when it lands.

### Abort signal

If the impl PR's migration tests show >1% fallback-to-`DEFAULT_SETTINGS` rate in dev-load fixtures, OR if #101 ends up needing a non-identity V2→V3 mapping, revisit the standalone-vs-batched strategy before tagging the spec `Accepted`. V2 is forward-only once shipped to any non-dev channel — there is no retreat path that does not orphan stored blobs.

## Out of Scope

- **Options-page UI for alignment.** Lives wherever the alignment-control issue lands (likely a follow-up to #30). This spec does not cover the radio group, label copy, or interaction.
- **Overlay-rendering integration.** The RSVP engine and overlay don't read `alignment` yet — that wiring lands with the overlay UI work (issue TBD; pairs with #19). The persisted field is the contract; reading it is a separate seam.
- **Theme expansion.** Issue [#101](https://github.com/chriscantu/speedreader-chrome/issues/101) handles the 3-theme → 7-theme jump, gated on [#74](https://github.com/chriscantu/speedreader-chrome/issues/74).
- **Additional alignment values.** Safari ships two; Chrome MVP ships two. Extending the enum is a future ADR.

## Test Plan

Implementation PR adds these as vitest cases under `src/core/settings/__tests__/`. **Target: ~13 test cases** (7 schema + 4 migration + 2 defaults). Counting them up front gives the impl PR a numeric gate; missing cases surface immediately in PR review rather than landing as silent test-coverage drift.

### Zod validation — 7 cases (Safari `validateAlignment` parity)

Accept cases (2):

- [ ] `SettingsSchemaV2.parse` ACCEPTS a valid V2 blob with `alignment: 'orp'`.
- [ ] `SettingsSchemaV2.parse` ACCEPTS a valid V2 blob with `alignment: 'center'`.

Reject cases (5) — full Safari `validateAlignment` parity rejects every non-enum value, regardless of JS type:

- [ ] `SettingsSchemaV2.safeParse` REJECTS a blob with `alignment: 'left'` (invalid enum value — string outside enum).
- [ ] `SettingsSchemaV2.safeParse` REJECTS a blob with `alignment: ''` (empty string).
- [ ] `SettingsSchemaV2.safeParse` REJECTS a blob with `alignment: undefined` (missing key — Zod treats absent required field as undefined).
- [ ] `SettingsSchemaV2.safeParse` REJECTS a blob with `alignment: null` (null is not a valid enum member).
- [ ] `SettingsSchemaV2.safeParse` REJECTS a blob with `alignment: 42` (numeric — type mismatch).
- [ ] `SettingsSchemaV2.safeParse` REJECTS a blob with `alignment: true` (boolean — type mismatch).

> Note: list shows 6 reject bullets; pair the two type-mismatch cases (`42`, `true`) into a single parameterized `it.each` or count as 5 in the suite tally — adjust to whichever the impl PR's vitest convention prefers, but cover every value explicitly.

### Migration round-trips — 4 cases

The post-migrator Zod re-validation (the step that turns invalid V1/V2 payloads into a `DEFAULT_SETTINGS` fallback) lives inside `migrate()` in `src/core/settings/migrations.ts`. Tests for the fallback contract belong against that module, not against a separate `loadSettings` symbol.

- [ ] **V0 chain.** `migrate({ version: 0 })` chains through both migrators and returns a value satisfying `SettingsSchemaV2` with `version === 2` AND `alignment === 'orp'` (default acquired via shallow-merge with `DEFAULT_SETTINGS`). Covers the corrupt-data branch — `migrate(undefined)`, `migrate(null)`, `migrate('garbage')`, `migrate([])` each return a value deep-equal to `DEFAULT_SETTINGS` (now V2) with `alignment === 'orp'`.
- [ ] **V1 → V2 stamp.** `migrate({ version: 1, wpm: 300, theme: 'dark', font: 'system-ui', fontSize: 20, openDyslexic: false, punctuationPacing: true })` returns a value satisfying `SettingsSchemaV2` with `version === 2` AND `alignment === 'orp'` AND preserved `wpm === 300`, `theme === 'dark'`.
- [ ] **V2 idempotency** (critical — prevents the user's chosen `'center'` from being clobbered on reload). `migrate({ version: 2, wpm: 300, theme: 'dark', font: 'system-ui', fontSize: 20, openDyslexic: false, punctuationPacing: true, alignment: 'center' })` returns input untouched; `alignment` MUST NOT be overwritten to `'orp'`. The migrator chain has no entry for source-version `2`, so the chain short-circuits and the post-migrator Zod parse accepts the input as-is.
- [ ] **V2 with invalid alignment falls back.** `migrate({ version: 2, wpm: 300, theme: 'dark', font: 'system-ui', fontSize: 20, openDyslexic: false, punctuationPacing: true, alignment: 'left' })` returns a value deep-equal to `DEFAULT_SETTINGS` (post-migrator Zod parse fails on the invalid enum value, triggering the schema-fail fallback path). Pins the contract so future migrator-chain changes do not silently drift the fallback semantics. The existing `migrate({ version: 1, wpm: 'not-a-number' })` invalid-V1 case is the V1 analogue.

### Defaults — 2 cases

- [ ] `DEFAULT_SETTINGS.alignment === 'orp'` AND `DEFAULT_SETTINGS.version === 2`.
- [ ] `VALID_ALIGNMENTS.length === 2` — cardinality invariant. Catches accidental enum widening that would silently pass Safari parity until #101/#74-style work formally expands the enum. Pair this with an `expect(VALID_ALIGNMENTS).toEqual(['orp', 'center'])` for full Safari mirror.

## Open Questions

- **Options-page UI placement.** Where does the alignment radio control land in the Options page? Likely a follow-up to [#30](https://github.com/chriscantu/speedreader-chrome/issues/30) (settings UI). Out of scope here.
- **Overlay rendering wire-up.** Where does the overlay read `settings.alignment` and apply it to word positioning? Deferred until the overlay UI lands (pairs with [#19](https://github.com/chriscantu/speedreader-chrome/issues/19)). The pure ORP-anchor calculation may want to live in `src/core/` so Safari and Chrome share it; that decision belongs to the overlay spec.
- **V2→V3 collision with #101.** This spec sketches the V3 migrator above. The #101 spec, when it lands, should formally adopt or amend that sketch.

## References

- Issue: [#93 — Add alignment field (orp/center) to settings (Safari parity)](https://github.com/chriscantu/speedreader-chrome/issues/93)
- Safari reference: `chriscantu/speed-reader/tests/js/settings-defaults.test.js` (`validateAlignment` describe block; `VALID_ALIGNMENTS`, `ALIGNMENT_DEFAULT`)
- Existing settings-schema spec: [`docs/superpowers/specs/2026-05-08-settings-schema.md`](2026-05-08-settings-schema.md)
- Related issues:
  - [#74](https://github.com/chriscantu/speedreader-chrome/issues/74) — theme expansion (gates #101)
  - [#101](https://github.com/chriscantu/speedreader-chrome/issues/101) — theme enum widening (becomes V2→V3 after this lands)
  - [#30](https://github.com/chriscantu/speedreader-chrome/issues/30) — settings UI (consumer of `alignment`)
  - [#19](https://github.com/chriscantu/speedreader-chrome/issues/19) — overlay rendering (downstream consumer)
  - [#66](https://github.com/chriscantu/speedreader-chrome/issues/66), [#67](https://github.com/chriscantu/speedreader-chrome/issues/67), [#68](https://github.com/chriscantu/speedreader-chrome/issues/68) — settings-adjacent parity work
- `src/core/settings/schema.ts`, `defaults.ts`, `migrations.ts` — files the impl PR will modify
