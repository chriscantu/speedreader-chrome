# Messaging Contract Spec

**Date:** 2026-05-08
**Status:** Approved
**Issue:** [#77 — Messaging contract between popup, service worker, and content script](https://github.com/chriscantu/speedreader-chrome/issues/77)
**Milestone:** M1 (MVP parity)
**Scope:** Pin the wire between the three actors (popup, service worker, content script): message-type registry, transport split, ownership table, lifecycle hazards, and acceptance criteria. Sets the contract every M1 runtime feature passes through.

---

## Problem Statement

SpeedReader has three actors at runtime — the popup, the MV3 service worker (SW), and the content script (CS) — and at least four kinds of conversation between them: extraction summary fetch, read-session control, settings broadcast, and restricted-URL probing. Without a pinned contract, each consumer would invent its own message shape and the wire would drift. The MV3 model also imposes two lifecycle hazards that ad-hoc messaging will hit silently:

1. The service worker is **ephemeral**. It can sleep mid-conversation, dropping any `sendMessage` round-trip that hasn't completed.
2. The **popup closes** when it loses focus. Any `sendMessage` whose reply arrives after the popup window unloads has no listener; the in-flight CS work either has to be idempotent or the user sees inconsistent state on the next click.

A contract spec — pinned before any of `src/chrome/{background,content,popup}/index.ts` is fleshed out — gives the implementer (and the eventual Safari port) one canonical source for what travels on the wire and why. This spec composes with the article-extraction spec (`2026-05-08-article-extraction.md`), the settings schema spec (`2026-05-08-settings-schema.md`), and the lazy-injection ADR (`docs/superpowers/decisions/2026-05-08-lazy-injection-manifest.md`).

## Constraints

- **MV3 service worker.** No persistent in-memory state across wake cycles; `setTimeout` / `setInterval` are unreliable across sleeps.
- **Lazy injection.** Per the lazy-injection ADR there is no `host_permissions` and no eager `content_scripts` entry — the SW injects the CS on demand via `chrome.scripting.executeScript`. The CS may not exist on a tab when the popup first opens.
- **Local-only.** No telemetry on message volume; no remote message bus.
- **Structured-clone payloads only.** `chrome.runtime.sendMessage` and Port `postMessage` clone via the structured clone algorithm. No `Date` instances, no functions, no DOM nodes, no class instances with methods. Every payload below is plain JSON-shaped data.
- **`src/core/` boundary.** Pure types live in `src/core/messaging/`. The Chrome runtime helpers live in `src/chrome/messaging/`. A future `src/safari/messaging/` reuses the core types and provides its own runtime adapter.

## Actors and Ownership

| Actor              | Owns                                                                                                       | Does NOT own                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Popup**          | Idle UI, "Read this page" CTA, restricted-URL surface, transport handle (Port) for the active read session | Read state, extraction state, settings persistence                                    |
| **Service worker** | CS injection, restricted-URL guard, settings broadcast fan-out, Port routing between popup and CS          | DOM, extraction, overlay, per-tab session state                                       |
| **Content script** | Extraction (`extract()` + cache by `location.href`), per-tab session (current word index, paused/playing), overlay shadow-DOM lifecycle | Settings persistence, restricted-URL classification, cross-tab state                  |

Settings persistence sits in `src/chrome/settings/storage.ts` (per the settings-schema spec). On the wire, the SW is the **broadcaster** of `settings-changed` events to active CS overlays; the SW does not own the storage call itself — it observes `chrome.storage.onChanged` and fans the new value out.

The popup is **stateless** between opens. It carries no in-memory model across closes; on each open it asks the SW for the active tab's URL, asks the CS for an extraction summary, and (if the user clicks the CTA) opens a Port for the read session.

## Transport Choice — `sendMessage` AND `Port`

We use **both**, deliberately split:

### `chrome.runtime.sendMessage` for stateless one-shot RPC

Used for:

- `extract-summary` — popup → SW → CS, one request, one response, no follow-up.
- `restricted-url-probe` — popup → SW, SW-internal classification.

These calls are short-lived (target ≤ 100 ms on a static fixture). The SW is awake long enough to handle the round-trip because the popup's user-gesture click wakes it; the CS, once injected, replies before the SW can sleep.

### `chrome.runtime.connect` Port for the read session

Used for the popup ↔ CS read session: `start-read`, `pause`, `resume`, `stop`, `overlay-state`, and (post-M1) `tick`.

Per the [Chrome docs on service worker lifecycles](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), **a connected Port keeps the service worker alive** while the Port is open. We exploit this directly: the popup opens a Port to the CS routed through the SW; while the user is reading, the SW stays awake, so any settings broadcast or control message is delivered without a wake-from-sleep race. When the user closes the overlay (or the popup closes, or the tab navigates), the Port closes and the SW is allowed to sleep again.

**Rationale for the split:** trying to do everything via `sendMessage` loses the SW-keep-alive guarantee for read-session control. Trying to do everything via Ports forces every fast probe (extraction summary, restricted-URL check) to pay a connect/disconnect cost and a per-request handshake, with no benefit. Two transports, each suited to its half of the conversation.

## Message-type Registry

Source of truth: `src/core/messaging/types.ts` (pure TS, no `chrome.*`).

```ts
// One-shot RPC envelope
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; details?: unknown };

// Discriminated union of all messages
export type Msg =
  // Popup → SW → CS (sendMessage)
  | { type: 'extract-summary' }
  // Popup → SW (sendMessage, SW-internal)
  | { type: 'restricted-url-probe'; tabId: number }
  // Popup → CS (Port: 'rsvp-session' open frame)
  | { type: 'start-read'; startIndex: number }
  // Popup → CS (Port frames)
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  // CS → popup (Port frames)
  | { type: 'overlay-state'; state: 'reading' | 'paused' | 'done' | 'error'; reason?: string }
  // CS → popup (Port frames, post-M1)
  | { type: 'tick'; index: number }
  // SW → CS broadcast (sendMessage to all active CS Ports OR storage.onChanged passthrough)
  | { type: 'settings-changed' };

export interface ExtractSummary {
  words: number;
  estMinutes: number;
  title?: string;
}
```

| Type                  | Source | Target | Transport     | Payload                                 | Response                          |
| --------------------- | ------ | ------ | ------------- | --------------------------------------- | --------------------------------- |
| `extract-summary`     | popup  | CS     | `sendMessage` | `{}`                                    | `Result<ExtractSummary>`          |
| `restricted-url-probe`| popup  | SW     | `sendMessage` | `{ tabId }`                             | `Result<{ allowed: boolean }>`    |
| `start-read`          | popup  | CS     | Port (open)   | `{ startIndex: number }`                | (Port lifetime; no immediate ack) |
| `pause`               | popup  | CS     | Port frame    | `{}`                                    | `overlay-state` frame             |
| `resume`              | popup  | CS     | Port frame    | `{}`                                    | `overlay-state` frame             |
| `stop`                | popup  | CS     | Port frame    | `{}`                                    | Port closes                       |
| `overlay-state`       | CS     | popup  | Port frame    | `{ state, reason? }`                    | none                              |
| `tick` (post-M1)      | CS     | popup  | Port frame    | `{ index }`                             | none                              |
| `settings-changed`    | SW     | CS     | broadcast     | `{}` (CS re-reads via `loadSettings`)   | none                              |

Notes:

- **`extract-full` is intentionally NOT on the wire.** The CS keeps its full `ExtractedArticle` in module-scope memory keyed by `location.href` (per the extraction spec). The popup never needs the token list; only the CS consumes it.
- **`settings-changed` payload is empty.** The SW signals "something changed"; the CS calls `loadSettings()` (via the settings adapter) to re-read. This avoids cloning the full settings object across the wire on every slider tick and avoids drift between the broadcast value and the persisted value. Implementation choice: the SW listens to `chrome.storage.onChanged` filtered to area `'sync'` + key `speedreader.settings` (per the settings-schema spec) and posts `settings-changed` to every active CS Port. We do NOT rely on the CS observing `storage.onChanged` directly because (a) the CS may not be loaded on tabs the user isn't reading, and (b) routing through the SW gives one consistent fan-out point.
- **Port name is `'rsvp-session'`.** The SW's `onConnect` listener filters by `port.name === 'rsvp-session'` and routes by `port.sender.tab.id`.

## Envelope Shape

All `sendMessage` responses use the `Result<T>` envelope above. Mirrors `ExtractionResult` from the extraction spec for visual and structural consistency. Errors are values, not exceptions; a handler that throws is a bug. Port frames carry the discriminated `Msg` union directly — no envelope wrapper, since a Port is a stream of typed frames rather than a request/response pair.

## Lifecycle Hazards

### SW sleep mid-extraction

Mitigated by the transport split. The popup-click user gesture wakes the SW; `chrome.scripting.executeScript` is dispatched inside that wake window. The CS's reply via `sendMessage` returns through the awake SW. For the read session, the Port keeps the SW awake.

**Failure mode if SW does sleep mid-call:** `sendMessage` rejects / its callback never fires. The popup treats absent reply within a 1500 ms timeout as an error and renders an idle retry state. No silent hangs.

### Popup closes before CS replies

`sendMessage` callback never fires on the popup side. The CS may have side-effects already in flight (extraction completed, cached). We require the CS to be **idempotent on extraction** — extraction is keyed by `location.href` and cached; a second `extract-summary` from the next popup-open returns the cached result. Popup-side, an unfulfilled promise is treated as user cancellation (silent), not an error.

### Tab navigation mid-read

The CS is destroyed by the navigation; the Port closes (Chrome fires `onDisconnect` on both ends). The popup observes the close and re-renders idle. The SW does NOT try to revive — the user's next click on the new page is a fresh session.

### Second popup-click while reading

The popup, on open, queries the SW for whether a Port for the active tab is currently held. If yes, the popup renders a "Reading… [pause / resume / close]" surface — it does NOT issue a second `start-read`. Re-opening the popup repeatedly is read-only state observation; explicit user action via the controls drives transitions. This is the simpler of the two candidates considered and matches the hi-fi mock's "reading-in-progress" popup state.

## Restricted-URL Handling

The SW is the sole gatekeeper for restricted URLs (`chrome://*`, `chrome-extension://*`, `https://chrome.google.com/webstore/*`, `view-source:*`, `about:*`) plus the `activeTab`-not-granted case. The popup, on open, sends `restricted-url-probe` with the active `tabId`; the SW classifies via `chrome.tabs.get(tabId)` and returns `{ allowed: boolean }`. If `allowed === false`, the popup renders the "SpeedReader can't run on this page" state from the hi-fi pack and skips both `extract-summary` and any read-session attempt.

## Code Layout

```
src/core/messaging/
  types.ts        Msg discriminated union, Result<T> envelope, ExtractSummary
  index.ts        barrel
src/chrome/messaging/
  send.ts         sendMessage<T>(msg) → Promise<Result<T>>
  session.ts      openSession(tabId) → typed Port wrapper
  routing.ts      onMessage / onConnect demux registries (used by SW + CS)
```

`src/core/messaging/**` has zero `chrome.*` imports — verified by grep in CI as the settings spec does for `src/core/settings/`.

## Test Strategy

### Unit (Vitest, pure)

- Discriminator type guards (`isExtractSummary`, `isPortMsg`) — exhaustive over the `Msg` union.
- `Result<T>` constructors and narrowing.

### Integration (Vitest + `sinon-chrome`)

- `sendMessage` round-trips: popup → SW → CS → response, asserting envelope shape and timeout behavior.
- Port lifecycle: open, frame exchange, `onDisconnect` on tab navigation, SW kept-alive verification via `chrome.runtime.getContexts()` mock.
- `settings-changed` broadcast: SW observes `storage.onChanged` and posts to every connected CS Port.

### E2E

Deferred to Playwright (#38). Smoke: load unpacked, open popup on a fixture page, click "Read this page", verify Port frames flow and overlay state transitions.

## Acceptance Criteria

1. `extract-summary` returns `Result<ExtractSummary>` within 100 ms on a static fixture (1000-word article).
2. Port-based read session keeps the SW alive for the duration: `chrome.runtime.getContexts({ contextTypes: ['SERVICE_WORKER'] })` reports an active SW context throughout a 30 s read session.
3. Tab navigation during a read session closes the Port within one event-loop tick on both ends; the popup re-renders idle on next open.
4. `restricted-url-probe` returns `{ ok: true, data: { allowed: false } }` for a `chrome://settings` URL **without invoking the content script** (no `executeScript` call observed).
5. `settings-changed` is broadcast to every connected CS Port within 50 ms of a `chrome.storage.onChanged` event on `speedreader.settings`.
6. Grep confirms `src/core/messaging/**/*.ts` contains zero `chrome.` references.
7. Unfulfilled `sendMessage` calls reject after 1500 ms with `{ ok: false, reason: 'timeout' }`; the popup renders idle, not error, on this case.

## Out of Scope

- **Reading-position persistence** (#48, M2) — when it lands, `start-read` will read the persisted index from `chrome.storage.local` rather than receiving `startIndex: 0`. The wire shape is forward-compatible.
- **Reading history** (#49, M2) and **saved articles** (#54, M3) — separate storage surfaces, not on this wire.
- **Live tick frames** (`tick`) — typed in the registry, deferred behind a flag for M1. Adding live progress in the popup is post-M1 polish.
- **Cross-extension messaging** — none planned.
- **WebSocket / EventSource** — none, per the local-only constraint.
