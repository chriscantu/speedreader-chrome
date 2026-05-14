# ADR #0002: Theming model — single rich `theme` enum aligned with the design pack

Date: 2026-05-14

## Responsible Architect

Chris Cantu

## Author

Chris Cantu

## Contributors

* `decision-challenger` agent — round-3 review pending after draft lands.

## Lifecycle

POC

## Status

Proposed

## Context

Supersedes [ADR #0001](./0001-theming-two-axis-theme-and-accent.md).

ADR #0001 adopted a two-axis design (`theme: enum(light|dark|system)` + `accent: enum(default|cream|slate)`) based on the current shipped state of `src/core/settings/schema.ts` (3-value `theme` enum). Round-2 decision-challenger surfaced operational warnings but signed off on the architecture.

**Round-3 finding (post-merge):** when retitling #50 / #74 per the ADR's adjudication plan, both issues' bodies surfaced material that ADR #0001 did not consider:

1. `docs/design/Speed Reader Hi-Fi.html` defines **six named themes** plus default light: `dark`, `sepia`, `paper`, `cream`, `nord`. Verified via `grep -oE '\[data-theme="[^"]+"\]' docs/design/Speed\ Reader\ Hi-Fi.html | sort -u`.
2. The reconciled settings spec `docs/superpowers/specs/2026-05-08-settings-schema.md` already lists the canonical schema as:
   ```ts
   theme: z.enum(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord'])
   ```
   with a `system` → `prefers-color-scheme` resolution at render time. Per repo memory, **specs are SSOT** ("specs ship as PR first; spec → merge → implementation dispatch").
3. #74 is not "4 more named themes"; it is the implementation issue for the **palette + accessibility-test surface** of the design-pack expansion: per-theme CSS tokensets (background, surface tiers, text, accent, accent-soft), per-theme axe-core contrast verification, per-theme `forced-colors: active` variant.

`src/core/settings/schema.ts` currently ships a 3-value `theme` enum (`light | dark | system`). That is **spec drift**: the code is behind the spec, not the spec behind the code. ADR #0001 inadvertently encoded the drifted code state as the architectural baseline and proposed an `accent` axis to recover what the spec had already adjudicated as a single-enum expansion.

**Supersession (not amendment-in-place) is the right discipline here, even sub-24-hours.** The error was in ADR #0001's *input baseline* (code state mistaken for SSOT), not in its reasoning method — the reversibility-asymmetry analysis, combinatorial-discipline framing, and abort-trigger structure are sound and future ADRs will want to cite them. Amending in place would rewrite the historical record of a ratified decision and destroy the auditable trace that the analytical form was sound while the inputs were wrong. ADR #0001's Status field now reflects the supersession; this ADR builds on the *form* of that analysis, not on its conclusions.

Forces in tension (revised):

- **Spec is the SSOT.** Repo memory `feedback_specs_ship_as_pr_first.md` is unambiguous: when the spec and the code disagree, the spec leads. ADR #0001 inverted that.
- **Designer-tuned color is load-bearing.** Each design-pack theme is a fully-designed surface (5-token palette, forced-colors variant, axe-verified contrast). A two-axis cartesian product permits combinations the designer never tuned (e.g., `dark + cream`) — visually degraded for an audience that is explicitly sensitive to color comfort.
- **Audience.** SpeedReader's neurodivergent-reader focus means the *quality* of color presets matters more than the *count* or *axes*. A small set of designer-tuned themes beats a larger combinatorial space.
- **Accessibility verification cost.** axe-core contrast scans + forced-colors checks per visual surface. 7 single-axis themes = 7 scans. 3 × 3 cartesian = 9 scans, where the off-diagonal combinations the designer never tuned would silently fail or produce visually rough output.
- **`'system'` semantics survive either model.** It reads `prefers-color-scheme` at render and resolves to `light` or `dark` — both models support this.
- **Migration cost.** Either ADR's design requires V1 → V2: ADR #0001 adds an `accent` field; this ADR's design extends the `theme` enum's allowed values. Both ride #66 / #67 / #68 migrations work. The single-enum extension is structurally simpler (no new field, just an enum literal set expansion + a default-preservation migration).
- **Reversibility.** Trimming the theme enum down later (drop `nord` if unused) is a one-shot migration with a fallback default. Adding orthogonal axes later remains lossy; the single-enum model does not preclude that future move if user signal demands it.

## Decision

M1 ships the **single rich `theme` enum** exactly as adjudicated in `docs/superpowers/specs/2026-05-08-settings-schema.md`. The schema field becomes:

```ts
theme: z.enum(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord'])
```

`SettingsSchemaV1` bumps **V1 → V2** to allow the four added values (`sepia`, `paper`, `cream`, `nord`). The V1 → V2 migrator is value-preserving but **not a no-op**: every existing row carries `version: 1` on disk, and the V2 schema pins `version: z.literal(2)`. The required migrator is structurally trivial:

```ts
// MIGRATIONS keyed by source version per the settings spec
MIGRATIONS[1] = (old) => ({ ...old, version: 2 });
```

Existing `theme` values (`light | dark | system`) validate unchanged against the V2 enum — that part is genuinely default-preservation. The `version` field rewrite is the migration's actual work. This must be registered in the `MIGRATIONS` table per `docs/superpowers/specs/2026-05-08-settings-schema.md` §"Migrations"; without it, V1-seeded rows fail V2 parse on cold start.

The schema-version bump itself is required because the **set of valid enum literals grew**. This rule is established by THIS ADR; future ADRs may cite it. The trigger condition is: any change that would cause a previously-valid persisted payload to fail parse, OR any change that introduces new literals existing migrators do not know about. Both apply here (the second only).

`accent` field is **not introduced**. The `accent` axis proposed in ADR #0001 is rescinded.

Adjudication of the three open issues:

- **#26 stays open** — M1 implementation issue for the **baseline triplet** (`light | dark | system`) apply layer (CSS-variable wiring, `'system'` → `prefers-color-scheme`). Title unchanged.
- **#50 closes as superseded** by this ADR's single-enum model. The background-color customization use case is satisfied by the named-theme palette: each named theme IS a designer-tuned bg+fg combination, which is what #50 originally asked for in ad-hoc form. Comment on closure links here and explains the substitution.
- **#74 stays open, unchanged title.** Owns the **4 added themes** (`sepia | paper | cream | nord`), their CSS tokensets, per-theme axe-core contrast verification, and per-theme `forced-colors` variants. **#74 gates the V2 migration**: the V2 PR cannot merge until #74's tokensets + a11y checks are in place, so the persisted-data invariant (any `theme` value that round-trips through `chrome.storage.sync` MUST resolve to a fully-designed surface in the apply layer) holds from day one.

Apply layer (rendering):

- Each theme is a separate CSS tokenset (5 tokens: `--sr-bg`, `--sr-surface-tier-1`, `--sr-surface-tier-2`, `--sr-fg`, `--sr-accent` per the design pack), exported from one source file inside the overlay component.
- `'system'` reads `prefers-color-scheme` and resolves **strictly** to `light` (for `prefers-color-scheme: light`) or `dark` (for `prefers-color-scheme: dark`). It never resolves to an aesthetic variant. The four added themes (`sepia | paper | cream | nord`) are reachable only by explicit user selection.
- Contrast partition (verified against `docs/design/Speed Reader Hi-Fi.html` lines 39-128): the **light-contrast** surfaces are `{light, paper, cream, nord, sepia}` (each has a light `--bg` — `nord` uses `#eceff4`, which is light, not dark, despite its cool palette). The **dark-contrast** surface is `{dark}`. `system` resolves only across the canonical `light` / `dark` pair; aesthetic variants are an explicit choice.
- `forced-colors: active` is handled per-theme (fallback to system tokens, but the per-theme logic is verified). The hi-fi mock has one such screen today (`docs/design/screens/paper-forced.png`); the others need to be produced as part of #74.
- Apply layer lives outside `src/core/` per the boundary contract in `src/core/README.md`.

## Consequences

Positive:

- **Aligns code with the SSOT spec.** Closes the drift `src/core/settings/schema.ts` (3 values) ↔ `2026-05-08-settings-schema.md` (7 values).
- **Designer-tuned quality preserved.** Each named theme is a fully-curated surface, not an algorithmic cross-product. Honors the audience's color sensitivity.
- **Accessibility scope is sharp.** N themes → N axe-core scans + N forced-colors variants. No undefined off-diagonal combinations.
- **Simpler schema growth path.** Future "user wants a new theme" = enum extension + one tokenset + one a11y scan. No interaction with a second axis.
- **Honors repo memory.** "Specs ship as PR first" is followed; the spec was already the SSOT before either ADR was drafted, and this ADR formally aligns with it.

Negative:

- **Supersedes ADR #0001 less than 24 hours after merge.** The record now shows a same-day rescission. Mitigated: documented in this ADR's Context (round-3 finding), and ADR #0001's Status is updated to `Superseded by ADR #0002` so future readers follow the chain.
- **Orthogonal tint axis is structurally foreclosed, not merely deprioritized.** The per-theme-tokenset discipline this ADR adopts (5 designer-tuned tokens per theme, including a hand-picked `--sr-accent`; per-theme axe-core verification; per-theme `forced-colors` variant) is structurally incompatible with an additive accent axis. An orthogonal axis would have to *override* tuned `--sr-accent` values (defeating the audience-color-sensitivity argument) AND would re-introduce the N × M unverified-combinations problem the per-theme scan was meant to prevent. **If a future ADR adopts an orthogonal axis, it rescinds this ADR's per-theme discipline — it does not extend it.** This is the cost of the decision; it is not avoided by claiming "future ADR" optionality.
- **Per-theme a11y verification is more work than a 1-axis-of-3 baseline.** Each new theme is an axe + forced-colors variant + visual review. Bounded by #74's DoD but real.
- **More CSS surface to maintain.** 7 tokensets vs ADR #0001's 9 cartesian pairs — slightly less total, but each is a designer-tuned set rather than a recombination of a smaller palette.
- **Safari `paper → theme` mapping is mostly clean but one cell is ambiguous.** Safari porting users moving to Chrome will need a deterministic mapping for #50's closure comment:

  | Safari `paper` | Chrome `theme` | Notes |
  |---|---|---|
  | `white` | `light` | Direct equivalent. |
  | `cream` | `cream` | Direct equivalent (matching aesthetic). |
  | `black` | `dark` | Direct equivalent. |
  | `slate` | **user re-chooses between `dark` and `paper`** | Ambiguous. Safari's `slate` is a cool dark surface; Chrome's `dark` is the canonical dark contrast and `paper` is a cool light surface. Neither is a 1-for-1. **Documented limitation:** the user must re-select. |

  The `slate` cell does not have a clean mapping. This is real friction for Safari porting users in that one case and is called out here (not in Neutral) because the named-theme model claims to substitute for Safari paper. The substitution is N=3 / 4 clean; one of four Safari values requires user re-selection.

Neutral:

- **No automatic Safari → Chrome migration.** Different storage backends. Safari porting users re-select preferences on first install. The CHANGELOG entry (#42) is the comms surface that documents the named-theme set.
- **`'system'` extends only to `light` / `dark`.** A future `prefers-contrast: more` signal is its own decision — out of scope here.
- **Naming-bikeshed surface.** The design pack's literal-name choices (`sepia`, `paper`, `cream`, `nord`) are inherited as-is from the hi-fi mock; if a future product call renames, that is a V2 → V3 string migration. #74 is the place that locks in the names at merge time.

## Abort plan / wrong-call signal

This ADR is wrong, and a successor ADR should be opened *before* M1 ships, if any of:

- **Per-theme a11y verification (axe-core + forced-colors) cannot pass for any one of the four added themes** (`sepia | paper | cream | nord`). Trigger: a contrast violation that cannot be resolved by tokenset tweaks. **Action:** drop the failing theme from the V2 enum literal set; reopen this ADR if more than one is dropped.
- **Schema V1 → V2 migration introduces correctness issues** that cascade across `#67` / `#68` settings hardening. Trigger: any added test failure in `src/core/settings/__tests__/migrations.test.ts` that blocks for >2 days. **Action:** open a successor ADR with a smaller migration scope (e.g., land 2 themes in V2, defer 2 more to V3).
- **M1 user feedback repeatedly requests cross-product combinations** the named-theme set does not provide (e.g., "cream on dark", "sepia on dark"). Trigger: ≥3 distinct issues opened under the `area:theming` label within 30 days of M1 store launch asking for specific cross-product combinations. **Owner: the responsible architect listed above** — counts inbound `area:theming` issues at M1 + 7d, +14d, +30d cadence. **Action: open a successor ADR that explicitly rescinds the per-theme-tokenset discipline this ADR establishes.** That is not an additive change — it is a structural reversal (see the foreclosure note in §Consequences). The successor ADR's first PR is the redesigned token model, not an enum extension; the named-theme tokensets shipped under #74 will need to either become *base* contrast pairs (with the accent axis layered on top) or be retired. Realistic first-PR scope is weeks, not days. The alternative response — declining the request and pointing users at the closest named theme — is also defensible and may be the right answer if the count is small or the requests cluster on a single missing combination. The action is "decide between redesign and decline at the time, with the count and content of the requests in hand"; this trigger is not a commitment to either path.

Revisit at the start of M2 planning regardless. If none of the abort triggers fired during M1, the ADR moves from `Proposed` to `Accepted` and from `Lifecycle: POC` to `Lifecycle: GA` at that point.
