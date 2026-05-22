# ADR: SW lifecycle + unified activation-trigger architecture

**Date:** 2026-05-22
**Status:** Accepted (2026-05-22)
**Issue:** [#105 — Design: SW lifecycle + unified activation-trigger architecture (unblocks #34 + #72)](https://github.com/chriscantu/speedreader-chrome/issues/105)
**Related:** [#34](https://github.com/chriscantu/speedreader-chrome/issues/34), [#72](https://github.com/chriscantu/speedreader-chrome/issues/72), [Lazy-injection ADR (2026-05-08)](2026-05-08-lazy-injection-manifest.md), [Messaging contract spec (2026-05-08)](../specs/2026-05-08-messaging-contract.md), [Article extraction spec (2026-05-08)](../specs/2026-05-08-article-extraction.md)

## Context

Three issues converge on the service worker's activation surface:

- **#34** wires a `chrome.commands` hotkey (default `Ctrl+Shift+Y`) to open the reader.
- **#72** wires `chrome.contextMenus` right-click → SpeedReader.
- The popup already exists as a third activation source.

#72's body explicitly flags collision risk against #34: "if `chrome.contextMenus` registration churn collides with #34 — they share the activation-trigger code path." Neither can land without a designed dispatch layer underneath.

The lazy-injection ADR pinned `activeTab` + `scripting` (no `host_permissions`, no eager `content_scripts`). The messaging-contract spec pinned the read-session wire — `chrome.runtime.connect` Port (`rsvp-session`) with the `extract-summary` / `start-read` / `pause` / `resume` / `stop` / `overlay-state` / `settings-changed` vocabulary and `Result<T>` envelopes. Both are **Approved** / **Accepted**.

What does NOT exist yet: a written contract for how the three activation sources (`commands`, `contextMenus`, popup) reach the existing read-session wire, how SW idle-kill is handled between activation and read sessions, and how the restricted-URL guard composes uniformly across all three sources.

## Decision

1. **Funnel all three activation sources into a single `dispatchActivation(intent)` function.** `chrome.commands.onCommand`, `chrome.contextMenus.onClicked`, and the popup's `runtime.sendMessage` all normalize to an `ActivationIntent` value before any work happens. Eliminates the #72 collision risk.
2. **Compose with the messaging-contract spec; do NOT supersede it.** Activation is a new one-shot RPC layer (`activate-reader`) that hands off to the existing `rsvp-session` Port. The read-session wire is unchanged. `extract-summary`, `settings-changed`, and `Result<T>` semantics are preserved.
3. **SW lifecycle: idle-kill outside read sessions, Port-keepalive during them.** Listener registration is top-level and synchronous (the load-bearing MV3 invariant). Between activations, the SW is allowed to die. During a read session, the messaging-contract spec's Port already keeps the SW alive — no separate keep-alive mechanism is added.
4. **Restricted-URL guard moves to `src/core/restricted.ts`** with an extended scheme set (`chrome:`, `chrome-extension:` (own ID only), `chrome-untrusted:`, `chrome-search:`, `devtools:`, `view-source:`, `about:`, `data:`, `javascript:`, `file:`, `blob:`, `edge:`, plus Web Store hosts). One predicate, four call sites (`dispatchActivation`, `chrome.contextMenus.create({documentUrlPatterns})`, `chrome.scripting.executeScript` rejection conversion, CS-side activation-handler early-return).
5. **`sender` provenance validation is non-negotiable.** The manifest MUST omit `externally_connectable`. The unified `onMessage` listener MUST reject `sender.id !== chrome.runtime.id`. Per-message-type sender-shape assertions are required (popup vs CS).
6. **State recovery re-validates rehydrated storage** against the same schema used on the wire. Persisted session state is `{tabId, scope, wpm, positionIndex, sourceHash}` only — never raw selection text. `sourceHash` mismatch on resume → discard, start fresh.
7. **`activeTab` + `chrome.commands` gesture is a load-bearing assumption** for #34; the spec contains a 30-LOC reproducer (`experiments/activeTab-commands-check/`) that must succeed before the ADR moves from Proposed to Accepted. If it fails, the design pivots to `chrome.action.openPopup()` first.

## Consequences

- **Positive — no spec churn.** The messaging-contract spec, the article-extraction spec, and the lazy-injection ADR all stand unchanged. The activation layer composes by reference.
- **Positive — single guard, four call sites.** The restricted-URL list lives in `src/core/`, reused by activation dispatch, context-menu registration (`documentUrlPatterns`), defense-in-depth `executeScript` rejection conversion, and CS-side hotkey early-return.
- **Positive — security baseline.** Three independent reviewers (arch critic, security overlay, domain survey vs approved specs) converged on the same four BLOCKER-grade defects in the initial proposal; all four are closed in this design. See [`.ring-output/arbiter-verdict.md`](#) for the ring trace (workspace-local).
- **Empirical precondition resolved.** The `activeTab` + `commands` reproducer at `experiments/activeTab-commands-check/` was exercised on 2026-05-22; maintainer reported the manual T4 path (real `Ctrl+Shift+Y` keystroke → `chrome.scripting.executeScript` succeeds on `https://example.com` without `host_permissions`) as PASS via verbal confirmation. Automated regression coverage for the adjacent plumbing (T1–T3: manifest shape, listener registration, SW boot) lives at `experiments/activeTab-commands-check/tests/d10.spec.ts` and runs via `npm run test:d10`. T4 stays manual by design — Chromium's gesture-grant is tied to real user input in the browser process, which Playwright cannot synthesize. Re-run T4 on Chrome major-version bumps; T1–T3 catch regressions on every test pass.
- **Trade-off — minimum Chrome floor.** The Port-keepalive model is sensitive to Chrome's enforcement of `runtime.connect` lifetime (tightened in Chrome 110+, strict idle in 116+). The spec declares `minimum_chrome_version` in the manifest; no conditional fallback for older Chrome.
- **Forward-compatibility.** Future activation sources (e.g., omnibox keyword, post-MVP) extend `ActivationIntent` without touching the dispatch funnel.

## Alternatives rejected

- **Supersede the messaging-contract spec with a `sendMessage`-only model.** Rejected because the spec is already Approved and its Port-keepalive model directly mitigates several MV3 lifecycle hazards. Superseding would land as drive-by churn, not deliberation. (Initial builder proposal took this stance; the arbiter forced conformance.)
- **Offscreen document** (`chrome.offscreen.createDocument`) — solves a DOM-in-background problem we don't have. RSVP timing, ORP, tokenization all live in the CS (where the article DOM is) or in `src/core/`.
- **Persistent-tab keep-alive** (`runtime.connect` Port held open from a content script) — Chrome 110+ closed the loophole; 116+ enforces strict idle. Building on a narrowing loophole is a maintenance trap. The messaging-contract spec's Port use is bounded to read sessions only, which Chrome continues to support.
- **`chrome.alarms` heartbeat** — solves a problem we don't have. Adds an `alarms` permission and a noisy minimum-1-minute schedule.
- **Separate listeners per source with shared utility module** (the obvious alternative to funneling) — exactly what #72 warned against. Each source ends up calling 4 of 5 shared helpers in a slightly different order; restricted-page guards drift; the popup grows its own injection path.
- **`chrome.storage.local` for per-tab session state** — works, but conflates per-browser-session ephemera with cross-restart settings. `storage.session` (Chrome 102+) gives correct semantics (a reader position from yesterday's browser session is meaningless).
- **`onSuspend` / `onSuspendCanceled` for flush-on-suspend** — Chrome documentation marks both unreliable. Building on them is worse than the storage-throttle approach. Spec explicitly states this skip.
