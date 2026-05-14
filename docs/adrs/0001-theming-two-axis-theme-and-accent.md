# ADR #0001: Theming model — two-axis (theme + accent)

Date: 2026-05-14

## Responsible Architect

Chris Cantu

## Author

Chris Cantu

## Contributors

* `decision-challenger` agent — stress-tested an earlier single-knob draft; findings folded in (see Context).

## Lifecycle

POC

## Status

Proposed

## Context

Three open GitHub issues touch the reader overlay's color treatment — how it is chosen, persisted, and applied:

- **#26 Light / dark / system theme** (`scope:parity`, `phase-1`) — already encoded in `SettingsSchemaV1` as `theme: z.enum(['light', 'dark', 'system'])`.
- **#50 Background-color customization** (`scope:parity`, `future`) — derives from Safari's `paper` field, values `white | cream | slate | black`.
- **#74 Theme expansion: 4 named themes beyond light/dark/system** (`scope:chrome-port`, `phase-1`) — proposes additional Chrome-port presets.

Safari's reference extension exposes a single `paper` field. Its four values entangle contrast (slate / black are dark; white / cream are light) and tint (cream is warm, slate is cool). Safari has no orthogonal contrast axis. Chrome's current schema is the inverse: `theme` covers contrast only, with no tint axis.

An earlier draft of this ADR proposed shipping M1 with the existing 3-value `theme` enum alone, closing #50 as rejected, and recovering more-color-variety in M2 via enum expansion. A `decision-challenger` agent review surfaced two load-bearing problems:

1. **Enum expansion is not a strict superset of an orthogonal `paper × theme` axis.** Safari's 4 × 3 cartesian product cannot be recovered by adding entries to a single enum without combinatorial naming (`light-cream`, `dark-cream`, …) — which is exactly the explosion `phase-1` discipline is meant to avoid.
2. **The audience rationale ("neurodivergent readers benefit from fewer choices") was asserted without evidence.** Safari ships two-knob equivalents to the same audience without surfaced complaints; the rationale was post-hoc justification for schema simplicity.

Forces in tension:

- **Parity floor (`CLAUDE.md` hard constraint).** Feature parity with the Safari extension is the MVP bar; removing the paper-mode affordance is a parity *regression*, not a divergence. `scope:parity / future` labels mean "deferred", not "rejected."
- **Reversibility asymmetry.** Adding a second knob now and removing it later = one-shot migration (default all rows to the no-tint value). Adding a second knob in M2 to a single-knob M1 baseline = reinterpreting every persisted value across two axes, lossy.
- **Cost differential.** Two enums at M1 = one extra schema field + one extra options-page dropdown + a small CSS-variable matrix. Single enum at M1 + later reintroduction = the cost above PLUS migration of in-flight users PLUS apply-layer rewrites in M2.
- **Combinatorial discipline.** Two independent axes scale linearly with new options; a named-theme enum scales multiplicatively.
- **Existing code.** `SettingsSchemaV1.theme` ships and is tested. Adding `accent` is additive — schema bumps V1 → V2 (rides #66 / #67 / #68 migrations work), but `theme` stays in place.
- **Cross-extension migration.** Chrome and Safari are independent extensions with separate `chrome.storage` / Safari-storage backends. There is no automatic Safari → Chrome value carryover regardless of model; this is true under either single-axis or two-axis designs.

## Decision

M1 ships **two independent enum axes** in `SettingsSchemaV1`:

- `theme: z.enum(['light', 'dark', 'system'])` — contrast (which letter / background luminance pair the overlay uses). Already shipped; unchanged.
- `accent: z.enum(['default', 'cream', 'slate'])` — tint applied to the chosen contrast pair. **New field; schema bumps V1 → V2.**

Default for `accent` is `'default'` — no tint, matches the pre-V2 visual baseline. Existing-user upgrade is visually identical until they actively change it.

The non-default accent values `'cream'` and `'slate'` are paper-derived directly from Safari's `paper` field (excluding `white` which collapses to `'default'` + light theme, and `black` which collapses to `'default'` + dark theme) to honor the parity floor. A fourth value (likely `'sepia'`, Safari-divergent) is candidate but **not committed in this ADR**; literal-string selection and any expansion past three values are the responsibility of #74 (retitled — see adjudication below). The V2 migration is gated on #74 resolving first so the persisted string set is stable before it lands in `chrome.storage`.

This adjudicates the three open issues:

- **#26 stays open** → M1 implementation issue for the `theme` axis (CSS-variable wiring, `'system'` → `prefers-color-scheme`).
- **#50 stays open, retitled / relabeled** → M1 implementation issue for the `accent` axis apply layer (schema V2 + migration entry, apply-layer accent overlay, Options-page accent dropdown). NOT closed.
- **#74 stays open, retitled** → "Lock the accent enum values for V2 schema." Selects the final accent value strings (M1 floor: `default | cream | slate`; ceiling: add a fourth value if there's evidence for it). **Gates the V2 migration in #50: the V2 PR cannot merge until #74 closes with a locked value set.** The original "4 named themes" framing is absorbed — the goal-shape (more variety than light/dark/system) is satisfied by the accent axis, but the literal-name selection still lives in #74.

Apply layer (rendering):

- Each `(theme, accent)` pair resolves at render time to a set of CSS variables (`--sr-fg`, `--sr-bg`, `--sr-orp`) on the shadow-DOM overlay.
- `'system'` theme reads `prefers-color-scheme` at apply time and selects the light or dark contrast pair; the chosen accent overlays on whichever resolves.
- M1 pre-bakes all `len(theme) × len(accent)` combinations as static variable sets (no runtime HSL math). Pre-bake table lives alongside the overlay component, not in `src/core/settings/`, so the core schema stays platform-agnostic per `src/core/README.md`.
- `accent` does NOT have a `'system'` value. The OS does not currently signal a tint preference (a future `prefers-contrast: more` signal is a theme-axis concern).

**Pre-bake vs compute trade-off considered.** The alternative is one base contrast pair per theme + one tint function (e.g., `color-mix()` or HSL math) per accent. Pre-bake wins for M1 on three counts: (1) the colors should be designer-tuned, not algorithmically derived from a single base — readability of letterforms against tinted backgrounds is sensitive to exact RGB pairing; (2) `color-mix()` runtime support varies across Chrome versions the extension targets, so the apply layer would need a polyfill path; (3) a centralized pre-bake table is mechanically easier to regression-test (one snapshot per pair) than a runtime computation graph. The compute approach is the right path if the value set grows past ~12 pairs or if a future "user-tunable accent" feature lands.

## Consequences

Positive:

- **Parity floor honored.** Safari paper users find an `accent: 'cream'` / `'slate'` affordance in Chrome's Options page; their preferred reading surface survives the port.
- **Reversible in the safe direction.** If M2 signal says "the accent knob is unused," remove it with one schema migration. The previously dismissed direction (M1 single-knob → M2 two-axis) was lossy.
- **Avoids combinatorial enum explosion.** Two clean axes scale linearly; a named-theme expansion would have scaled multiplicatively.
- **Existing-user upgrade visually unchanged.** `accent: 'default'` ships as the default → produces the current visual baseline. Only users who actively change accent see a change.
- **Surfaces the alternative the decision-challenger flagged.** Bounded-accent was the explicitly under-explored option in the previous draft; this revision adopts it with reasoning.

Negative:

- **Schema migrates V1 → V2.** Adds one migration entry. Rides #66 / #67 / #68 settings-hardening work, not a standalone migration cycle.
- **Options-page surface grows from 1 to 2 dropdowns.** Standard `<select>` widgets, both above-the-fold. Not a power-user-only setting.
- **Apply layer grows from 3 to ~12 CSS-variable sets** (3 contrasts × 4 accents, pre-baked). Manageable; implementation must keep the mapping centralized to avoid drift.
- **Accent value names are partially unsettled.** This ADR commits to `default | cream | slate` as the M1 floor (Safari-derived). A fourth value remains an open decision in #74. If string renames are needed after V2 ships to `chrome.storage`, the migration cost is V2 → V3 — worse than picking right the first time. Mitigation is mechanical: the V2 migration PR (#50) blocks on #74 closure; reviewers verify #74 has merged a locked value set before approving #50.

Neutral:

- **No automatic Safari → Chrome migration.** Different storage backends. Safari porting users re-select preferences on Chrome first install. The CHANGELOG entry (tracked separately as #42) is the comms surface that announces the accent axis and explains the `paper → accent` correspondence (`cream` ↔ `cream`, `slate` ↔ `slate`, `white` ↔ `default + light`, `black` ↔ `default + dark`). True under any theming model — not a consequence specific to this decision.
- **`'system'` extends only to theme, not accent.** Documented above.
- **#74 stays open, retitled.** Its proposal (more theme variety) is absorbed into the accent axis — but the literal-name selection responsibility moves with it. The V2 migration in #50 is blocked on #74 closing. If a future product call invalidates the value names, that work happens in #74 + a successor ADR, not via silent rename.
- **Apply layer placement.** Per `src/core/README.md`, lives outside core. Standard.

## Abort plan / wrong-call signal

This decision is wrong, and the ADR should be revisited *before* M1 ships, if any of:

- **The accent enum's apply-layer matrix grows past ~20 entries during M1 implementation.** Trigger: pre-bake table size > 20. Suggests the design is heading toward the combinatorial explosion two clean axes were meant to prevent.
- **Schema V1 → V2 migration introduces correctness issues** that cascade across `#67` / `#68` settings hardening. Trigger: any added test failure in `src/core/settings/__tests__/migrations.test.ts` that blocks for >2 days. Suggests V2 is more expensive than the cost differential here claimed.
- **M1 user feedback repeatedly requests more than two color axes** — e.g., separate font-color, separate line-spacing color. Trigger: ≥3 distinct issues opened under the `area:theming` label within 30 days of M1 store launch. **Owner: the responsible architect listed above** — counts inbound `area:theming` issues at M1 + 7d, +14d, +30d cadence. **Action when trigger fires:** open a successor ADR superseding this one; do NOT silently broaden the schema. Chrome Web Store reviews are a softer signal — referenced only when they corroborate a concrete GitHub issue, never on their own.

Revisit at the start of M2 planning regardless. If none of the abort triggers fired during M1, the ADR moves from `Proposed` to `Accepted` and from `Lifecycle: POC` to `Lifecycle: GA` at that point.
