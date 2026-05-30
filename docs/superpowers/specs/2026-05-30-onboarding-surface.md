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

- [`2026-05-22-sw-lifecycle-activation.md`](2026-05-22-sw-lifecycle-activation.md) §"Listener Registration Discipline" (the `chrome.runtime.onInstalled` listener — this spec adds an `Onboarding` consumer to the existing top-level listener, it does NOT register a second listener).
- [`2026-05-08-settings-schema.md`](2026-05-08-settings-schema.md) §"Schema shape" + §"Read/write/subscribe API" — Calibrate calls `saveSettings({ wpm })` against the V4 schema. The `wpm` field already exists (range [100, 600] step 10 per #15/#16); no migration is introduced by this spec.
- `src/core/overlay/` — Calibrate imports the overlay engine to render the canned sample passage as a live RSVP stream. This is the same engine the content script mounts; the welcome page uses it as a library, not via message-passing.
- `src/chrome/popup/` — popup CTAs (`Read article` / `Read selection`) MUST continue to function the moment the extension is installed, with or without onboarding completion. This spec adds NO `onboardingComplete` flag to V4 settings (deliberate — see §Non-Goals).

## Surface Layout

`welcome.html` is a single HTML page with two named views. View transitions are local DOM state changes; the page does not navigate. The URL hash (`#welcome` / `#calibrate`) is updated as a convenience for back-button parity and shareable links, but the source of truth is in-memory state in the controller.

### View 1 — Welcome

Static intro. No engine reuse. Renders:

- Title — "SpeedReader" wordmark + brief tagline.
- Body — 2-3 sentences on what RSVP is and how to use the extension (popup, context menu, hotkey when #34 lands).
- Primary CTA — `Get started →` button. Transitions to Calibrate view.
- Dismiss control — header `✕`. Closes the tab via `window.close()`. No settings written. No `onboardingComplete` flag set (see §Non-Goals).

### View 2 — Calibrate

Interactive WPM picker exercising the real RSVP engine. Renders:

- Sample passage — a canned 80-100 word paragraph bundled as a string constant in the welcome module. NOT extracted from any page (no extraction path involved). The text is project-neutral, chosen for readability balance (no rare words, no proper nouns, no punctuation pacing edge cases that would inflate ETA).
- Live RSVP stream — `src/core/overlay/` engine mounted into a contained region (NOT a Shadow DOM overlay over the whole page — the welcome page is privileged, not a content script). Engine boots playing at the current settings WPM. Looping playback (when the sample ends, restart).
- Slider — `<input type="range" min="100" max="600" step="10">`. Live label "`{wpm} wpm`". Slider drag immediately reseats the engine's WPM (no save yet — debounced visual preview only).
- Primary CTA — `Save & finish` button. Calls `saveSettings({ wpm: <sliderValue> })` and then `window.close()`. The save fires before the close, but the close does NOT block on the save promise — `saveSettings` is debounced and the chrome.storage write may complete after the tab is gone; the V4 contract handles this (storage write is fire-and-forget from the caller's POV).
- Dismiss control — header `✕`. Closes the tab. NO settings written. The user's slider drags up to that point are NOT persisted.

### Header `✕` semantics (both views)

The `✕` is a discrete button, not page-chrome. It MUST be reachable via keyboard tab order. Closing fires `window.close()` directly — extension pages opened via `chrome.tabs.create` are permitted to call `window.close()` per Chrome's tab-script rules (this is NOT the cross-origin block that affects content scripts).

## Install Trigger

`chrome.runtime.onInstalled` is the activation source. The listener already exists at the top of the service worker for the context-menu install path (per `2026-05-22-sw-lifecycle-activation.md`). This spec adds an Onboarding consumer to the SAME listener — it does NOT register a second top-level listener (MV3 requires all listeners be registered synchronously at SW boot; multiple consumers chained behind one registration is the standard pattern).

```
chrome.runtime.onInstalled.addListener((details) => {
  ensureContextMenu().catch((err) => { /* existing */ });
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('src/chrome/welcome/index.html') });
  }
});
```

Reason matrix:

| `details.reason` | Behavior |
|---|---|
| `'install'` | Open `welcome.html` in a new tab. |
| `'update'` | No-op. Existing users do NOT see onboarding on extension auto-update. |
| `'chrome_update'` | No-op. |
| `'shared_module_update'` | No-op. |

The `chrome.tabs.create` call is fire-and-forget — its promise is awaited only via `void` (we don't surface failure; if tab creation fails, the extension still works, just without the onboarding tab). No retry logic.

The trigger is **one-shot per install**. There is no idempotency guard — `chrome.runtime.onInstalled` with `reason === 'install'` fires exactly once over the lifetime of the install. Re-installs (extension removed then re-added) fire it again, which is the correct behavior — a re-installer probably wants onboarding again.

## View State Machine

Welcome page boots in `'welcome'` state. State transitions:

```
welcome --[Get started →]--> calibrate
welcome --[✕]--> closed (tab closes)
calibrate --[Save & finish]--> saved (then tab closes)
calibrate --[✕]--> closed (tab closes; nothing saved)
```

No state machine library. A `<main>` element with two sibling `<section data-view="welcome">` and `<section data-view="calibrate">` is sufficient — controller toggles `hidden` attribute on each. The Calibrate engine is lazily mounted on first transition into `'calibrate'` (do NOT mount on page load — boot cost goes to the user only if they reach the view).

`window.location.hash` is updated to `#welcome` / `#calibrate` on transition for back-button parity. The hash is read-only on initial load (we do NOT honor a `#calibrate` direct link — the page always boots in `'welcome'` state regardless of hash, so a stale bookmark doesn't bypass the intro).

## Settings Round-Trip

Calibrate view loads settings via `loadSettings()` at mount. The slider's initial position is `settings.wpm`. The Calibrate UI MUST NOT block on the load — if `loadSettings()` is still in flight at render, the slider is rendered with the V4 default (250) and updated when the promise resolves (re-seat slider value + restart engine playback at the loaded WPM). This satisfies AC #3.

`Save & finish` calls `saveSettings({ wpm: sliderValue })`. The `saveSettings` API debounces internally (300ms per the settings-schema spec); the welcome page does NOT need to await it. The page closes via `window.close()` synchronously after dispatching `saveSettings`. Storage propagation completes in the service worker after the tab is gone; the popup's next read will see the new value via the existing `chrome.storage.onChanged` broadcast.

**`lastUsedWpm` is NOT updated by Calibrate.** `lastUsedWpm` tracks the WPM the user last activated a reader at (per the V4 schema notes). Calibrating in onboarding sets the persistent default `wpm`, but does NOT count as an activation. The first popup activation after onboarding will update `lastUsedWpm` via the normal path.

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
    ├── controller.test.ts
    └── sample.test.ts   # Asserts passage is within length/word-count bounds for sane ETA
```

Service-worker delta (additive only):

```
src/chrome/background/index.ts   # Existing onInstalled listener gains the welcome-tab branch
src/chrome/background/__tests__/onInstalled-welcome.test.ts   # Asserts reason='install' opens welcome.html; other reasons no-op
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

## Vite / crxjs Bundling

`welcome.html` is NOT referenced from `manifest.ts` (it's neither the action popup nor the options page). Two options for bundling:

- **Recommended:** Add to `web_accessible_resources` in the manifest with the welcome-surface paths. This declares it as an addressable extension page and lets crxjs pick it up for bundling. `web_accessible_resources` is required only for cross-origin embedding (iframe-from-web-page), but declaring it here is the cleanest way to tell crxjs to emit the asset.
- Alternative: Add `src/chrome/welcome/index.html` to `build.rollupOptions.input` in `vite.config.ts`. Lower-level, but matches what other crxjs adopters do for non-manifest pages.

The implementation PR picks one — both work; this spec does not pin the choice. The verification step is `chrome-extension://<id>/src/chrome/welcome/index.html` resolves in a manually-loaded `dist/` unpacked extension and renders the welcome view.

## Restricted-Page Guard

The welcome page is an extension-owned page. It is not subject to the `chrome://*` / `chrome-extension://*` restricted-URL guard that applies to content-script injection — the welcome page IS extension content, not page content. No guard logic needed here.

The popup CTA on the welcome page (if we added a "Read this page" button) would hit the restricted-URL guard, but **this spec does not add a popup-style CTA to the welcome page**. The only RSVP rendering on welcome is the canned sample played via the in-page engine, which involves zero `chrome.scripting.executeScript`.

## Failure Modes

| Mode | Behavior | Recovery |
|---|---|---|
| `chrome.tabs.create` rejects (extension disabled, browser closing) | Service worker swallows error via `void`. | None — extension still works without onboarding. User can re-run after #71's post-MVP `Options → About → Re-run onboarding` ships. |
| `loadSettings()` rejects in Calibrate | Slider stays at V4 default (250). | User can still drag and save — `saveSettings` writes from slider value regardless. |
| `saveSettings()` rejects on `Save & finish` | Tab closes anyway; storage write is fire-and-forget. | Lossy — user's calibrated value is lost. This is the same failure mode as Options-page WPM persistence; covered by the settings-schema spec's retry behavior. |
| User dismisses Calibrate without saving | Settings unchanged. `wpm` stays at V4 default 250. | User can change WPM via Options. |
| User opens `welcome.html` URL manually (not via install trigger) | Page renders normally in welcome view. | This is fine — it's not a privileged trigger; the page is harmless. The hash-stale-link guard (always boot in `'welcome'`) prevents direct-to-calibrate exploitation. |

## Non-Goals

- **Re-run from Options.** AC #4 marks this post-MVP. The implementation PR MAY add a placeholder hook (e.g., an unwired `Re-run onboarding` button) but the wiring is explicitly out of scope.
- **`onboardingComplete` flag in settings.** Deliberately not added. The popup must work the moment the extension installs (AC #2), and no surface should gate behavior on whether the user finished onboarding. Adding the flag is a future feature; absence is the contract.
- **Analytics / telemetry on onboarding completion rate.** Project hard constraint: no tracking.
- **Calibrate's sample passage in user-localized text.** Single English sample. Internationalization is a separate effort tracked elsewhere.
- **Per-OS install path differentiation** (Chrome vs Edge vs Brave on Chromium). The welcome surface renders identically across all Chromium-based browsers; no special-case branches.
- **Welcome surface accessibility audit.** Standard WCAG application (per-issue `a11y-extension-designer` routing in `CLAUDE.md`) — covered by the implementation PR, not the spec.

## Open Questions

- **OQ-1:** Should Calibrate's engine loop the sample, or stop and offer a `Replay` button when it reaches the end? Looping is the recommended default (lets the user drag the slider without restarting), but a `Replay` button is friendlier for users with motion sensitivity who'd prefer not to have the stream running continuously. **Recommendation:** loop by default + a `Pause` button. Defer the `Replay` variant unless a11y review pushes back.
- **OQ-2:** Vite bundling — `web_accessible_resources` vs `build.rollupOptions.input`. **Recommendation:** the implementation PR picks one and explains the choice in the PR body. Spec does not pin.

## Verification (for the implementation PR)

The implementation PR's test plan MUST cover (and must NOT mark complete without observable evidence):

- [ ] Fresh install (`chrome://extensions` → Remove → Load unpacked) opens `welcome.html` in a new tab. Screenshot the tab.
- [ ] Welcome view renders title + body + `Get started →` + header `✕`. Screenshot.
- [ ] Clicking `Get started →` transitions to Calibrate view in the same tab; URL hash becomes `#calibrate`. Screenshot.
- [ ] Calibrate view renders the sample passage in an active RSVP stream. Screenshot mid-playback.
- [ ] Slider drag updates the live label and reseats the engine's WPM. Manually verify visually at multiple positions (e.g., 150, 350, 550).
- [ ] `Save & finish` writes `wpm` to chrome.storage. Verify by reopening `chrome://extensions` → Options for the extension, confirming the saved value.
- [ ] Header `✕` on either view closes the tab without writing settings. Verify by opening Options afterward — `wpm` unchanged.
- [ ] After dismissing onboarding (without saving), popup CTAs still work on a normal page. Verify by clicking `Read article` on a sample article URL.
- [ ] Re-loading the extension (`Reload` button in `chrome://extensions`) does NOT re-open the welcome tab. Verify (`reason === 'update'` no-op).
- [ ] axe-core scan on the rendered `welcome.html` reports zero violations. CI-equivalent verification.

## References

- Issue: [#71](https://github.com/chriscantu/speedreader-chrome/issues/71).
- Visual: `docs/design/Speed Reader Hi-Fi.html` surface 05; `docs/design/RECONCILIATION.md` §"Surface ↔ issue mapping".
- Settings schema (`wpm`, `lastUsedWpm`): [`2026-05-08-settings-schema.md`](2026-05-08-settings-schema.md).
- SW lifecycle (`onInstalled` listener composition): [`2026-05-22-sw-lifecycle-activation.md`](2026-05-22-sw-lifecycle-activation.md).
- Popup pattern (thin DOM bind + controller separation): `src/chrome/popup/`, `src/chrome/options/`.
- Engine reuse: `src/core/overlay/overlay.ts`, `src/core/overlay/constants.ts`.
