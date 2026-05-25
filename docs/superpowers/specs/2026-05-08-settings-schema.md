# Settings Schema Spec

**Date:** 2026-05-08
**Status:** Approved
**Issue:** [#32 — Settings schema, storage, and migration](https://github.com/chriscantu/speedreader-chrome/issues/32)
**Milestone:** M1 (MVP parity)
**Scope:** Pin the persisted settings shape, validation, storage backend, migration hook, and the read/write/subscribe API. Sets the contract every other M1 feature reads from.

---

## Problem Statement

Every M1 feature reads from settings: WPM (#15), theme + font (#27, #28), overlay rendering (#19), the options page (#30), and the popup (#29). Without a versioned, validated settings contract there is no stable place for those features to land — each consumer would invent its own shape and drift. The Safari reference stores settings as ad-hoc keys; the Chrome port has the opportunity to ship one canonical schema with a migration path before the install base exists, while the cost of getting it wrong is still zero.

A settings schema is also where corrupt-data resilience pays off most: `chrome.storage.sync` can return partial payloads after a sync conflict, and a malformed payload on cold start would crash the service worker before any UI rendered.

## Constraints

- **MV3 service worker.** No persistent state in memory across worker wake cycles — settings must be re-read each cold start. The storage call is the cache.
- **Local-only.** No network beyond `chrome.storage.sync`'s built-in cross-device replication. No analytics on settings changes.
- **Solo-maintainer.** Migration machinery has to be cheap to reason about. One forward-only sequential chain, not a graph.
- **`src/core/` boundary.** Pure schema, defaults, and migrations live in `src/core/settings/` with no `chrome.*` imports. The `chrome.storage.sync` adapter lives in `src/chrome/settings/`. Keeps the core portable for a future shared-core extraction across Safari + Chrome.

## Decision

### Storage backend: `chrome.storage.sync`

Settings ride Chrome's signed-in-account sync so a user's WPM, theme, and font follow them across devices. Quotas to respect:

- 120 writes/minute, 1800 writes/hour
- ~1.8 KB/sec sustained
- 100 KB total per extension, 8 KB per item

The whole settings blob is one item well under 8 KB. The risk is write rate — slider-style controls in the options page can fire change events at 60 Hz. Mitigation: **300 ms trailing-edge debounce** on `saveSettings` (see API below).

**Reading position** (#48) explicitly stays on `chrome.storage.local`. Position updates are high-frequency and per-device; syncing them would burn quota and offers no cross-device value.

### Validation: Zod

[Zod](https://github.com/colinhacks/zod) (~12 KB minified) parses the raw value on every read. The cost buys first-install corrupt-data resilience: a partially-synced or hand-edited blob fails parsing and falls back to defaults instead of throwing in the service worker.

### Storage key

A single key: **`speedreader.settings`**. The schema version lives **inside the value** as a `version` field, never in the key. Rationale: the key stays stable forever; version-as-field means a v3 install reading a v1 blob can migrate in place without orphaning a `speedreader.settings.v1` key on every old device.

### Schema shape

Source of truth: `src/core/settings/schema.ts`. The Zod object is `SettingsSchemaV1` (the parser/validator); the inferred TypeScript type is `SettingsV1`. The two names are kept distinct so consumers that need the runtime parser and consumers that only need the static type don't share a symbol.

```ts
import { z } from 'zod';

export const SettingsSchemaV1 = z.object({
  version: z.literal(1),
  wpm: z.number().int().min(100).max(600).multipleOf(10),
  theme: z.enum(['system', 'light', 'dark', 'sepia', 'paper', 'cream', 'nord']),
  font: z.string(),
  fontSize: z.number().int().min(12).max(48),
  openDyslexic: z.boolean(),
  punctuationPacing: z.boolean(),
});

export type SettingsV1 = z.infer<typeof SettingsSchemaV1>;

export const CURRENT_VERSION = 1 as const;
```

Field notes:

- `wpm` — bounded to the documented Safari range, multiples of 10 to match slider granularity.
- `theme` accepts `system` plus six named palettes (`light`, `dark`, `sepia`, `paper`, `cream`, `nord`) — verified against the hi-fi mock CSS (`docs/design/Speed Reader Hi-Fi.html`, `[data-theme]` selectors). `system` follows `prefers-color-scheme` and resolves to `light` or `dark` at render time. The expansion past Safari's 3-theme baseline is intentional per parity-as-floor-not-ceiling; see `docs/design/RECONCILIATION.md` and the theme-expansion follow-up issue.
- `font` is a free string in v1; the curated enum lands with #28 and will be a v2 migration if it tightens.
- `openDyslexic` is the toggle for the bundled OpenDyslexic face; `font` and the toggle are independent so a user can have OpenDyslexic on as an override.
- `punctuationPacing` defaults on; tracks the Safari behaviour.

### Defaults

Source of truth: `src/core/settings/defaults.ts`.

```ts
export const DEFAULT_SETTINGS: SettingsV1 = {
  version: 1,
  wpm: 250,
  theme: 'system',
  font: 'system-ui',
  fontSize: 20,
  openDyslexic: false,
  punctuationPacing: true,
};
```

A single export consumed by **both** the first-install seed write **and** the options-page "reset to defaults" affordance — no duplicated literal, no drift.

### Migration strategy

Source of truth: `src/core/settings/migrations.ts`. Public entry point:

```ts
export function migrate(rawValue: unknown): SettingsV1;
```

Behavior:

- Non-object / null / array input → fresh copy of `DEFAULT_SETTINGS`. Never throws.
- Sequential migrators keyed by source version run forward to `CURRENT_VERSION`. v1 ships an identity hook for `0 → 1` purely to keep the composition path exercised in tests.
- After migrators run, the value is shallow-merged onto `DEFAULT_SETTINGS` (so a missing field acquires its default), then `SettingsSchemaV1.safeParse`'d.
- Parse failure logs a warning and returns a fresh copy of `DEFAULT_SETTINGS`. **Corrupt data never crashes the worker.**

Adding a v2 later: drop a migrator into the `MIGRATIONS` table keyed by `1`, bump `CURRENT_VERSION` in `schema.ts`, ship a new `SettingsSchemaV2`. The hook ships now so v2 lands cheap later.

#### Signature: one-arg is canonical (#66)

`migrate` takes a single `rawValue: unknown` argument. The migrator owns version
detection by reading `rawValue.version`; the sole caller (`loadSettings` in
`src/chrome/settings/storage.ts`) does not need to — and should not have to —
know the source version. A `fromVersion` second argument was considered and
explicitly rejected: it would split the contract across the call site and
duplicate the version-detection logic. If a second caller ever lands needing to
assert `fromVersion` (e.g. a future export/import flow that rejects
forward-incompat blobs), add an _optional_ second argument rather than
overloading; do not break the existing single-caller contract.

#### Missing-field repair (#67)

A shallow-merge `{ ...DEFAULT_SETTINGS, ...value, version: CURRENT_VERSION }`
runs immediately before `safeParse`. The merge is intentional forward-compat:

- A stored payload that is current-version but missing a field (e.g. a partial
  sync payload, or a schema revision that adds a non-required field) acquires
  the default for the missing field instead of failing validation.
- The merge is shallow, not deep — nested objects (none today, but possible in
  a future schema) are replaced wholesale, not merged. If a future revision
  introduces nested settings, the migration step is the place to deep-merge;
  the repair step stays shallow.
- The canonical pin is the test
  `'migrates v3 blob with missing field by filling defaults (explicit repair
behavior)'` in `src/core/settings/__tests__/migrations.test.ts`. A future
  policy change to reject-missing-fields instead of repair must update that
  test as an intentional surface.

### Read/write/subscribe API

Source of truth: `src/chrome/settings/storage.ts`. This is the only file in the project that imports `chrome.storage.*` for settings.

```ts
export async function loadSettings(): Promise<SettingsV1>;
export function saveSettings(partial: Partial<SettingsV1>): Promise<void>;
export function flushSettings(): Promise<void>;
export function subscribeSettings(listener: (s: SettingsV1) => void): () => void;
```

Behavior:

- `loadSettings` reads `speedreader.settings` from `chrome.storage.sync`. **On first install (`raw === undefined`) it seeds `DEFAULT_SETTINGS` and writes the canonical seed back** so the next read is a fast pass-through. It also writes back when migration reshapes the stored value (version bump or partial-payload repair). The seed write is unconditional on `raw === undefined` — there is no falsy short-circuit.
- `saveSettings(partial)` coalesces calls within a **300 ms trailing-edge** window into one write. Sliders that fire at 60 Hz produce one write, not 60. Each call returns a Promise that resolves when its containing flush completes.
- `subscribeSettings(listener)` wires `chrome.storage.onChanged`, filters to area `'sync'` and key `speedreader.settings`, runs the new value through `migrate`, and forwards. Live updates from a sibling tab, the options page, or a different signed-in device all flow through the same path. Returns an unsubscribe function.

#### Debounce window resolution contract (#68)

`saveSettings` returns a Promise tied to the **current debounce window**, not
to a unique underlying `set`:

- All `saveSettings` calls that arrive within one 300 ms window share the
  resolution of that window's single `chrome.storage.sync.set`. Their Promises
  resolve (or reject) together when that set completes.
- A late `saveSettings` call that lands **during an in-flight flush** (after
  the timer fired but before `chrome.storage.sync.set` completed) does NOT
  join the in-flight write — its window's pending state was already cleared at
  the top of `flushPendingSave`. The late call starts a fresh 300 ms window
  and resolves on a different, later set. Two distinct resolutions, two
  distinct underlying sets.
- Consumers that need to deterministically `await` the persisted write (e.g.
  an options-page "Save" button followed by navigation) should call
  `flushSettings()` after their last `saveSettings` to collapse the pending
  window into an immediate flush.

`flushSettings()` semantics:

- No pending save (no timer scheduled, no buffered partial) → resolves
  immediately.
- Pending timer scheduled → cancels the timer and calls the flush path
  synchronously (no `setTimeout`). Returns a Promise that resolves when the
  underlying `chrome.storage.sync.set` completes. The pending state is cleared
  at the top of the flush, so any `saveSettings` call that lands while the
  forced flush is in-flight starts a fresh window — there is no double-flush
  path. Callers that need to await that subsequent window must call
  `flushSettings()` again.

### File layout

```
src/core/settings/
  schema.ts        SettingsSchemaV1, SettingsV1, CURRENT_VERSION
  defaults.ts      DEFAULT_SETTINGS
  migrations.ts    migrate(rawValue)
  index.ts         barrel
src/chrome/settings/
  storage.ts       loadSettings, saveSettings, subscribeSettings
```

Boundary contract: `src/core/settings/**` has zero `chrome.*` imports. The adapter does not re-export the schema; consumers import core directly.

## Visual reference

- `docs/design/Speed Reader Hi-Fi.html` — surface `04 Options` exposes settings beyond v1's surface: `chunk size` (1/2/3, tracked under #51, M2), `focus marker` (line/bold/underline, no existing issue, post-M1), `accent color` swatches (no existing issue, post-M1), `slow down long words` (no existing issue, post-M1), `auto-detect articles` and `only on selection` toggles. The v1 schema does NOT add fields for these; they land via a v2 migration when their feature issues ship. The migration hook (`migrate(rawValue)`) and the `version`-as-field design make that drop-in.
- `docs/design/screens/popup-hifi.png` shows the popup's `12 saved` and `Recent` list — these are persisted state from #48 (reading position, M2) and #49 (reading history, M2), NOT settings; they live on `chrome.storage.local` and are out of scope for this schema.

## Out of Scope

- **Reading position (#48)** — lands on `chrome.storage.local`, separate spec.
- **Settings UI (#30)** — the options page consumes this contract; layout is its own spec.
- **Curated font enum (#28)** — v1 keeps `font: string`; tightening to an enum is a v2 migration.
- **Export / import** — post-M1.

## Acceptance Criteria

1. `SettingsSchemaV1.parse` accepts a valid v1 blob with all fields at defaults.
2. `migrate({ version: 0 })` returns a value satisfying `SettingsSchemaV1` with `version === 1`.
3. `migrate(undefined)`, `migrate(null)`, `migrate('garbage')`, and `migrate([])` each return a value deep-equal to `DEFAULT_SETTINGS` and never throw.
4. `migrate({ version: 1, wpm: 'not-a-number' })` falls back to `DEFAULT_SETTINGS` (logs warning, no throw).
5. `loadSettings` on a fresh profile (`chrome.storage.sync.get` resolves to `{}`) writes `DEFAULT_SETTINGS` back under `speedreader.settings` and resolves to `DEFAULT_SETTINGS`.
6. `saveSettings({ wpm: 300 })` called 10 times in a 100 ms window results in exactly one `chrome.storage.sync.set` call ~300 ms after the last invocation.
7. `subscribeSettings` fires when a sibling context writes to `speedreader.settings` on the `sync` area, and does not fire for unrelated keys or the `local` area.
8. Grep confirms `src/core/settings/**/*.ts` contains zero `chrome.` references.
