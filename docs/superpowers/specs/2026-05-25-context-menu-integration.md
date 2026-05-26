# Context-Menu Integration Spec

**Date:** 2026-05-25
**Status:** Proposed
**Issue:** [#72 — Context-menu integration (right-click → SpeedReader scoped modal)](https://github.com/chriscantu/speedreader-chrome/issues/72)
**Milestone:** M1 (MVP parity)
**Scope:** Pin the surface-specific behavior of the `chrome.contextMenus` activation source — submenu structure, menu-item lifecycle, the `activate-reader` RPC overrides envelope, toggle persistence semantics, last-used-speed source, the scoped mini-modal state machine, and `chrome.contextMenus.update` discipline. Composes on top of the SW-lifecycle / activation-dispatch spec; does not modify it.

---

## Problem Statement

The activation-dispatch spec pins the listener registration, restricted-URL guard, and `contextMenu`-source normalization. It leaves the surface-specific holes #72 covers unspecified: which menu items exist, where last-used speed reads from, whether toggle clicks persist, and how the scoped mini-modal swaps to full-article scope without a fresh activation round-trip. This spec fills those holes so the implementation PR has a single source of truth and the `activate-reader` payload extension is forward-compatible with the popup-source and command-source callers that already exist on disk.

## Constraints

- All MV3, lazy-injection, `src/core/` boundary, sender-provenance, and structured-clone constraints from [`2026-05-22-sw-lifecycle-activation.md`](2026-05-22-sw-lifecycle-activation.md) §Constraints apply by reference. Not restated here.
- Backwards-compatible with the existing `dispatchActivation` funnel and `intentToActivatePayload` in `src/chrome/background/activation/dispatch.ts`. The popup-source (`scope: 'full'`) and command-source (`scope: 'full'`) callers MUST continue to work without modification.
- No new permissions. `contextMenus` is already declared per the activation spec; this spec adds zero host or API permissions.
- Selection content is page-controlled — the activation spec's §"Context-Menu Selection Trust" rules are load-bearing here.

## Composes vs Supersedes

This spec **composes** with — and does **NOT** supersede — the following already-merged surfaces:

- [`2026-05-22-sw-lifecycle-activation.md`](2026-05-22-sw-lifecycle-activation.md) §"Listener Registration Discipline" (the `chrome.contextMenus.onClicked` listener registration), §"Unified Activation Dispatch" (the `dispatchActivation` funnel), §"Restricted-URL Guard" (call site #2 — `documentUrlPatterns`), §"Context-Menu Selection Trust" (the CS re-reads selection; `info.selectionText` is a boolean signal only).
- [`2026-05-08-messaging-contract.md`](2026-05-08-messaging-contract.md) §"Message-type Registry" (the `activate-reader` entry; this spec extends its payload shape, additively).
- [`2026-05-08-settings-schema.md`](2026-05-08-settings-schema.md) §"Schema shape" + §"Read/write/subscribe API" (`saveSettings` debounce, `subscribeSettings` broadcast; this spec adds three persisted fields via a V3 → V4 migration).

**Implementation dependencies** (must land before this spec's implementation PR):

- `subscribeSettings` is specified by [`2026-05-08-settings-schema.md`](2026-05-08-settings-schema.md) §"Read/write/subscribe API" but not yet on disk. Expected file: `src/core/settings/index.ts` (re-exports the subscribe API alongside `loadSettings`/`saveSettings`). Expected shape: `subscribeSettings(handler: (next: SettingsV4) => void): () => void` — debounced broadcast on `chrome.storage.onChanged` (300ms debounce per the existing `saveSettings` contract), unsubscribe handle returned. Tracked under the settings-schema spec's implementation backlog (no dedicated issue yet — file one when AC #6/#7 enter implementation). Implementation of this spec blocks on that API shipping.
- V3 → V4 settings-schema migration (adds `contextLine`, `startFromWordOne`, `lastUsedWpm`). Per OQ-1 resolution, persistent semantics are locked. The implementer may ship the migration in this spec's implementation PR OR split into a sibling settings-schema PR that lands first — both paths are acceptable; the choice is implementation-tier, not spec-tier.
- [`src/chrome/background/activation/types.ts`](../../../src/chrome/background/activation/types.ts) (`ContextMenuActivationIntent` already carries the `selectionText?: string` field) and [`dispatch.ts`](../../../src/chrome/background/activation/dispatch.ts) (`intentToActivatePayload` is extended, not replaced).

## Submenu Structure

`chrome.contextMenus.create` registers a parent item plus six children. Parent is the root entry visible when text is selected; children fan out underneath as a native submenu.

### Item IDs (stable strings)

IDs are versioned (`v1`) so a future shape revision can co-exist with old persisted state, and so the click handler can dispatch via an exhaustive `switch` on a literal union (typo in a switch arm = TS error, not a silent dead branch):

```ts
export type CtxMenuItemId =
  | 'speedreader.ctx.parent.v1'
  | 'speedreader.ctx.lastUsed.v1'           // top child; title rewritten on update
  | 'speedreader.ctx.preset.300.v1'
  | 'speedreader.ctx.preset.500.v1'
  | 'speedreader.ctx.preset.custom.v1'
  | 'speedreader.ctx.separator.v1'          // visual divider; Chrome dispatches no click event
  | 'speedreader.ctx.toggle.showContext.v1'
  | 'speedreader.ctx.toggle.startFromWord1.v1';
```

`ContextMenuActivationIntent.menuItemId` (see §"Activation Payload Extension" below) narrows from `string` to `CtxMenuItemId`. Click-handler dispatch uses `case 'speedreader.ctx.preset.300.v1':` etc., with a `default: const _exhaust: never = id` arm to enforce coverage at compile time. The separator literal is included in the union for type-symmetry with the factory output; the listener handles it with an explicit no-op `case` (Chrome never dispatches click events on separator items, so reaching this arm is structurally unreachable — the `case` exists only to keep the switch exhaustive).

Separator between the speed items and the toggle items (`type: 'separator'`; uses the stable `speedreader.ctx.separator.v1` ID above).

### Generation logic

Items are created **once per SW wake** in `ensureContextMenu()`, the same function the activation spec's `chrome.runtime.onInstalled` and `onStartup` listeners already invoke. The shape is data-driven:

```ts
// `CtxContext` mirrors the subset of chrome.contextMenus.ContextType the
// factory uses — local literal union keeps the pure factory free of any
// `chrome.*` type imports (per §File Layout boundary discipline). Widen
// only when a new item actually needs another context.
type CtxContext = 'selection';

interface CtxItemSpec {
  id: CtxMenuItemId;                                   // includes separator literal (see CtxMenuItemId)
  title: string;
  type?: 'normal' | 'separator' | 'checkbox';
  parentId?: CtxMenuItemId;
  contexts: readonly CtxContext[];
  documentUrlPatterns: readonly string[];
  checked?: boolean;
}
```

The `chrome.*`-typed coercion (to `chrome.contextMenus.CreateProperties`) happens in the `install.ts` adapter, NOT in `factory.ts`. `readonly` on the array fields is a free invariant — factory output is treated as immutable downstream.

`buildMenuItems(settings: SettingsV4): CtxItemSpec[]` lives in `src/chrome/background/context-menu/factory.ts` (no `chrome.*` calls — pure list builder). `installMenuItems(items)` in `src/chrome/background/context-menu/install.ts` is the Chrome adapter that calls `chrome.contextMenus.removeAll()` then `chrome.contextMenus.create()` per spec. `SettingsV4` is the post-migration shape introduced by §"Settings schema additions" below (current trunk is `SettingsV3`; this spec's V3 → V4 migration adds `lastUsedWpm`, `contextLine`, `startFromWordOne`).

The factory consumes the current `SettingsV4` (read via `loadSettings()`) to render:

- `lastUsed` title — `"{wpm} wpm · last used"`, reading `settings.lastUsedWpm`.
- `toggle.showContext` `checked` — reflects `settings.contextLine` (new field; see §Toggle Persistence).
- `toggle.startFromWord1` `checked` — reflects `settings.startFromWordOne` (new field).
- Preset items show plain titles (`"300 wpm"`, `"500 wpm"`, `"Custom…"`).

### "Custom…" behavior

Clicking `Custom…` opens the options page focused on the WPM slider via `chrome.runtime.openOptionsPage()`. It does **not** open the popup (popups have a stricter rendering budget and no slider component for an arbitrary WPM input). It does **not** dispatch an activation — the click is a navigation, not a read trigger. Rationale: a "type a number" UX inside a context-menu click is awkward and out of scope for M1; opening Options keeps the choice surface in one place and lets the user pick their custom default once. A popup-hosted WPM slider depends on issue #30 (popup polish) and is not scheduled for M1, which is why Options is the right destination today.

### Frame Provenance

The `chrome.contextMenus.onClicked` listener inspects `info.frameId`. If `info.frameId !== 0`, the listener refuses activation — no `dispatchActivation` call — and surfaces a one-line user-visible status: `"Selection inside embedded frame; right-click the page directly"`. Rationale: an iframe selection passes the menu-show predicate (`contexts: ['selection']` matches the iframe), but the CS re-reads `getSelection()` in the top frame and silently falls back to full-article. The benign failure mode is confusing; the hostile variant is a third-party iframe inducing a parent-page extract the user didn't intend. Refusing at the listener seam is the cheapest place to enforce the top-frame invariant.

## Activation Payload Extension

The existing `ActivateReaderMessage` shape (per `dispatch.ts`):

```ts
interface ActivateReaderMessage {
  type: 'activate-reader';
  scope: 'selection' | 'full';
}
```

is extended **additively** to:

```ts
import type { Overrides } from '../../../core/messaging/validate';

interface ActivateReaderMessage {
  type: 'activate-reader';
  scope: 'selection' | 'full';
  /**
   * Per-activation overrides supplied by the context-menu source. The
   * CS applies these as one-shot deltas to the live settings snapshot
   * for THIS activation only. Persistence to settings (if any) happens
   * SW-side; the CS treats overrides as ephemeral.
   *
   * Absent / undefined → no overrides; CS uses live settings.
   * Present → CS shallow-merges over the live settings snapshot it
   *   already loads on activation. Unspecified fields use settings.
   *
   * `Overrides` is Zod-derived from `SettingsSchemaV3` constraints so the
   * wire-type and the bounds-validator share the same shape — see
   * §"Activation Payload Extension — Receive-Side Validation".
   */
  overrides?: Overrides;
}
```

**Backwards-compat:** `overrides` is optional. The popup-source and command-source callers omit it and observe identical behavior to today. The CS-side handler `if (msg.overrides) applyOverrides(snapshot, msg.overrides)` is a no-op for non-context-menu activations.

**Why a single nested object** rather than three top-level optionals: keeps the seam visible — every override field is in one place, easy to add a future `theme` or `fontSize` override without flattening the message type further. Also keeps the message-type registry table in [`2026-05-08-messaging-contract.md`](2026-05-08-messaging-contract.md) concise (one optional field, not three).

**Why the funnel — not the listener — owns the override extraction:** `dispatchActivation` already inspects `intent.source` exactly once in `intentToActivatePayload`. Adding override extraction in the same seam keeps the source-blind invariant intact for the rest of the pipeline. The listener stays a thin shim that produces an `ActivationIntent`; the funnel decorates the payload.

`ContextMenuActivationIntent` is extended in `src/chrome/background/activation/types.ts`:

```ts
import type { Overrides } from '../../../core/messaging/validate';
import type { CtxMenuItemId } from '../context-menu/factory';

export interface ContextMenuActivationIntent {
  source: 'contextMenu';
  tabId: number;
  selectionText?: string;
  menuItemId: CtxMenuItemId;       // narrowed from string — exhaustive switch in listener
  overrides?: Overrides;
}
```

The listener (`src/chrome/background/context-menu/listener.ts`) reads `info.menuItemId` and produces the intent. The funnel's `intentToActivatePayload` copies `overrides` through to the wire payload.

### Activation Payload Extension — Receive-Side Validation

The foundation sender-provenance gate (`isPopupShape` at `src/chrome/background/messaging/on-message.ts:77`, plus the `sender.id === chrome.runtime.id` check at `on-message.ts:104`) covers SW-inbound messages only. It does NOT validate the SW→CS direction — where `overrides` actually rides — and it cannot prevent a same-extension surface (anything that passes the `sender.id === chrome.runtime.id` provenance check) from calling `chrome.tabs.sendMessage(tabId, { type: 'activate-reader', overrides: { wpm: 999999 } })` and reaching the engine's `setInterval` cadence before any value check fires.

**Two-layer defense:**

1. **Pure bounds validator** — new file `src/core/messaging/validate.ts` (pure, no `chrome.*` per CLAUDE.md core boundary). Exports two named functions plus the shared `Overrides` type derived from a Zod schema that reuses existing settings constraints:

   ```ts
   import { SettingsSchemaV4 } from '../settings/schema';

   // `.strip()` (Zod default) silently drops unknown keys — chosen over
   // `.strict()` so a future sender that adds an `overrides.theme` field
   // doesn't hard-reject the message on older clients (graceful
   // forward-compat). Forgery defense is provided by sender-provenance
   // at `src/chrome/background/messaging/on-message.ts:104`, not by
   // unknown-key strictness here.
   export const OverridesSchema = z.object({
     wpm: SettingsSchemaV4.shape.wpm.optional(),     // int [100,600], multipleOf(10)
     showContext: z.boolean().optional(),
     startFromWordOne: z.boolean().optional(),
   });
   export type Overrides = z.infer<typeof OverridesSchema>;

   // Shape gate. Returns parsed Overrides on success; null if `raw` is
   // not an object-shaped overrides payload at all (e.g., string, array,
   // null). Per-field bounds are NOT enforced here.
   export function validateOverrides(raw: unknown): Overrides | null;

   // Per-field bounds gate. Walks an already-shape-valid Overrides and
   // drops any field that fails its bound (wpm out of [100,600], non-int,
   // non-multipleOf-10; boolean fields that aren't strictly boolean).
   // Returns the remaining valid subset (possibly empty).
   export function pickValidOverrides(raw: Overrides): Overrides;
   ```

   Single source of truth — the `wpm` constraint lives in `SettingsSchemaV4` already and is reused by reference, not duplicated. The wire-payload type and the validator share the same shape; future field additions land in one place.

2. **CS-side receive composition (pipeline order, pinned)** — `applyOverrides(snapshot, raw)` runs the two validators in sequence:

   ```ts
   const shapeOk = validateOverrides(raw);     // null on shape failure
   if (shapeOk === null) return snapshot;       // no overrides applied
   const valid = pickValidOverrides(shapeOk);   // drops out-of-bound fields
   return { ...snapshot, ...valid };            // shallow merge
   ```

   `validateOverrides` is the entry guard (shape gate); `pickValidOverrides` is the bounds gate. **The activation is NOT rejected on a malformed overrides field** — a single bad field falls back to snapshot defaults; the read trigger proceeds. A non-object `overrides` payload (the hostile shape case) returns `null` at the shape gate and the CS applies zero overrides. Empty object `overrides: {}` is treated as no-op (parses successfully, picks zero fields, shallow merge is no-op).

The `ActivateReaderMessage.overrides` type on the wire becomes `Overrides | undefined`, sourced from the same Zod-derived type as the validator — eliminating the drift class where the type and the bounds-check go out of sync.

## Toggle Persistence Semantics

> **Locked (2026-05-26) — persistent settings writes.** OQ-1 resolved; see §"Open Questions" for spike result and Chrome-side reasoning. Safari has no context-menu surface, so parity is moot; persistent semantics chosen on Safari-toggle-pattern precedent + hi-fi mock visuals + user mental model.

The two toggle items (`Show context line`, `Start from word 1`) are **persistent settings writes**, not per-activation toggles. Picked over per-activation-only because:

- Submenu UX reads as "set my default" — checkbox state visible on every right-click is incoherent if the value never sticks.
- A user who wants context-line ON expects to set it once and forget. A per-activation toggle defeats that.
- The popup and options page already expose the same toggles per the hi-fi mock; settings is the canonical surface.

**Wire model:** clicking `Show context line` does NOT dispatch an activation. It calls `saveSettings({ contextLine: !current })` and returns. The submenu closes (Chrome default behavior on click); on next open, the new `checked` state is read from settings via the `subscribeSettings` broadcast that fires `installMenuItems` again — see §Menu Update Discipline.

**Per-activation overrides come from speed clicks only.** The preset speed items (`300`, `500`, `lastUsed`) carry a `wpm` override on the resulting `activate-reader` payload AND update `settings.lastUsedWpm` for future submenu rendering. The toggle items do NOT carry overrides — they mutate settings directly and produce no activation.

This means the `overrides` field on the wire is, in practice, populated only with `wpm` from the preset clicks. `showContext` and `startFromWordOne` are present in the type to keep the door open for a future "one-shot override" UX (e.g., a popup checkbox that says "for this read only"); shipping them in the typed payload now avoids a v2 wire migration later.

### Settings schema additions

Three new fields land on a new `SettingsV4` via a V3 → V4 migration. Current trunk is `SettingsSchemaV3` (per `src/core/settings/schema.ts`, shipped in #115); this spec introduces `SettingsSchemaV4` as the next version bump. The V4 schema extends V3 with the three fields below:

```ts
contextLine: z.boolean(),          // default: false (matches Safari behavior)
startFromWordOne: z.boolean(),     // default: false
lastUsedWpm: z.number().int().min(100).max(600).multipleOf(10),  // default: wpm
```

`lastUsedWpm` defaults to the current `wpm` value on migration; subsequent activations write it on every preset-speed click. The settings-schema spec's `migrate(rawValue)` hook handles the version bump per its existing contract.

## Last-Used Speed Source

`settings.lastUsedWpm` — `chrome.storage.sync`, persistent across sessions, synced across devices.

**Why settings, not `chrome.storage.session`:**

- Session-scoped state evaporates on SW idle-kill (every ~30s of idle in MV3). A user who reads at 420 wpm at 9am and right-clicks at 9:05 to start another read would see "250 wpm — last used" — confusing and wrong.
- Cross-device sync is a feature, not a cost. The user's "last used" should follow them between laptop and desktop the way `wpm` already does.
- The write-rate cost is bounded: at most one write per activation (vs the 60Hz slider concern that motivated the 300ms debounce). Inside the existing debounce budget.

**Bootstrapping:** on first install, `lastUsedWpm === settings.wpm` (250 default). On the first preset click, `lastUsedWpm` is updated to the clicked value. The `lastUsed` submenu title rebuilds via the standard subscribe-broadcast → `installMenuItems` path.

## Scoped Mini-Modal Contract

When `scope: 'selection'`, the CS renders the overlay in **scoped mode**: header reads `SELECTION · N words · ~M sec`, body shows the selection text, footer exposes a `← Full article` button. When `scope: 'full'`, the CS renders the standard full-article overlay.

### Distinguishing scoped from full

The CS receives `scope` directly on the `activate-reader` payload. The reader instance carries an internal `currentScope: 'selection' | 'full'` state; the overlay reads it for header rendering and footer-button visibility. No additional wire field needed.

### Focus and Announcement on Open

The overlay wrapper is `<div role="dialog" aria-modal="true" aria-labelledby="sr-scope-header">`. The scope-header element carries `id="sr-scope-header"` so AT users hear the labelled-by value (`"SELECTION · N words · ~M sec"`) on mount. Initial focus lands on the play/pause button within one `requestAnimationFrame` of overlay mount; the CS captures `document.activeElement` immediately before mount and restores focus there on overlay close.

This applies to all activation sources, not only `contextMenu` — making the mount-side a11y contract uniform avoids a per-source branch in the overlay code. The reason it's pinned in this spec is that the context-menu source is the path that introduced focus-stranding risk (native menu close → page body → injected overlay).

### Reduced motion

Dialog mount and the scope-swap transition (see below) respect `prefers-reduced-motion: reduce`. Under that media query, no transition animations run — state changes happen instantly (no fade-in, no header crossfade on swap).

### Forced colors

All modal text — header, body, footer button labels, the swap subtitle — must render using `CanvasText` on `Canvas` system colors under `forced-colors: active`. The scope-header subtitle in particular must remain readable; we don't paint it in a custom shade that disappears in high-contrast mode.

### "Expand to full" — no fresh round-trip

The `← Full article` button does NOT close the modal and does NOT re-fire activation. The button click:

1. Calls `extract()` for the full article — cache-hit if extraction has already run for this `location.href` (per the article-extraction spec); otherwise lazy first-extraction with the latency window noted in §Self-identified Weaknesses (50–200ms on long articles). The modal renders a paused-spinner state during the lazy path; see §"Loading state" below.
2. Replaces the engine's token list with `fullArticle.tokens`.
3. Sets `currentScope = 'full'`, `positionIndex = 0`, engine `paused`.
4. Rewrites the header; hides the `← Full article` button.

**Loading state (lazy first-extraction only):** if step 1 misses the cache, the modal header shows `"Loading full article…"` and the play/pause control disables until extraction resolves. On resolve, the announcement fires per §"Focus and Announcement on Swap". On extraction failure, the modal surfaces the article-extraction spec's error state and the `← Full article` button is restored so the user can retry.

**Swap discards selection state; post-swap is always `paused` with `positionIndex = 0`. User resumes manually.** Mapping a selection position onto the full article requires a substring search that's brittle under whitespace / punctuation variation, and preserving a play/pause state across a content swap that re-anchors to word 0 is a footgun (the user expected to resume mid-selection, lands at the article top). The simpler discard-and-pause path satisfies the AC ("swap scope without closing") and is the obvious-correct behavior.

### Focus and Announcement on Swap

A polite `aria-live="polite"` region inside the dialog announces `"Expanded to full article. Restarting from word 1 of N. Paused."` (where `N` is the full-article token count). Focus moves to the play/pause control on the swap so the user has a single keystroke to resume. The `← Full article` button is removed from the tab order in the same frame.

### Why no SW round-trip

The SW does not own extracted content (per the messaging-contract spec's ownership table — extraction lives in the CS). Routing the swap through the SW would re-extract or re-cache for no benefit. A pure CS-internal state transition is cheaper and matches the existing data flow.

### Reverse direction (full → selection)

Out of scope for M1. Once a user expands to full, the selection scope is discarded. A user who wants the selection back re-selects and re-right-clicks.

## Menu Update Discipline

`chrome.contextMenus.update` is called from exactly two places:

1. **`subscribeSettings` listener** — when `settings.lastUsedWpm`, `settings.contextLine`, or `settings.startFromWordOne` change, the listener calls `installMenuItems(buildMenuItems(newSettings))`. Implementation uses `chrome.contextMenus.update(id, partial)` per item rather than `removeAll` + `create` to avoid a brief flicker if the user has the menu open mid-update. (Chrome closes the open menu on `removeAll`; `update` does not.)
2. **`onInstalled` / `onStartup`** — recreate the full menu structure on SW boot via `removeAll` + `create`. Per the activation spec, menu item IDs are never persisted across browser sessions.

**Not called on activation completion.** Activation completion does not change menu state (the `lastUsed` value is updated via `saveSettings({ lastUsedWpm })` → `subscribeSettings` → path #1). One write, one rebroadcast, one menu update — no menu writes from the activation funnel itself.

**Race window:** the SW may serve a click before `installMenuItems` finishes after a wake. See §Failure Modes for the stale-label window.

## Failure Modes

### Stale `lastUsed` label after SW wake

The submenu may briefly show a stale `420 wpm — last used` after SW wake, before `onStartup` → `loadSettings` → `installMenuItems` completes (wall-clock duration depends on SW startup latency; not asserted). A click during this window dispatches with the old `lastUsedWpm`. **Accepted:** the user sees their previous-session value and that value is still the most recent persisted truth — the only way it's "wrong" is if a sibling device synced a newer value in the window between Chrome restart and first interaction, which is benign. We do NOT block clicks on menu-update completion; that would introduce an unresponsive period for every right-click.

### Two activation surfaces collide (#34 hotkey fires while submenu is open)

`chrome.commands.onCommand` fires while the user has the submenu open. Both dispatches enter the funnel; both reach `ensureContentScript`. The activation spec's idempotent-injection contract (in-flight promise dedup + window sentinel) handles this — exactly one `executeScript` runs, and the second `activate-reader` arrives at a CS that already exists. **The second activation wins** for scope (full from the hotkey overrides selection from the menu) because they arrive in order and the CS treats the second `activate-reader` as a re-render. This is acceptable: hotkey-while-menu-open is a rare collision and the user explicitly chose to invoke the hotkey.

### Mini-modal swap on a restricted target

Not reachable — `documentUrlPatterns` prevents the menu from appearing on restricted URLs (per activation spec §Restricted-URL Guard call site #2). The selection-context only fires on http(s) pages.

### Selection cleared between menu open and click

User selects text, opens menu, then clicks elsewhere on the page (clearing the selection), then clicks a menu item. The CS-side selection re-read returns empty. **Behavior:** the CS renders full-article mode (`currentScope = 'full'` from the start; no `← Full article` button rendered) AND emits a polite `aria-live` status — `"No selection detected. Reading full article instead."` — AND shows a visible subtitle in the modal header so sighted users see the substitution too. A silent swap is invisible to keyboard / AT users who invoked from the menu's primary path; the announcement closes that WCAG 3.2.5 / 4.1.3 gap.

### Toggle click while reading

User has the reader open and clicks `Show context line` in the submenu. The settings write fires; `subscribeSettings` broadcasts; the CS receives the broadcast (per the messaging-contract spec's `settings-changed` path). The active reader re-renders with context-line ON for the next word transition. No mid-word disruption.

### `chrome.contextMenus.update` rate limiting

Chrome does not document a `contextMenus.update` rate limit, but the settings-schema spec's 300ms debounce already coalesces rapid toggle clicks. The listener path is naturally rate-limited.

## Acceptance Criteria

Mirrors and expands the issue checkboxes:

1. `chrome.contextMenus.create` registers a top-level `SpeedReader` parent (`speedreader.ctx.parent.v1`) with `contexts: ['selection']` and `documentUrlPatterns: ['http://*/*', 'https://*/*']`. Verified by `sinon-chrome` integration test.
2. Submenu items are created with the v1 IDs above: `lastUsed`, `preset.300`, `preset.500`, `preset.custom`, separator, `toggle.showContext`, `toggle.startFromWord1`.
3. `lastUsed` title renders as `"{settings.lastUsedWpm} wpm · last used"` on every menu install.
4. Clicking a preset speed item dispatches `activate-reader` with `scope: 'selection'` and `overrides: { wpm: <preset> }`. Verified by funnel unit test.
5. Clicking `Custom…` calls `chrome.runtime.openOptionsPage()` and does NOT dispatch an activation.
6. Clicking `Show context line` calls `saveSettings({ contextLine: !current })`, does NOT dispatch an activation, and refreshes the menu's `checked` state via the `subscribeSettings` path within the 300ms debounce window plus one rendering tick.
7. `Start from word 1` toggle behaves identically to `Show context line` against the corresponding field.
8. `activate-reader` payload extension is backwards-compatible: command-source and popup-source dispatches produce payloads with `overrides === undefined`; existing CS handler tests pass without modification.
9. Settings schema V3 → V4 migration: `migrate({ version: 3, ...legacy })` returns a V4 blob with `contextLine: false`, `startFromWordOne: false`, `lastUsedWpm: legacy.wpm`.
10. Scoped mini-modal renders `SELECTION · N words · ~M sec` header for `scope: 'selection'` activations; the `← Full article` button is present only in scoped mode.
11. Clicking `← Full article` swaps the reader to full-article scope without closing the overlay, sets engine state to `paused`, resets `positionIndex` to 0, removes the button, and emits the polite live-region announcement (see §"Focus and Announcement on Swap").
12. Restricted-page guard: no menu items appear on `chrome://settings`; verified by manual smoke test (the runtime guard is already covered by the activation spec AC #5).
13. Stale-label race: on `onStartup`, `loadSettings` resolves before `installMenuItems` is invoked; once installed, the menu reflects the persisted `lastUsedWpm`, never an older or default value. The brief stale-label window before installation completes is documented in §Failure Modes (wall-clock duration depends on SW startup latency and is not asserted in tests).
14. **#34 hotkey vs contextMenu collision test exists and passes** — `src/chrome/background/activation/__tests__/collision.test.ts` asserts exactly one `executeScript` call, both `activate-reader` messages arrive in dispatch order, and the second message's scope / overrides cleanly replace the first overlay (no double-extraction, no zombie pause-state). Gates OQ-2 and the move to Accepted.
15. **Empty-selection fallback** emits the polite live-region status `"No selection detected. Reading full article instead."` and renders full-article scope with a visible subtitle in the modal header.
16. **Scoped mini-modal mount** — activation from any source produces an overlay with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="sr-scope-header"`, focus on the play/pause control within one rAF of mount.
17. **Override bounds-check** — a forged `activate-reader` with `overrides.wpm = 999999` is dropped by `pickValidOverrides` (the out-of-bounds field is removed; remaining valid fields, if any, are applied); the engine uses the settings default for `wpm`. A non-object `overrides` payload is rejected by `validateOverrides` (whole-payload reject); CS proceeds with snapshot defaults.
18. **Frame provenance** — right-click + menu-click inside an `<iframe>` (`info.frameId !== 0`) produces no activation; the user-visible status `"Selection inside embedded frame; right-click the page directly"` is surfaced.
19. **Top-level listener registration** — `chrome.contextMenus.onClicked.addListener` is registered top-level synchronously in `src/chrome/background/context-menu/register.ts`, imported from `src/chrome/background/index.ts` before any `await`, per the foundation spec §"Listener Registration Discipline". Verified by `register.test.ts` (asserting registration completes synchronously on module load) and matches the `commands/register.ts` pattern.

## Test Surface

Unit (Vitest, pure):

- `src/chrome/background/context-menu/__tests__/factory.test.ts` — `buildMenuItems(settings)` returns the expected list for default settings, for each toggle-checked permutation, and for `lastUsedWpm ∈ {undefined, 300, 500, 420 (custom), 100 (lower bound), 600 (upper bound)}`. Asserts no preset-vs-lastUsed title collision when `lastUsedWpm` exactly equals a preset value.
- `src/core/settings/__tests__/migrations.test.ts` — V3 → V4 migration adds `contextLine`, `startFromWordOne`, `lastUsedWpm`; existing prior-version / corrupt-data tests continue to pass.
- `src/chrome/background/activation/__tests__/dispatch.test.ts` — `intentToActivatePayload` produces `overrides` on `contextMenu` source when `menuItemId` matches a preset speed; omits `overrides` for `popup` and `command` sources.
- `src/core/messaging/__tests__/validate-overrides.test.ts` — `validateOverrides(raw)` returns the parsed `Overrides` for in-bounds inputs (`100`, `300`, `600`, `multipleOf(10)`) and `null` for non-object or shape-violating payloads. `pickValidOverrides(raw)` drops out-of-bounds (`50`, `601`, `999999`), non-integer (`300.5`), wrong-type (`"300"`), or non-boolean `showContext` / `startFromWordOne` fields and returns the remaining valid subset. `applyOverrides(snapshot, raw)` composes the two: shape-reject → snapshot defaults; field-drop → partial override with snapshot fallback per dropped field.
- `src/core/reader/__tests__/scope-swap.test.ts` — after `← Full article` click, asserts `currentScope === 'full'`, engine `paused`, `positionIndex === 0`, footer button removed, live-region status emitted with the swap announcement text.

Integration (Vitest + `sinon-chrome`):

- `src/chrome/background/context-menu/__tests__/install.test.ts` — four explicit cases for `installMenuItems` discipline:
  - (a) **initial install**: `chrome.contextMenus.removeAll` MUST precede `chrome.contextMenus.create` calls.
  - (b) **`lastUsedWpm` change via `subscribeSettings`**: calls `chrome.contextMenus.update` and does NOT call `removeAll` + `create`.
  - (c) **`settings.contextLine` change**: calls `chrome.contextMenus.update` only on the `toggle.showContext` item; no other items mutated.
  - (d) **negative invariant**: the subscribe path NEVER calls `chrome.contextMenus.removeAll` (regression guard against the menu-flicker class).
  - (e) **stale-label race ordering**: `loadSettings` resolves before `installMenuItems` is invoked on `onStartup` — pins the AC #13 invariant.
- `src/chrome/background/context-menu/__tests__/listener.test.ts` — `chrome.contextMenus.onClicked` with each `menuItemId` produces the expected dispatch (preset → activation; toggle → settings write, no activation; custom → `openOptionsPage`). Includes the `info.frameId !== 0` refusal case. Switch on `menuItemId` is exhaustive over `CtxMenuItemId` (verified by a `never`-arm test that exercises every literal).
- `src/chrome/background/context-menu/__tests__/register.test.ts` — module-load side effect registers `chrome.contextMenus.onClicked.addListener` synchronously, before any `await`. Pins AC #19 (foundation listener-registration discipline).
- `src/chrome/background/activation/__tests__/restricted-menu.test.ts` — on a Web Store URL (matched by `RESTRICTED_HOSTS`), the menu shows (`documentUrlPatterns` permits) but `dispatchActivation` returns a `restricted-page` Result; no engine spin-up.
- `src/chrome/background/activation/__tests__/collision.test.ts` — #34 hotkey fires while submenu is open: asserts (a) exactly one `chrome.scripting.executeScript` call across both dispatches; (b) both `activate-reader` messages arrive in dispatch order; (c) the second message's scope / overrides cleanly replace the first overlay (no double-extraction, no zombie pause-state). Gates OQ-2.

E2E (Playwright, deferred per #38):

- Right-click a paragraph; assert `SpeedReader` parent visible.
- Submenu shows last-used speed in title.
- Click `300 wpm` → scoped mini-modal renders with `SELECTION` header; focus lands on play/pause control.
- Click `← Full article` → header swaps to article title; `positionIndex` resets to 0; engine is paused (user resumes manually).
- Toggle click does not dispatch activation; subsequent right-click shows updated `checked` state.

## File Layout

```
src/chrome/background/context-menu/
  factory.ts                buildMenuItems(settings) → CtxItemSpec[]; exports CtxMenuItemId, CtxItemSpec
  install.ts                installMenuItems(items), ensureContextMenu
  listener.ts               chrome.contextMenus.onClicked → dispatch / saveSettings / openOptionsPage
  register.ts               top-level synchronous wiring (matches commands/register.ts pattern)
  __tests__/
    factory.test.ts
    install.test.ts
    listener.test.ts
    register.test.ts

src/chrome/background/activation/
  types.ts                  ContextMenuActivationIntent + menuItemId + overrides (extension)
  dispatch.ts               intentToActivatePayload extended to copy overrides

src/core/messaging/
  validate.ts               OverridesSchema (Zod, reuses SettingsSchemaV4.shape.wpm); exports
                            validateOverrides, pickValidOverrides, type Overrides
  __tests__/
    validate-overrides.test.ts

src/core/settings/
  schema.ts                 SettingsSchemaV4 (adds contextLine, startFromWordOne, lastUsedWpm)
  defaults.ts               DEFAULT_SETTINGS extended
  migrations.ts             V3 → V4 migrator
```

`src/core/settings/**` and `src/core/messaging/**` retain zero `chrome.*` references — both are pure-TS for unit-testability and platform independence. `src/chrome/background/context-menu/factory.ts` is also pure (no `chrome.*`); the `chrome.*` calls live in `install.ts` and `listener.ts`. `OverridesSchema` reuses `SettingsSchemaV4.shape.wpm` to avoid duplicating the bounds constraint.

## Open Questions (gate Proposed → Accepted)

These are empirical preconditions named explicitly by the builder. Each blocks status promotion until evidence lands. Both are tracked here rather than buried in §Self-identified Weaknesses because they directly determine spec text that ships.

### OQ-1 — Toggle persistence semantics — RESOLVED (2026-05-26): persistent settings writes

**Question (original).** Do menu-item toggles (`Show context line`, `Start from word 1`) persist as settings writes, or are they momentary per-activation toggles?

**Spike result (2026-05-26).** The `chriscantu/speed-reader` Safari reference has **no context-menu integration at all** — `SpeedReaderExtension/Resources/manifest.json` declares no `contextMenus` permission, and `background.js` / `content.js` contain zero `contextMenus` API references. The literal question (does Safari persist menu toggles?) is moot — Safari has no menu and no menu toggles. Issue #72 carries the `scope:chrome-port` label for exactly this reason.

Adjacent evidence — Safari's existing boolean toggle (`punctuationPause` in `rsvp/settings-defaults.js`) is a **persistent settings field**, not a per-activation override. Pattern: when Safari has a boolean preference, it lives in persistent storage.

**Decision.** Lock persistent semantics. Reasoning shifts from "Safari does this" (parity) to Chrome-side UX reasoning:

- Safari's only existing boolean toggle pattern is persistent — closest data point we have favors persistent.
- Hi-fi mock checkbox visuals (`docs/design/Speed Reader Hi-Fi.html` surface 03) read as persistent defaults, not momentary toggles.
- "Set my default" matches the user mental model for right-click → submenu toggle far better than per-activation semantics (which would render the checkbox state visibly incoherent on every right-click).
- Per project stored feedback `parity_is_floor_not_ceiling`, Chrome UX may exceed Safari; the absence of a Safari precedent is not a reason to reject the persistent path.

**Effects (no further spec text changes — already aligned).** Spec body already specifies persistent semantics. The "Tentative — gated on OQ-1" callout at §Toggle Persistence Semantics is removed in this revision. §"Settings schema additions" stays. `subscribeSettings` rebroadcast path stays. AC #6 / #7 / #9 stay. Settings schema V3 → V4 migration stays — either in this spec OR in a sibling settings-schema PR if the implementer prefers to split (decision deferred to implementation PR — see §"Implementation dependencies" in §Composes).

**Trade-off accepted.** Adding `contextLine`, `startFromWordOne`, `lastUsedWpm` to Chrome's settings schema diverges from Safari's schema. Acceptable under `scope:chrome-port`; cross-platform schema sync is not a stated invariant.

### OQ-2 — #34 hotkey vs contextMenu collision (does idempotent injection + second-wins ordering survive a real race?)

**Question.** When the #34 hotkey fires while the submenu is open, do both activations cleanly reconcile — exactly one `executeScript` call, both `activate-reader` messages arrive in order, the second message's scope and overrides cleanly replace the first overlay?

**Evidence required.** The integration test at `src/chrome/background/activation/__tests__/collision.test.ts` (enumerated in §Test Surface). Three assertions: one-`executeScript` invariant, in-order message arrival, clean overlay replacement with no double-extraction and no zombie pause-state.

**Resolution effects.**

- If the test **passes**: §Failure Modes "Two activation surfaces collide" graduates from claim to verified invariant; spec moves to Accepted (OQ-1 already resolved 2026-05-26).
- If the test **fails**: spec needs an explicit reconciliation decision before Accepted — either "first-wins + drop second" or "queue + serialize" — and §Failure Modes is rewritten accordingly.

## Self-identified Weaknesses

Trimmed to honest hedges that the ring did not adjudicate. Findings the ring resolved are absorbed in the spec body above; preconditions are promoted to §"Open Questions".

- **`Custom…` opens Options vs popup.** The choice rests on "popups can't render a slider well in M1" and on the #30 dependency for a popup-hosted WPM slider. A critic could argue Options is a heavier navigation than the user wants — they right-clicked a paragraph and now they're in a settings page, two steps away from reading. The Options-page path is defensible (and the ring concurred it's the right M1 destination), but it's not unambiguously the best long-term UX.
- **`lastUsedWpm` may belong in `chrome.storage.local`, not `sync`.** Cross-device "last used" can be confusing if the user's laptop and phone have wildly different reading contexts. The settings-schema spec already separates reading-position (local) from settings (sync) on similar grounds. The storage-tier decision is deferred to the V3 → V4 migration PR (whether shipped here or split into a sibling settings-schema PR per OQ-1 resolution effects).
- **First-extraction latency on `← Full article` is bounded but unmeasured.** If the FIRST activation is `scope: 'selection'`, the full-article extraction has not yet run. §"Loading state" pins the visual (`"Loading full article…"` header + disabled play control), but the 50–200ms estimate is hand-waved — actual times vary by article length and DOM complexity. A future measurement pass may motivate a pre-warm path (kick off background extraction on selection-scope activation so the cache is warm by the time the user clicks expand).
- **`storage.sync` quota burn from menu-toggle spam, and `lastUsedWpm` data-classification on a synced surface.** Burst tolerance is unanalyzed; a user rapidly clicking toggles inside the 300ms debounce window coalesces, but the worst case (toggle + preset + toggle + preset within seconds) has not been measured. Both concerns resolve with the storage-tier decision in the V3 → V4 migration PR.

## Antagonistic ring sign-off

This spec went through a four-critic antagonistic ring on 2026-05-25.

- **Critics**: `security` (sender provenance, override bounds, frame provenance), `a11y` (focus management, AT announcements, reduced motion, forced colors), `scope` (schema creep, state-machine over-specification, premature future-proofing), `test-gap` (untested invariants, coverage holes on negative paths).
- **Arbiter**: SUMMARY at `/tmp/ring-72/SUMMARY.md`; individual critiques at `/tmp/ring-72/{security,a11y,scope,test-gap}.md`.
- **Convergence verdict**: **STRONG.** Three critics independently converged on the toggle-persistence decision (now OQ-1 — RESOLVED 2026-05-26 via Safari-spike, locked on persistent semantics); three converged on the silent-fallback branch (now AC #15); four converged on the scope-swap state machine (now simplified per F2).
- **Disposition of F1–F8 findings**:
  - F1 (toggle persistence) → OQ-1 (empirical gate) → RESOLVED 2026-05-26 (persistent).
  - F2 (scope swap silent + over-specified) → state table replaced with single sentence, §"Focus and Announcement on Swap" added, scope-swap unit test added, E2E corrected.
  - F3 (selection-cleared silent fallback) → §Failure Modes rewritten, AC #15 added, unit-test bullet added under `factory.test.ts` peer in §Test Surface.
  - F4 (#34 hotkey collision) → OQ-2 (empirical gate), AC #14, `collision.test.ts` added.
  - F5 (scoped modal focus on open) → §"Focus and Announcement on Open" added, AC #16.
  - F6 (overrides receive-side bounds) → §"Activation Payload Extension — Receive-Side Validation" added, AC #17, `validate-overrides.test.ts` added.
  - F7 (`installMenuItems` adapter test under-specified) → four explicit cases enumerated in §Test Surface.
  - F8 (frame provenance) → §"Frame Provenance" added, AC #18.
- **Builder weakness drift**: weakness #2 (`overrides` nested vs flat) removed — arbiter confirmed style-only with no behavioral consequence; the nested shape stays. Weakness #3 (`lastUsedWpm` sync vs local) deferred to the V3 → V4 migration PR. Weaknesses #4 (toggle persistence) → OQ-1 → RESOLVED 2026-05-26; #5 (collision) → OQ-2; #7 (selection-cleared fallback) → AC #15. Remaining hedges in §Self-identified Weaknesses: #1 (`Custom…` → Options vs popup), #6 (first-extraction latency on swap), plus the new `storage.sync` quota / data-classification note.

## Post-ring review fixes (2026-05-25)

A `/pr-review-toolkit:review-pr` pass (comment-analyzer + code-reviewer + type-design-analyzer) ran after PR #125 opened. Three critical findings and five important findings landed:

- **C1** — Schema-version drift (spec said `SettingsV1` / v1→v2; trunk is `SettingsV3`). Swept to `SettingsV3` / V3 → V4 throughout. AC #9 input fixture corrected to `{version: 3, ...}`.
- **C2** — `lastUsed` title at the factory rendering bullet read `settings.wpm`; everywhere else read `settings.lastUsedWpm`. Fixed at source.
- **C3** — `src/core/messaging/validate.ts` was cited as if it existed and as if it housed `isPopupShape`. Real `isPopupShape` lives at `src/chrome/background/messaging/on-message.ts:77`. §Receive-Side Validation rewritten: pure overrides-bounds validator at the new `src/core/messaging/validate.ts` (no `chrome.*`); sender-provenance citation correctly anchored at `on-message.ts`.
- **I1** — `CtxMenuItemId` literal union introduced; `ContextMenuActivationIntent.menuItemId` narrowed from `string`; listener switch is exhaustive.
- **I2** — `Overrides` derived via `z.infer` from a Zod schema that reuses `SettingsSchemaV4.shape.wpm` — single source of truth for bounds.
- **I3** — `CtxItemSpec` no longer imports `chrome.contextMenus.ContextType`; uses a local `CtxContext` union and `readonly` arrays.
- **I5** — AC #13 dropped "~50ms" timing claim (unverifiable in a test); ordering invariant retained.
- **M2** — AC #19 added asserting top-level synchronous listener registration.
- **M6** — §"Expand to full" reconciled with self-weakness #3: `extract()` is cache-hit on warm path, lazy on cold path; loading state pinned.

Two minor naming-drift items deferred (sibling specs use `Code Layout` / `Test Strategy`; this spec uses `File Layout` / `Test Surface`). Cosmetic; left for a follow-up sweep across all specs.

### Second-pass review (2026-05-25)

A second `/pr-review-toolkit:review-pr` run after the first fix commit surfaced 3 criticals + 5 importants introduced BY the fix pass:

- **C1' (F1)** — `src/core/messaging/validate.ts` was declared NEW but missing from §File Layout — implementer had no anchor. Added `src/core/messaging/` subtree with `validate.ts` and `__tests__/validate-overrides.test.ts`.
- **C2' (F2)** — `import type { Overrides } from '../../core/messaging/validate'` in the `types.ts` snippet had 2 `..` segments; correct is 3 (resolves from `src/chrome/background/activation/`). Fixed.
- **C3' (F3)** — Factory signature was `SettingsV3` but the factory reads V4-only fields (`lastUsedWpm`, `contextLine`, `startFromWordOne`). Signature corrected to `SettingsV4`; §"Settings schema additions" rewritten to clarify the new V4 shape extends V3.
- **I1' (F4)** — AC #17 and Test Surface bullet cited a non-existent `validateMsg` symbol. Replaced with the real exports: `validateOverrides` (shape gate) + `pickValidOverrides` (bounds gate).
- **I2' (T1)** — `OverridesSchema.strict()` rejected forward-compat additions on the wire. Changed to `.strip()` (Zod default — silently drop unknown). Forgery defense provided by `sender.id === chrome.runtime.id` at `on-message.ts:104`, not by unknown-key strictness.
- **I3' (T2)** — `CtxItemSpec.id` was `CtxMenuItemId | 'speedreader.ctx.separator'` (separator outside the main union). Moved separator literal inside `CtxMenuItemId` as `speedreader.ctx.separator.v1`; listener switch handles it with an explicit no-op `case` (Chrome never dispatches click on separators, so the arm is structurally unreachable; presence preserves exhaustiveness).
- **I4' (T4)** — `validateOverrides` and `pickValidOverrides` were presented as a caller-choice; pinned the composition order: `applyOverrides` runs `validateOverrides` (shape gate) → `pickValidOverrides` (bounds gate) → shallow-merge.
- **M1' (`'page'`)** — `CtxContext = 'selection' | 'page'` included `'page'` which was never used. Dropped to `'selection'`-only (per Karpathy #2: no flexibility not requested).
- **M2' (`subscribeSettings` dep)** — One-liner expanded with expected file path (`src/core/settings/index.ts`), expected signature, debounce note, and follow-up-issue placeholder.
- **F5 (`v2 migration` stale phrase)** — Self-weakness bullet rephrased to `V3 → V4 migration`.

### OQ-1 resolution (2026-05-26): Safari spike — persistent semantics locked

10-minute spike against `chriscantu/speed-reader` upstream completed 2026-05-26.

**Finding.** Safari has no context-menu integration. `SpeedReaderExtension/Resources/manifest.json` declares no `contextMenus` permission; `background.js` and `content.js` have zero `contextMenus` API references. The literal OQ-1 question (does Safari persist menu toggles?) is moot — Safari has no menu.

**Adjacent evidence.** Safari's only existing boolean toggle (`punctuationPause` in `rsvp/settings-defaults.js`) is a persistent settings field, not a per-activation override. Pattern: Safari boolean prefs live in persistent storage.

**Decision.** Lock persistent semantics for Chrome's menu toggles. Reasoning shifts from "Safari does this" (parity) to Chrome-side UX:

- Closest Safari data point favors persistent.
- Hi-fi mock checkbox visuals read as persistent defaults.
- "Set my default" matches user mental model.
- Per memory `parity_is_floor_not_ceiling`, Chrome UX may exceed Safari; absence of Safari precedent is not a reject reason.

**Spec changes from this resolution.**

- §"Toggle Persistence Semantics" — `Tentative — gated on OQ-1` callout replaced with `Locked (2026-05-26) — persistent settings writes`.
- §"Open Questions" → OQ-1 — entry rewritten as RESOLVED with spike result and Chrome-side reasoning preserved.
- §"Composes vs Supersedes" → "Implementation dependencies" — V3 → V4 migration confirmed required; split-vs-inline left as implementer's call.
- §"Self-identified Weaknesses" — both `lastUsedWpm` storage-tier and quota-burn bullets re-pointed at the V3 → V4 migration PR (whether inline or split).
- §"Antagonistic ring sign-off" — F1 / OQ-1 disposition updated to "RESOLVED 2026-05-26 (persistent)". OQ-2 resolution-effects updated: spec moves to Accepted once OQ-2 test passes (no longer "assuming OQ-1 also resolves").

**Trade-off accepted.** Chrome's V4 schema adds `contextLine`, `startFromWordOne`, `lastUsedWpm` — fields Safari's schema does not have. Acceptable under `scope:chrome-port` label; cross-platform schema sync is not a stated invariant.

**Remaining gate to Accepted.** OQ-2 (collision integration test) is the sole outstanding precondition.
