# Onboarding Surface Spec

**Date:** 2026-05-30
**Status:** Proposed
**Issue:** [#71 — Onboarding surface (welcome + WPM calibration)](https://github.com/chriscantu/speedreader-chrome/issues/71)
**Milestone:** M1 (MVP parity)
**Scope:** Pin the surface-specific behavior of a first-install onboarding experience — the `welcome.html` page hosting two views (Welcome + Calibrate), the `chrome.runtime.onInstalled` install-trigger, the in-page calibrate-WPM round-trip through `saveSettings`, and the dismiss / no-block contract with the popup activation path. Does not modify the activation, settings-schema, or sw-lifecycle specs.

---

## Problem Statement

First-install Chrome users land in the extension with no guided introduction and the default `wpm = 250` from the V4 settings schema. The popup CTA (`Read article` / `Read selection`) works without onboarding, but the reader's first RSVP exposure is at an arbitrary global default rather than a personally-calibrated speed. The Safari reference (`chriscantu/speed-reader`) and the Chrome Hi-Fi pack (`docs/design/Speed Reader Hi-Fi.html` surface 05) both call out an onboarding flow that (a) introduces the extension and (b) lets the user pick a comfortable WPM before first read. This spec fills the surface-specific holes so the implementation PR has a single source of truth.

Without a pinned spec:

- It's unclear whether onboarding is one HTML page or two (AC #5 specifies `welcome.html` singular — this needs to be honored, not re-litigated mid-implementation).
- It's unclear when `chrome.tabs.create` fires (install only, or update too — AC #1 specifies install only).
- It's unclear whether the calibrate flow blocks on `loadSettings` (AC #3 says it MUST NOT).
- It's unclear how dismissal interacts with the popup CTA (AC #2 says popup must work regardless of onboarding state).

## Constraints

- All MV3, lazy-injection, `src/core/` boundary rules from [`2026-05-22-sw-lifecycle-activation.md`](2026-05-22-sw-lifecycle-activation.md) §Constraints apply by reference. Not restated here.
- No tracking, no analytics, no network calls beyond fetching bundled extension assets (per project `CLAUDE.md` hard constraint).
- The `src/core/` engine reused by Calibrate MUST NOT gain any `chrome.*` imports — the welcome page imports `src/core/overlay/` directly from the extension page context, which is fine because it's still a privileged page; the boundary rule is about `src/core/` itself, not its consumers.
- No new permissions. `storage`, `activeTab`, `scripting`, `contextMenus` cover everything this spec needs. `chrome.tabs.create` requires no permission for extension-owned URLs.
- The Calibrate view MUST be dismissible at any step. Dismissal MUST NOT set any "onboarding complete" flag that the popup activation path checks — popup is always usable, before and after onboarding (AC #2).
- The `welcome.html` URL is the one stable contract — `chrome-extension://<id>/welcome.html` per AC #5. The page itself owns the welcome-vs-calibrate view switch; the URL does NOT change between views (no `chrome.tabs.update` to a different page).

## Composes With

This spec **composes** with — and does NOT supersede — the following already-merged surfaces:

- [`2026-05-22-sw-lifecycle-activation.md`](2026-05-22-sw-lifecycle-activation.md) §"Listener Registration Discipline" — this spec adds a new top-level `chrome.runtime.onInstalled` registration in `src/chrome/background/welcome/register.ts`, mirroring the established `commands/register.ts` and `context-menu/register.ts` pattern (each module owns its own listener; Chrome dispatches to all). See §Install Trigger for the file shape.
- [`2026-05-08-settings-schema.md`](2026-05-08-settings-schema.md) §"Schema shape" + §"Read/write/subscribe API" — Calibrate calls `saveSettings({ wpm })` against the V4 schema. The `wpm` field already exists (range [100, 600] step 10 per #15/#16); no migration is introduced by this spec.
- `src/core/rsvp-engine/` — Calibrate imports the **pure tick engine** (`createRsvpEngine` from `src/core/rsvp-engine`) and renders words via an inline word renderer in the welcome controller. NOT `src/core/overlay/` — the overlay is the full-viewport Shadow-DOM mount with focus trap + page-takeover semantics designed for content-script injection, which is not appropriate inside a privileged extension page that hosts a slider + Save UI. Calibrate consumes the engine's `'word'` events and updates a contained `<div>` in welcome.html's own light DOM. Loop-on-end is implemented by re-calling `start()` on the `'done'` event.
- `src/chrome/popup/` — popup CTAs (`Read article` / `Read selection`) MUST continue to function the moment the extension is installed, with or without onboarding completion. This spec adds NO `onboardingComplete` flag to V4 settings (deliberate — see §Non-Goals).

## Surface Layout

`welcome.html` is a single HTML page with two named views. View transitions are local DOM state changes; the page does not navigate. The URL stays at `welcome.html` for the entire onboarding flow.

### View 1 — Welcome

Static intro. No engine reuse. Renders:

- Title — "SpeedReader" wordmark + brief tagline.
- Body — 2-3 sentences on what RSVP is and how to use the extension. Enumeration of specific entry points (popup, hotkey, context menu) is implementer's choice — this spec does NOT pin the copy.
- Primary CTA — `Get started →` button. Transitions to Calibrate view.
- Dismiss control — header `✕`. Closes the tab via `window.close()`. No settings written. No `onboardingComplete` flag set (see §Non-Goals).

### View 2 — Calibrate

Interactive WPM picker exercising the real RSVP engine. Renders:

- Sample passage — a short canned paragraph bundled as a string constant in the welcome module. NOT extracted from any page (no extraction path involved).
- Live RSVP stream — `src/core/rsvp-engine` pure tick engine (`createRsvpEngine`) bound to an inline word renderer inside a contained `<div>` in welcome.html's own light DOM. NOT the `src/core/overlay/` full-viewport Shadow-DOM mount — that engine takes over the document and installs a focus trap, which is incompatible with the slider + Save UI on the same page. Renderer subscribes to the engine's `'word'` events and updates the contained `<div>`'s text.
- **Boot state — PAUSED for everyone.** The engine instantiates in `IDLE` and renders the first word of the sample statically. A prominent `▶ Start preview` button is the explicit user action that calls `engine.start()`. No `prefers-reduced-motion` branch — paused-default unifies behavior. Rationale: WCAG 2.2.2 (Pause, Stop, Hide) — auto-playing word-flash alongside the slider + Save UI is "moving content presented in parallel with other content" and requires a pause mechanism; defaulting paused is the cleanest compliance and removes the first-encounter startle for the neurodivergent target audience.
- **Loop policy — capped at 2 passes, then auto-pause with `↻ Replay` affordance.** Controller subscribes to the engine's `'done'` event; on the 1st `'done'` it re-calls `start()` (1 loop), on the 2nd `'done'` it leaves the engine in `DONE` state and surfaces the Replay button. Indefinite loop in an unattended onboarding tab violates WCAG 2.2.2.
- **Pause control** (toggling to `Play`) is exposed beside the slider for users who want to halt mid-stream; pause does NOT block slider reseats — it just calls `engine.pause()` so tick advancement halts while `setWpm()` is still honored.
- **Preview WPM clamp** — the slider value the user picks SAVES at the full slider range (100–600 wpm per #15/#16 schema bounds), but the preview engine itself clamps its render cadence at `min(sliderValue, 500)` wpm. Above 500 wpm a single-glyph swap approaches the WCAG 2.3.1 (Three Flashes) photosensitivity area+rate threshold; the onboarding surface uses defensive defaults even when the saved setting is permissive. The slider label still shows the slider's true value (e.g., "550 wpm — preview capped at 500 wpm for first-time view"). See OQ-4.
- Slider — `<input type="range" min="100" max="600" step="10">`. Live label "`{wpm} wpm`". Slider drag immediately reseats the engine's WPM (no save yet — debounced visual preview only).
- Primary CTA — `Save & finish` button. Calls `saveSettings({ wpm: <sliderValue> })`, then `await flushSettings()` wrapped in `try { ... } finally { window.close(); }` so the tab closes even if the flush rejects (offline + sync-quota-exhausted, transient `chrome.storage.sync.set` failure). The await is required: the 300 ms debounce timer lives in the page's JS realm and dies with the tab — without `flushSettings()`, a synchronous `window.close()` deterministically drops the write (see [`2026-05-08-settings-schema.md`](2026-05-08-settings-schema.md) §"Debounce window resolution contract").
- Dismiss control — header `✕`. Closes the tab. NO settings written. The user's slider drags up to that point are NOT persisted.

### Header `✕` semantics (both views)

The `✕` is a discrete button, not page-chrome. It MUST be reachable via keyboard tab order. Closing fires `window.close()` directly — extension pages opened via `chrome.tabs.create` are permitted to call `window.close()` per Chrome's tab-script rules (this is NOT the cross-origin block that affects content scripts).

## Install Trigger

`chrome.runtime.onInstalled` is the activation source. The welcome trigger lives in a new side-effect module `src/chrome/background/welcome/register.ts`, mirroring the existing `commands/register.ts` and `context-menu/register.ts` modules — each independently registers its own top-level listener at module load. `background/index.ts` gains a sibling side-effect import (`import './welcome/register';`).

The welcome module registers its OWN `chrome.runtime.onInstalled.addListener` — it does NOT mutate the context-menu module's existing registration. Multiple modules registering their own listener for the same event is the project's established MV3 pattern; Chrome dispatches the event to all registered listeners. Reason-gating is internal to each module:

```
// src/chrome/background/welcome/register.ts
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});
```

The `details.reason` matrix is owned by [`2026-05-22-sw-lifecycle-activation.md`](2026-05-22-sw-lifecycle-activation.md). This spec pins only the positive case: `reason === 'install'` opens `welcome.html`; all other reasons no-op per the sw-lifecycle spec.

The `chrome.tabs.create` call is fire-and-forget — its promise is awaited only via `void` (we don't surface failure; if tab creation fails, the extension still works, just without the onboarding tab). No retry logic.

The trigger is **one-shot per install**. `chrome.runtime.onInstalled` with `reason === 'install'` fires exactly once over the lifetime of the install. Re-installs (extension removed then re-added) fire it again, which is the correct behavior — a re-installer probably wants onboarding again.

## View State Machine

Welcome page boots in `'welcome'` state. State transitions:

```
welcome --[Get started →]--> calibrate
welcome --[✕]--> closed (tab closes)
calibrate --[Save & finish]--> saved (then tab closes)
calibrate --[✕]--> closed (tab closes; nothing saved)
```

No state machine library. A `<main>` element with two sibling `<section data-view="welcome">` and `<section data-view="calibrate">` is sufficient — controller toggles `hidden` attribute on each. The Calibrate engine is lazily mounted on first transition into `'calibrate'` (do NOT mount on page load — boot cost goes to the user only if they reach the view).

## Settings Round-Trip

Calibrate view loads settings via `loadSettings()` at mount. The slider's initial position is `settings.wpm`. The Calibrate UI MUST NOT block on the load — if `loadSettings()` is still in flight at render, the slider is rendered with the V4 default (250) and updated when the promise resolves (re-seat slider value + call `engine.setWpm(min(loadedWpm, 500))` so a subsequent `▶ Start preview` plays at the loaded WPM). Engine stays in `IDLE` regardless of load timing — the paused-default boot policy does NOT auto-start on load completion. This satisfies AC #3.

`Save & finish` calls `saveSettings({ wpm: sliderValue })` followed by `await flushSettings()` wrapped in `try { ... } finally { window.close(); }`. The await is mandatory — `saveSettings` is debounced 300 ms (per the settings-schema spec) and the timer lives in the page's JS realm, which is torn down by `window.close()`. Per `2026-05-08-settings-schema.md` §"Debounce window resolution contract", `flushSettings()` after a final `saveSettings` is the documented pattern for save-then-navigate / save-then-close consumers — it cancels the pending timer and runs `chrome.storage.sync.set` synchronously. The `finally` clause guarantees `window.close()` runs even when the flush rejects (e.g., offline + sync-quota-exhausted) — the user has signaled dismiss intent and we honor it; the failed write surfaces via the failure-modes row, not by leaving the tab open. The popup's next read sees the new value via the existing `chrome.storage.onChanged` broadcast.

Note: Calibrate writes `wpm` only. `lastUsedWpm` semantics (when it bumps, by which path) are owned by `2026-05-08-settings-schema.md`; this spec does not legislate them.

## File Layout

New files (under `src/chrome/welcome/`):

```
src/chrome/welcome/
├── index.html           # Vite entry; <link rel="stylesheet"> + <script type="module">
├── index.ts             # Thin DOM bind; bootstraps controller
├── index.css            # Page styles; reuses existing tokens from src/core/overlay/styles.ts where possible
├── controller.ts        # View state machine + Calibrate engine wiring; unit-testable against stub SettingsApi + DOM
├── sample.ts            # Canned passage constant (export const SAMPLE_PASSAGE: string)
└── __tests__/
    └── controller.test.ts
```

Service-worker delta (additive only):

```
src/chrome/background/welcome/register.ts    # Top-level chrome.runtime.onInstalled listener; opens welcome.html on reason='install'
src/chrome/background/welcome/__tests__/register.test.ts   # Asserts reason='install' opens welcome.html; other reasons no-op
src/chrome/background/index.ts               # Adds a single side-effect import line: `import './welcome/register';`
```

`src/chrome/welcome/index.ts` MUST follow the existing thin-bind pattern (matching `src/chrome/options/index.ts`):

```ts
document.addEventListener('DOMContentLoaded', () => {
  void bindWelcome(document, window, {
    load: loadSettings,
    save: saveSettings,
  });
});
```

All logic lives in `controller.ts` so it tests against an injected `SettingsApi` + DOM, matching options-page testing patterns.

## Manifest Delta + URL Contract

crxjs auto-discovers HTML build inputs from manifest entry fields (`action.default_popup`, `options_page`) and `web_accessible_resources`. `welcome.html` is referenced from neither today, so without an explicit input declaration crxjs will NOT emit it to `dist/` and `chrome.runtime.getURL('welcome.html')` will resolve to a 404 at runtime.

This spec pins the emission via `build.rollupOptions.input` in `vite.config.ts` rather than `web_accessible_resources` — the welcome page is NOT a web-accessible resource semantically (it's only opened via `chrome.tabs.create` from the SW, never embedded cross-origin), and WAR would either require an overbroad `matches: ['<all_urls>']` or the Chrome-119+ empty-matches form. `rollupOptions.input` is cleaner.

```ts
// vite.config.ts delta
export default defineConfig({
  plugins: [crx({ manifest, browser: 'chrome' })],
  build: {
    minify: true,
    outDir: 'dist',
    rollupOptions: {
      input: {
        welcome: 'src/chrome/welcome/index.html',
      },
    },
  },
});
```

Vite emits HTML inputs at the dist root using the key as the filename — `{ welcome: '...' }` produces `dist/welcome.html`. This matches AC #5's `chrome-extension://<id>/welcome.html` URL contract exactly. The source file remains at `src/chrome/welcome/index.html` per project convention (mirrors `src/chrome/popup/index.html`).

No `manifest.ts` change is required for the welcome page's existence. The manifest delta is **zero** — the page is addressable purely through the SW's `chrome.tabs.create` call against the internal `chrome-extension://<id>/welcome.html` URL. Extension-internal navigation to extension-owned URLs does not require WAR exposure.

## Failure Modes

| Mode | Behavior | Recovery |
|---|---|---|
| `chrome.tabs.create` rejects (extension disabled, browser closing) | Service worker swallows error via `void`. | None — extension still works without onboarding. User can re-run after #71's post-MVP `Options → About → Re-run onboarding` ships. |
| `loadSettings()` rejects in Calibrate | Slider stays at V4 default (250). | User can still drag and save — `saveSettings` writes from slider value regardless. |
| `flushSettings()` rejects on `Save & finish` | Controller proceeds to `window.close()` anyway — user has signaled dismiss intent. | Lossy — user's calibrated value is lost. The settings-schema spec does not require retry on transient `chrome.storage.sync.set` failures; the user can re-set wpm via Options. |
| User dismisses Calibrate without saving | Settings unchanged. `wpm` stays at V4 default 250. | User can change WPM via Options. |
| User opens `welcome.html` URL manually (not via install trigger) | Page renders normally in welcome view. | This is fine — it's not a privileged trigger; the page is harmless. The page always boots in `'welcome'` state regardless of how it was reached. |

## Non-Goals

- **Re-run from Options.** AC #4 marks this post-MVP; out of scope for this spec.
- **`onboardingComplete` flag in settings.** Deliberately not added. The popup must work the moment the extension installs (AC #2), and no surface should gate behavior on whether the user finished onboarding. Adding the flag is a future feature; absence is the contract.

## Open Questions

- **OQ-1: Dismiss-without-save recovery path.** If a user installs the extension, dismisses the welcome tab via `✕` to "explore first", then later wants to calibrate, there is no second-chance surface until post-MVP `Re-run from Options` (AC #4) ships. **Recommendation:** M1 accepts the one-shot trade-off — installers who dismiss live at the V4 default 250 wpm until they discover the Options page. Re-prioritize AC #4 if early M1 feedback shows a high dismissal rate. Spec does not gate M1 on AC #4.
- **OQ-2: `Save & finish` re-entry under rapid double-click.** Two clicks within the 300 ms debounce window before `window.close()` lands would dispatch two `saveSettings` (coalesced — fine) AND two `flushSettings` (the second resolves immediately, fine) AND two `window.close()` (second is a no-op). No data hazard. **Recommendation:** the implementation PR disables the button on first click to remove visual ambiguity, but the spec does NOT require it — the underlying contract is safe either way.
- **OQ-3: Two welcome tabs open concurrently.** The Failure Modes table permits manual `welcome.html` URL open. Two concurrent tabs both calibrating produce independent 300 ms debounce timers per page realm; last-flush-wins via wall-clock ordering at `chrome.storage.sync.set`. **Recommendation:** accept last-write-wins as the M1 contract — this matches Options-page semantics when opened in two tabs. The spec does NOT add storage-versioning or tab-singleton enforcement.
- **OQ-4: Calibrate preview WPM clamp at 500 wpm.** Pinned to `min(sliderValue, 500)` per a11y review (WCAG 2.3.1 area+rate threshold for single-glyph flash). The implementation PR's a11y audit (axe + manual reduced-motion sim + photosensitivity measurement on a calibrated display) resolves: **confirm the clamp**, OR **measure the swap-area threshold and document acceptance** for a higher cap. If measurements show the single-glyph swap is safely sub-threshold even at 600 wpm, the clamp can be lifted in a follow-up — but the M1 default ships conservative.

## Verification (for the implementation PR)

The implementation PR's test plan MUST cover (and must NOT mark complete without observable evidence):

- [ ] Fresh install (`chrome://extensions` → Remove → Load unpacked) opens `welcome.html` in a new tab. Screenshot the tab.
- [ ] Welcome view renders title + body + `Get started →` + header `✕`. Screenshot.
- [ ] Clicking `Get started →` transitions to Calibrate view in the same tab; the URL stays at `welcome.html` (no navigation). Screenshot.
- [ ] Calibrate view boots paused — first word of sample is statically displayed, `▶ Start preview` button visible, no animation yet. Screenshot.
- [ ] Clicking `▶ Start preview` begins the RSVP stream. Screenshot mid-playback.
- [ ] Engine auto-pauses after 2 full passes; `↻ Replay` button appears. Verify by leaving the page idle for the duration of 2 passes (a 60-word sample at 250 wpm is ~14s; two passes ~29s). Screenshot of auto-paused state with Replay control visible.
- [ ] Slider drag updates the live label and reseats the engine's WPM. Manually verify visually at multiple positions (e.g., 150, 350, 550). At slider position 550, the preview engine renders at 500 wpm (clamp per OQ-4); the slider label reads "550 wpm — preview capped at 500 wpm for first-time view". Verify with a stopwatch or frame count.
- [ ] `prefers-reduced-motion` is honored implicitly by the paused-default. Verify by enabling reduced-motion at OS level, reloading welcome page, confirming Calibrate boots paused identically.
- [ ] `Save & finish` writes `wpm` to chrome.storage. Verify by reopening `chrome://extensions` → Options for the extension, confirming the saved value.
- [ ] Header `✕` on either view closes the tab without writing settings. Verify by opening Options afterward — `wpm` unchanged.
- [ ] After dismissing onboarding (without saving), popup CTAs still work on a normal page. Verify by clicking `Read article` on a sample article URL.
- [ ] Popup CTAs work **while the welcome tab is still open** (AC #2 — popup not gated on onboarding completion). Verify by: install fresh, leave welcome tab open, open an article in a separate tab, focus the article tab, click the SpeedReader toolbar icon, click `Read article`. Reader overlay should mount normally on the article. Welcome tab unaffected.

## References

- Issue: [#71](https://github.com/chriscantu/speedreader-chrome/issues/71).
- Visual: `docs/design/Speed Reader Hi-Fi.html` surface 05; `docs/design/RECONCILIATION.md` §"Surface ↔ issue mapping".
- Settings schema (`wpm`, `lastUsedWpm`): [`2026-05-08-settings-schema.md`](2026-05-08-settings-schema.md).
- SW lifecycle (`onInstalled` listener composition): [`2026-05-22-sw-lifecycle-activation.md`](2026-05-22-sw-lifecycle-activation.md).
- Popup pattern (thin DOM bind + controller separation): `src/chrome/popup/`, `src/chrome/options/`.
- Engine reuse: `src/core/rsvp-engine/rsvp-engine.ts` (`createRsvpEngine`). Inline word renderer lives in welcome's `controller.ts`.
