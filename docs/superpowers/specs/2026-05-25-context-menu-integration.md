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
- [`2026-05-08-settings-schema.md`](2026-05-08-settings-schema.md) §"Schema shape" + §"Read/write/subscribe API" (`saveSettings` debounce, `subscribeSettings` broadcast; this spec adds two persisted fields).
- [`src/chrome/background/activation/types.ts`](../../../src/chrome/background/activation/types.ts) (`ContextMenuActivationIntent` already carries the `selectionText?: string` field) and [`dispatch.ts`](../../../src/chrome/background/activation/dispatch.ts) (`intentToActivatePayload` is extended, not replaced).

## Submenu Structure

`chrome.contextMenus.create` registers a parent item plus six children. Parent is the root entry visible when text is selected; children fan out underneath as a native submenu.

### Item IDs (stable strings)

IDs are versioned (`v1`) so a future shape revision can co-exist with old persisted state, and so the click handler can dispatch via a `switch` on the literal.

```
speedreader.ctx.parent.v1
speedreader.ctx.lastUsed.v1            // top child; title rewritten on update
speedreader.ctx.preset.300.v1
speedreader.ctx.preset.500.v1
speedreader.ctx.preset.custom.v1
speedreader.ctx.toggle.showContext.v1
speedreader.ctx.toggle.startFromWord1.v1
```

Separator between the speed items and the toggle items (`type: 'separator'`, no stable ID needed — recreated each render).

### Generation logic

Items are created **once per SW wake** in `ensureContextMenu()`, the same function the activation spec's `chrome.runtime.onInstalled` and `onStartup` listeners already invoke. The shape is data-driven:

```ts
interface CtxItemSpec {
  id: string;
  title: string;
  type?: 'normal' | 'separator' | 'checkbox';
  parentId?: string;
  contexts: chrome.contextMenus.ContextType[];
  documentUrlPatterns: string[];
  checked?: boolean;
}
```

`buildMenuItems(settings: SettingsV1): CtxItemSpec[]` lives in `src/chrome/background/context-menu/factory.ts` (no `chrome.*` calls — pure list builder). `installMenuItems(items)` in `src/chrome/background/context-menu/install.ts` is the Chrome adapter that calls `chrome.contextMenus.removeAll()` then `chrome.contextMenus.create()` per spec.

The factory consumes the current `SettingsV1` (read via `loadSettings()`) to render:

- `lastUsed` title — `"{wpm} wpm · last used"`, reading `settings.wpm`.
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
   */
  overrides?: {
    wpm?: number;                  // bounded 100..600 per settings schema
    showContext?: boolean;
    startFromWordOne?: boolean;
  };
}
```

**Backwards-compat:** `overrides` is optional. The popup-source and command-source callers omit it and observe identical behavior to today. The CS-side handler `if (msg.overrides) applyOverrides(snapshot, msg.overrides)` is a no-op for non-context-menu activations.

**Why a single nested object** rather than three top-level optionals: keeps the seam visible — every override field is in one place, easy to add a future `theme` or `fontSize` override without flattening the message type further. Also keeps the message-type registry table in [`2026-05-08-messaging-contract.md`](2026-05-08-messaging-contract.md) concise (one optional field, not three).

**Why the funnel — not the listener — owns the override extraction:** `dispatchActivation` already inspects `intent.source` exactly once in `intentToActivatePayload`. Adding override extraction in the same seam keeps the source-blind invariant intact for the rest of the pipeline. The listener stays a thin shim that produces an `ActivationIntent`; the funnel decorates the payload.

`ContextMenuActivationIntent` is extended in `src/chrome/background/activation/types.ts`:

```ts
export interface ContextMenuActivationIntent {
  source: 'contextMenu';
  tabId: number;
  selectionText?: string;
  menuItemId: string;              // one of the v1 IDs above
  overrides?: {
    wpm?: number;
    showContext?: boolean;
    startFromWordOne?: boolean;
  };
}
```

The listener (`src/chrome/background/context-menu/listener.ts`) reads `info.menuItemId` and produces the intent. The funnel's `intentToActivatePayload` copies `overrides` through to the wire payload.

### Activation Payload Extension — Receive-Side Validation

The foundation `activate-reader` shape gate (`isPopupShape` and similar in `src/core/messaging/validate.ts`) covers the SW-direction send only. The SW→CS direction — where `overrides` actually rides — needs its own validator: any same-extension surface (`chrome.runtime.id` parity) can call `chrome.tabs.sendMessage(tabId, { type: 'activate-reader', overrides: { wpm: 999999 } })` and reach the engine's `setInterval` cadence before a schema check fires.

The CS-side `applyOverrides` re-bounds-checks each field on receive:

- `wpm` — `typeof === 'number'`, integer, in `[100, 600]`, `multipleOf(10)`.
- `showContext`, `startFromWordOne` — strictly `typeof === 'boolean'`.

An out-of-bounds or wrong-type field is dropped silently from the overrides set (dev-mode `console.warn`), and the engine proceeds with that field's value from the live settings snapshot. The activation as a whole is **not** rejected — a single malformed override field does not block a legitimate read trigger.

SW-side, `validateMsg` in `src/core/messaging/validate.ts` is extended to cover the SW→CS direction with the same per-field rules so a spoofed message is rejected before it ever reaches the CS handler.

## Toggle Persistence Semantics

> **Tentative — gated on OQ-1.** This section's persistence model assumes the Safari reference treats menu toggles as persistent settings. If the Safari spike resolves OQ-1 toward momentary semantics, this section, the §"Settings schema additions" subsection, the `subscribeSettings` rebroadcast path, and AC #6 / #7 / #9 are dropped from the spec.

The two toggle items (`Show context line`, `Start from word 1`) are **persistent settings writes**, not per-activation toggles. Picked over per-activation-only because:

- Submenu UX reads as "set my default" — checkbox state visible on every right-click is incoherent if the value never sticks.
- A user who wants context-line ON expects to set it once and forget. A per-activation toggle defeats that.
- The popup and options page already expose the same toggles per the hi-fi mock; settings is the canonical surface.

**Wire model:** clicking `Show context line` does NOT dispatch an activation. It calls `saveSettings({ contextLine: !current })` and returns. The submenu closes (Chrome default behavior on click); on next open, the new `checked` state is read from settings via the `subscribeSettings` broadcast that fires `installMenuItems` again — see §Menu Update Discipline.

**Per-activation overrides come from speed clicks only.** The preset speed items (`300`, `500`, `lastUsed`) carry a `wpm` override on the resulting `activate-reader` payload AND update `settings.lastUsedWpm` for future submenu rendering. The toggle items do NOT carry overrides — they mutate settings directly and produce no activation.

This means the `overrides` field on the wire is, in practice, populated only with `wpm` from the preset clicks. `showContext` and `startFromWordOne` are present in the type to keep the door open for a future "one-shot override" UX (e.g., a popup checkbox that says "for this read only"); shipping them in the typed payload now avoids a v2 wire migration later.

### Settings schema additions

Three new fields land on `SettingsV1` as a v2 migration:

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

The `← Full article` button does NOT close the modal and does NOT re-fire activation. The CS already has the full extracted article in module-scope memory keyed by `location.href` (per the article-extraction spec's caching contract). The button click:

1. Calls `extract()` from cache → `fullArticle` token list.
2. Replaces the engine's token list with `fullArticle.tokens`.
3. Sets `currentScope = 'full'`, `positionIndex = 0`, engine `paused`.
4. Rewrites the header; hides the `← Full article` button.

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

The submenu may show a stale `420 wpm — last used` for up to ~50ms after SW wake, before `onStartup` → `loadSettings` → `installMenuItems` completes. A click during this window dispatches with the old `lastUsedWpm`. **Accepted:** the user sees their previous-session value and that value is still the most recent persisted truth — the only way it's "wrong" is if a sibling device synced a newer value in the window between Chrome restart and first interaction, which is benign. We do NOT block clicks on menu-update completion; that introduces a 50ms unresponsive period for every right-click.

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
9. Settings schema v2 migration: `migrate({ version: 1, ...legacy })` returns a v2 blob with `contextLine: false`, `startFromWordOne: false`, `lastUsedWpm: legacy.wpm`.
10. Scoped mini-modal renders `SELECTION · N words · ~M sec` header for `scope: 'selection'` activations; the `← Full article` button is present only in scoped mode.
11. Clicking `← Full article` swaps the reader to full-article scope without closing the overlay, sets engine state to `paused`, resets `positionIndex` to 0, removes the button, and emits the polite live-region announcement (see §"Focus and Announcement on Swap").
12. Restricted-page guard: no menu items appear on `chrome://settings`; verified by manual smoke test (the runtime guard is already covered by the activation spec AC #5).
13. Stale-label race: a click within ~50ms of SW wake dispatches with the persisted `lastUsedWpm`, never with an older or default value (the storage read precedes menu install). The ~50ms window of a stale-but-still-correct label is accepted and documented in §Failure Modes.
14. **#34 hotkey vs contextMenu collision test exists and passes** — `src/chrome/background/activation/__tests__/collision.test.ts` asserts exactly one `executeScript` call, both `activate-reader` messages arrive in dispatch order, and the second message's scope / overrides cleanly replace the first overlay (no double-extraction, no zombie pause-state). Gates OQ-2 and the move to Accepted.
15. **Empty-selection fallback** emits the polite live-region status `"No selection detected. Reading full article instead."` and renders full-article scope with a visible subtitle in the modal header.
16. **Scoped mini-modal mount** — activation from any source produces an overlay with `role="dialog"`, `aria-modal="true"`, `aria-labelledby="sr-scope-header"`, focus on the play/pause control within one rAF of mount.
17. **Override bounds-check** — a forged `activate-reader` with `overrides.wpm = 999999` is rejected by `validateMsg`; the CS receives no overrides; the engine uses the settings default.
18. **Frame provenance** — right-click + menu-click inside an `<iframe>` (`info.frameId !== 0`) produces no activation; the user-visible status `"Selection inside embedded frame; right-click the page directly"` is surfaced.

## Test Surface

Unit (Vitest, pure):

- `src/chrome/background/context-menu/__tests__/factory.test.ts` — `buildMenuItems(settings)` returns the expected list for default settings, for each toggle-checked permutation, and for `lastUsedWpm ∈ {undefined, 300, 500, 420 (custom), 100 (lower bound), 600 (upper bound)}`. Asserts no preset-vs-lastUsed title collision when `lastUsedWpm` exactly equals a preset value.
- `src/core/settings/__tests__/migrations.test.ts` — v1 → v2 migration adds `contextLine`, `startFromWordOne`, `lastUsedWpm`; existing v0 / corrupt-data tests continue to pass.
- `src/chrome/background/activation/__tests__/dispatch.test.ts` — `intentToActivatePayload` produces `overrides` on `contextMenu` source when `menuItemId` matches a preset speed; omits `overrides` for `popup` and `command` sources.
- `src/core/messaging/__tests__/validate-overrides.test.ts` — `validateMsg` accepts in-bounds `overrides.wpm` (`100`, `300`, `600`, `multipleOf(10)`); rejects out-of-bounds (`50`, `601`, `999999`), non-integer (`300.5`), wrong-type (`"300"`), non-boolean `showContext` / `startFromWordOne`. Receive-side `applyOverrides` drops malformed fields and proceeds with snapshot defaults.
- `src/core/reader/__tests__/scope-swap.test.ts` — after `← Full article` click, asserts `currentScope === 'full'`, engine `paused`, `positionIndex === 0`, footer button removed, live-region status emitted with the swap announcement text.

Integration (Vitest + `sinon-chrome`):

- `src/chrome/background/context-menu/__tests__/install.test.ts` — four explicit cases for `installMenuItems` discipline:
  - (a) **initial install**: `chrome.contextMenus.removeAll` MUST precede `chrome.contextMenus.create` calls.
  - (b) **`lastUsedWpm` change via `subscribeSettings`**: calls `chrome.contextMenus.update` and does NOT call `removeAll` + `create`.
  - (c) **`settings.contextLine` change**: calls `chrome.contextMenus.update` only on the `toggle.showContext` item; no other items mutated.
  - (d) **negative invariant**: the subscribe path NEVER calls `chrome.contextMenus.removeAll` (regression guard against the menu-flicker class).
  - (e) **stale-label race ordering**: `loadSettings` resolves before `installMenuItems` is invoked on `onStartup` — pins the AC #13 invariant.
- `src/chrome/background/context-menu/__tests__/listener.test.ts` — `chrome.contextMenus.onClicked` with each `menuItemId` produces the expected dispatch (preset → activation; toggle → settings write, no activation; custom → `openOptionsPage`). Includes the `info.frameId !== 0` refusal case.
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
  factory.ts                buildMenuItems(settings) → CtxItemSpec[]
  install.ts                installMenuItems(items), ensureContextMenu
  listener.ts               chrome.contextMenus.onClicked → dispatch / saveSettings / openOptionsPage
  register.ts               top-level synchronous wiring (matches commands/register.ts pattern)
  __tests__/
    factory.test.ts
    install.test.ts
    listener.test.ts

src/chrome/background/activation/
  types.ts                  ContextMenuActivationIntent + menuItemId + overrides (extension)
  dispatch.ts               intentToActivatePayload extended to copy overrides

src/core/settings/
  schema.ts                 SettingsSchemaV2 (adds contextLine, startFromWordOne, lastUsedWpm)
  defaults.ts               DEFAULT_SETTINGS extended
  migrations.ts             v1 → v2 migrator
```

`src/core/settings/**` retains zero `chrome.*` references. `src/chrome/background/context-menu/factory.ts` is pure (no `chrome.*`) for unit-testability; the `chrome.*` calls live in `install.ts` and `listener.ts`.

## Open Questions (gate Proposed → Accepted)

These are empirical preconditions named explicitly by the builder. Each blocks status promotion until evidence lands. Both are tracked here rather than buried in §Self-identified Weaknesses because they directly determine spec text that ships.

### OQ-1 — Toggle persistence semantics (does Safari persist menu-toggle state across reads?)

**Question.** Do menu-item toggles (`Show context line`, `Start from word 1`) persist as settings writes, or are they momentary per-activation toggles?

**Evidence required.** A 10-minute spike against the `chriscantu/speed-reader` Safari reference. Inspect how the equivalent menu UI is wired — does a toggle click write to persistent storage or does it ride a single-activation envelope?

**Resolution effects.**

- If Safari = **momentary**: drop §"Settings schema additions" (no v2 migration in this spec), drop the `subscribeSettings` rebroadcast path from §"Menu Update Discipline", drop AC #6, #7, and #9. Toggles ride the `overrides` envelope instead (the typed fields are already there). The spec shrinks by ~40 lines and stops dragging a settings-schema migration through a menu spec.
- If Safari = **persistent**: split the §"Settings schema additions" subsection into a sibling settings-schema PR that lands first; this spec depends on that schema rather than introducing it. AC #9 graduates to "verified by the sibling PR."

### OQ-2 — #34 hotkey vs contextMenu collision (does idempotent injection + second-wins ordering survive a real race?)

**Question.** When the #34 hotkey fires while the submenu is open, do both activations cleanly reconcile — exactly one `executeScript` call, both `activate-reader` messages arrive in order, the second message's scope and overrides cleanly replace the first overlay?

**Evidence required.** The integration test at `src/chrome/background/activation/__tests__/collision.test.ts` (enumerated in §Test Surface). Three assertions: one-`executeScript` invariant, in-order message arrival, clean overlay replacement with no double-extraction and no zombie pause-state.

**Resolution effects.**

- If the test **passes**: §Failure Modes "Two activation surfaces collide" graduates from claim to verified invariant; spec moves to Accepted (assuming OQ-1 also resolves).
- If the test **fails**: spec needs an explicit reconciliation decision before Accepted — either "first-wins + drop second" or "queue + serialize" — and §Failure Modes is rewritten accordingly.

## Self-identified Weaknesses

Trimmed to honest hedges that the ring did not adjudicate. Findings the ring resolved are absorbed in the spec body above; preconditions are promoted to §"Open Questions".

- **`Custom…` opens Options vs popup.** The choice rests on "popups can't render a slider well in M1" and on the #30 dependency for a popup-hosted WPM slider. A critic could argue Options is a heavier navigation than the user wants — they right-clicked a paragraph and now they're in a settings page, two steps away from reading. The Options-page path is defensible (and the ring concurred it's the right M1 destination), but it's not unambiguously the best long-term UX.
- **`lastUsedWpm` may belong in `chrome.storage.local`, not `sync`.** Cross-device "last used" can be confusing if the user's laptop and phone have wildly different reading contexts. The settings-schema spec already separates reading-position (local) from settings (sync) on similar grounds. The storage-tier decision is deferred to the settings-schema PR that owns the v2 migration — see OQ-1's "persistent" branch.
- **The mini-modal expand-to-full state machine assumes the CS has the full article extracted.** If the FIRST activation is `scope: 'selection'`, the full-article extraction may not have run. The CS triggers `extract()` lazily on `← Full article` click, which introduces a latency window (50–200ms on long articles) where the modal sits in an indeterminate state between the click and the swap. The simplified swap contract (post-swap is always `paused` with `positionIndex = 0`) makes the latency less harmful — the user doesn't lose mid-word position — but the spec does not pin a loading-state visual for that window. The implementer will hit it.
- **`storage.sync` quota burn from menu-toggle spam, and `lastUsedWpm` data-classification on a synced surface.** Burst tolerance is unanalyzed; a user rapidly clicking toggles inside the 300ms debounce window coalesces, but the worst case (toggle + preset + toggle + preset within seconds) has not been measured. Both concerns resolve with OQ-1's storage-tier decision in the sibling settings-schema PR.

## Antagonistic ring sign-off

This spec went through a four-critic antagonistic ring on 2026-05-25.

- **Critics**: `security` (sender provenance, override bounds, frame provenance), `a11y` (focus management, AT announcements, reduced motion, forced colors), `scope` (schema creep, state-machine over-specification, premature future-proofing), `test-gap` (untested invariants, coverage holes on negative paths).
- **Arbiter**: SUMMARY at `/tmp/ring-72/SUMMARY.md`; individual critiques at `/tmp/ring-72/{security,a11y,scope,test-gap}.md`.
- **Convergence verdict**: **STRONG.** Three critics independently converged on the toggle-persistence decision (now OQ-1); three converged on the silent-fallback branch (now AC #15); four converged on the scope-swap state machine (now simplified per F2).
- **Disposition of F1–F8 findings**:
  - F1 (toggle persistence) → OQ-1 (empirical gate).
  - F2 (scope swap silent + over-specified) → state table replaced with single sentence, §"Focus and Announcement on Swap" added, scope-swap unit test added, E2E corrected.
  - F3 (selection-cleared silent fallback) → §Failure Modes rewritten, AC #15 added, unit-test bullet added under `factory.test.ts` peer in §Test Surface.
  - F4 (#34 hotkey collision) → OQ-2 (empirical gate), AC #14, `collision.test.ts` added.
  - F5 (scoped modal focus on open) → §"Focus and Announcement on Open" added, AC #16.
  - F6 (overrides receive-side bounds) → §"Activation Payload Extension — Receive-Side Validation" added, AC #17, `validate-overrides.test.ts` added.
  - F7 (`installMenuItems` adapter test under-specified) → four explicit cases enumerated in §Test Surface.
  - F8 (frame provenance) → §"Frame Provenance" added, AC #18.
- **Builder weakness drift**: weakness #2 (`overrides` nested vs flat) removed — arbiter confirmed style-only with no behavioral consequence; the nested shape stays. Weakness #3 (`lastUsedWpm` sync vs local) deferred to the settings-schema PR per OQ-1 resolution branch.
