# SW-Owned Reading-Position Store Spec

**Date:** 2026-06-11
**Status:** Proposed (2026-06-11; backend pivoted 2026-06-15 — see §The Core Decision)
**Issue:** [#196 — spec: move reading-position store into service worker (S3 follow-up to #48)](https://github.com/chriscantu/speedreader-chrome/issues/196)
**Milestone:** M3 (privacy hardening)
**Scope:** Close the cross-origin reading-history enumeration threat that PR #195's ring surfaced (S3, carved out of #48). The reading-position data **stays in `chrome.storage.local`**; the SW makes the `local` area unreachable from content scripts by calling `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` at the top of every SW wake. Content scripts and the popup become thin clients reaching the store only through sender-bound `sendMessage` RPCs. **No data migration** — the keys never move. Composes with the messaging-contract (`2026-05-08-messaging-contract.md`) and SW-lifecycle (`2026-05-22-sw-lifecycle-activation.md`) specs by reference; does not modify them.

---

## Problem Statement

PR #195 shipped the #48 reading-position store as a content-script-owned wrapper over `chrome.storage.local`. The security-adversary critic (tier-2) flagged a privacy defect:

> A content script — injected on any page the user activates the reader on, via the `activeTab` user-gesture grant — can call `chrome.storage.local.get(null)` and enumerate every `position:<canonicalURL>` key, exfiltrating the user's **cross-origin** reading history to whatever site the reader was activated on.

S3 (the structural fix) was deferred from #195 to #196 after the fix-builder correctly argued that encryption is theater here: any AES-GCM key stored in `chrome.storage.local` is read by the same content script alongside the blobs, and any key stored in `chrome.storage.session` is **cleared on browser restart** — so while it survives SW idle-eviction, the encrypted blobs in `chrome.storage.local` outlive the key, leaving the data permanently unreadable after the next browser restart (fatal for a cross-session persistence feature). SHA-256 URL hashing is a public algorithm with zero obstruction value.

### Why moving the _abstraction_ to the SW is not enough — and what _is_

Issue #196 proposes "move the store into the SW; the SW owns the `chrome.storage.local` `position:*` keyspace; the CS simply has no read path." **Moving the abstraction alone is insufficient.** The `storage` permission is extension-wide (`manifest.ts:63` — `permissions: ['storage', ...]`); there is no per-context grant by default. A content script retains direct `chrome.storage.local.get(null)` access whether or not our store _abstraction_ lives in the SW — an import boundary is not a capability boundary.

The capability boundary that closes the threat is **`StorageArea.setAccessLevel`**. Calling `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` from a trusted context (the SW) removes the `local` area from the content-script API surface entirely: a subsequent CS `chrome.storage.local.get` / `get(null)` / `set` all fail. The data does not move; the door is locked. **This is verified empirically** (§Empirical Precondition, check 5): on Chrome 148 a declared CS's keyed read, `get(null)` enumeration, and write all fail with `chrome.runtime.lastError = "Access to storage is not allowed from this context."` after the SW restricts the area, while the popup (a trusted context) keeps full access.

The threat is closed when the data lives in a store the content script's **API surface cannot reach** — achieved here by _removing_ `local` from that surface via `setAccessLevel`, not by relocating the bytes.

### Least-privilege framing

The content script runs in proximity to untrusted page content (it is injected into arbitrary web origins via `activeTab`). It must not hold the capability to read other origins' positions. It needs exactly one thing: read/write/clear the position for **its own current page**. Everything else is excess privilege. This spec enforces that boundary structurally, at the storage layer (`setAccessLevel` strips the CS's raw `local` access) and at the message gate (sender-bound RPCs).

## Constraints

- **MV3 service worker.** No persistent in-memory state across wake cycles. All listeners registered top-level, synchronously, before any `await` (per SW-lifecycle spec). **`chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` is registered the same way — synchronously, at module top-level, on every wake, before the first `await`** — so the area is re-gated on every SW startup regardless of whether the access level persists across restarts (it is treated as non-persistent for safety). Durability lives in `chrome.storage.local`, which already survives browser restart.
- **Persistence across browser sessions is the value proposition.** `chrome.storage.local` survives browser restart natively, so no special handling is required. (For contrast, in-memory SW state and `chrome.storage.session` were both disqualified for not surviving restart — see §The Core Decision.)
- **CS-unreachable at the API layer.** The chosen backend must be inaccessible to a content script's execution context, not merely un-imported by it. `setAccessLevel('TRUSTED_CONTEXTS')` provides this at the API layer — empirically confirmed.
- **`local` becomes SW-trusted-only by design — a documented, area-global foreclosure (challenger review).** `setAccessLevel` is not per-key; it gates the _entire_ `chrome.storage.local` area to trusted contexts. This is acceptable today because **no content-script code reads `chrome.storage.local` or subscribes to `chrome.storage.local.onChanged` for anything other than positions** — verified by grep: the CS's only `local` use is `positionStore` (`content/index.ts`), and all CS settings traffic is `chrome.storage.sync` (`settings/storage.ts`). The foreclosure is therefore explicit and intentional: **any future feature that needs content-script-side `local` access must route through an SW RPC, not raw `chrome.storage.local`.** A CS that adds a raw `local` read or `local.onChanged` listener after this ships will silently get access-denied / no events — reviewers of future CS changes must treat raw `local` access as a design error.
- **Compose, don't supersede.** The messaging-contract `Result<T, E>` envelope, the `Msg` registry source-of-truth (`src/core/messaging/types.ts`), and the SW-lifecycle sender-provenance gate (`background/messaging/on-message.ts`) are reused unchanged and extended additively.
- **`src/core/` boundary.** `core/storage/reading-position.ts` (the LRU/schema/serialization logic) stays free of `chrome.*` and is reused verbatim behind its `StorageAdapter` seam. The existing `chrome.storage.local` adapter (`src/chrome/storage/chrome-position-store.ts`) is **reused** — it now runs SW-side instead of CS-side. The message glue lives in `src/chrome/`.
- **Local-only.** No telemetry, no remote calls.
- **Structured-clone payloads only.** Same as the messaging-contract spec.

## The Core Decision — Storage Backend

| Candidate                                              | Survives browser restart? | Reachable by content script?               | Data migration? | Verdict                                                                                                            |
| ------------------------------------------------------ | ------------------------- | ------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `chrome.storage.local`, default access                 | yes                       | **yes** (raw API)                          | n/a             | rejected — the status quo defect                                                                                  |
| `chrome.storage.sync`                                  | yes                       | **yes** (raw API)                          | yes (local→sync)| rejected — same reach + quota limits + needless move                                                              |
| `chrome.storage.session` (`TRUSTED_CONTEXTS`)          | **no** (cleared on restart)| no (`setAccessLevel` gates out CS)        | yes             | rejected — closes the threat but positions vanish on restart, defeating cross-session resume                       |
| Extension-origin IndexedDB                             | yes                       | no (origin-scoped)                         | **yes** (local→IDB + purge) | rejected — works, but requires a multi-file IDB adapter **and** a crash-safe production-data migration with purge  |
| **`chrome.storage.local` + `setAccessLevel('TRUSTED_CONTEXTS')`** | **yes**         | **no** (`setAccessLevel` gates out CS) — _verified_ | **none**        | **selected**                                                                                                       |

The selected backend dominates the IndexedDB alternative on every axis that matters:

- **Durable** — `chrome.storage.local` survives browser restart natively (the entire reason the original #48 store used it).
- **CS-unreachable** — `setAccessLevel('TRUSTED_CONTEXTS')` removes `local` from the content-script API surface. Verified empirically (check 5): keyed read, `get(null)` enumeration, _and_ write all fail from a declared CS after the SW restricts the area; the popup keeps access.
- **Zero data migration** — the positions are **already** in `chrome.storage.local` under `position:*` keys (`chrome-position-store.ts`). The bytes never move. The transition is purely (a) the SW calls `setAccessLevel` and (b) the CS/popup switch from direct `chrome.storage.local` access to sender-bound RPCs. No copy, no purge, no marker, no crash-safe ordering — the entire §Migration machinery the IDB direction required **evaporates**, removing the single most error-prone and irreversible part of that design (a purge of production reading history).

The IndexedDB direction (the prior selection) closed the same threat via origin-scoping, but bought it with a new `idb-adapter.ts`, an `onupgradeneeded` connection-discipline regime, and a one-time `local → IDB` migration that had to purge live user data crash-safely across arbitrary SW kills. `setAccessLevel` achieves identical CS-isolation against the same threat with none of that surface.

**Why `setAccessLevel` is safe despite being a runtime call, not structural origin-scoping — and the one window still being verified.** Origin-scoping (IDB) is always-on; `setAccessLevel` must have _run_ before a CS can be blocked, which raises a re-assertion-window question. There are two sub-cases:

- **Newly-injected CS — window closed by the injection model.** The manifest declares **no `content_scripts`** (`manifest.ts:9` — lazy/on-demand injection); a content script exists only after the user gestures on the extension action and the SW injects it via `chrome.scripting.executeScript`. The SW therefore necessarily wakes (and re-asserts `setAccessLevel` at its synchronous top-level) **before** any CS it spawns can run. No _freshly-injected_ untrusted context reads `local` ahead of the gate.
- **Long-lived CS during SW eviction — CONFIRMED SAFE (check 6, PASS).** A content script injected in a prior activation stays alive in its tab's renderer even after the SW is idle-evicted (~30 s). If `setAccessLevel`'s effect did **not** persist while the SW is evicted, the `local` area would revert to its content-script-readable default for the (typically long) evicted window, and an already-alive hostile/compromised CS — exactly the threat-model actor — could call `chrome.storage.local.get(null)` directly during it. Check 5 did not exercise this (its CS probes run within one live-SW wake). The Chrome docs do not state whether the access level persists across SW eviction, so it was **measured empirically** (§Empirical Precondition, check 6): on Chrome 148, with the SW confirmed stopped via CDP, an already-alive CS's keyed `get`, `get(null)`, and `set` all STILL fail with `"Access to storage is not allowed from this context."` **The restriction persists across SW eviction; the window is closed.** (Caveat: confirmed on Chrome 148 — the min-supported-Chrome open item below should re-confirm on the floor version, since this behavior is version-sensitive in principle.)

**Default access level.** `chrome.storage.local` defaults to `TRUSTED_AND_UNTRUSTED_CONTEXTS` (exposed to content scripts) — which is exactly the status-quo defect. The SW flips it to `TRUSTED_CONTEXTS`.

**Minimum Chrome version — the one real gap vs IDB, closed by pinning the floor + a fail-closed fallback (NORMATIVE).** `setAccessLevel` on the `session` area shipped in Chrome 102; access-level control for the `local`/`sync` areas is more recent — the harness min-version finding places it at **≈Chrome 119** (proven working ≤148; 119 unconfirmed-from-below). This is the pivot's single honest weakness against IDB: IDB origin-scoping isolates on every MV3 Chrome (≥88), whereas `local.setAccessLevel` isolates only at/above its availability floor. The extension currently declares **no `minimum_chrome_version`** (de facto MV3 baseline 88), while the composed SW-lifecycle spec assumes a Chrome-116 floor — so without action there is a 88/116–118 band where `setAccessLevel` may be absent and, with a naive permissive fallback, the exact cross-origin enumeration threat would silently reopen under an "Accepted" label. Two normative requirements close this; **both are impl-PR merge preconditions, not optional open items:**

1. **Pin `minimum_chrome_version` to the verified `local.setAccessLevel` floor.** The impl PR confirms the exact floor against Chrome release notes (and ideally a ≥119 harness build), then sets `manifest.ts` `minimum_chrome_version` to it (expected ≥119). Chrome auto-updates and 119 shipped 2023-10, so by ship date this excludes a negligible user slice. With the floor pinned, the gate API is always present on every supported Chrome and the isolation guarantee holds across the whole supported range — restoring the dominance-over-IDB claim without caveat.
2. **Fallback is FAIL-CLOSED, never permissive.** The store feature-detects `typeof chrome.storage.local.setAccessLevel === 'function'` (the harness already does). If the API is somehow absent on a Chrome at/above the pinned floor (defense-in-depth — should be unreachable after requirement 1), the store **MUST refuse to persist positions** — it must NOT fall back to writing `position:*` into an un-gated, content-script-readable `local`. Degraded-but-safe (no resume feature) is the only acceptable failure mode; reopening the enumeration threat is not. A unit test asserts the absent-`setAccessLevel` branch performs zero `position:*` writes. (Reverting to IDB for the sub-floor band is a possible alternative to "refuse to persist," but is explicitly out of scope here — the floor pin makes it moot.)

**Popup + SW share the same `chrome.storage.local`.** Both run under `chrome-extension://<id>` as trusted contexts, so the popup's `position/list` reads the same store the SW writes (and keeps access after `setAccessLevel`, since it gates out only _untrusted_ contexts — confirmed by check 5c). The content script, an untrusted context, is the only one locked out. Both directions are reproducer-confirmed.

## Actors and Ownership

```
Service Worker  (data owner — sole writer/reader on behalf of content scripts)
  ├─ calls chrome.storage.local.setAccessLevel(TRUSTED_CONTEXTS) at top-level, every wake
  ├─ owns the chrome.storage.local 'position:*' keyspace
  ├─ constructs ONE module-scope ReadingPositionStore wired to the existing
  │  chrome.storage.local adapter (chrome-position-store.ts, now SW-side)
  └─ position message handlers (sender-bound for CS, url-param for popup)

Content Script  (thin client — least privilege)
  ├─ has NO raw chrome.storage.local access (setAccessLevel revoked it)
  ├─ reaches ONLY its own page's position, via sender-bound RPC
  ├─ has NO message type that accepts a url parameter
  └─ debounced 1 Hz writes + pagehide/visibilitychange flush still apply

Popup  (trusted client — the user's own surface)
  ├─ keeps direct chrome.storage.local access (TRUSTED_CONTEXTS) but MUST NOT use it
  │  for writes — see Thin-Client Interfaces (single-writer rule)
  └─ lists / deletes-by-url / clears-all the full history via RPC

Options page  (trusted client — second current direct writer, MUST be rebound)
  ├─ TODAY constructs createChromePositionStore() directly and calls clearAll() on the
  │  history-disable toggle (options/index.ts:18,30) — a direct chrome.storage.local
  │  WRITE from a trusted context, the same second-writer pattern the popup is forbidden
  └─ MUST rebind to the popup's position/clear-all RPC (single-writer rule applies equally)
```

## Sender-URL Binding — the Security Invariant

**A content-script position RPC derives its URL from `sender.url`, never from the message payload.** A content script's messages carry no URL field at all; the message types it is allowed to send have no `url` parameter in their wire shape. The SW reads the sending frame's own URL from the `MessageSender` and canonicalizes it.

- **Why `sender.url`, not `sender.tab.url`:** `sender.url` is the URL of the frame that sent the message — the CS's own page — and is populated by Chrome for any extension-internal message regardless of the `tabs` permission (which this extension does not hold). `sender.tab.url` can be redacted without `tabs`/host permission. Combined with the existing provenance gate's top-frame requirement (`sender.frameId === 0`, `on-message.ts:84`), `sender.url` is the top-frame page URL.
- **Why this is the teeth:** a hostile or compromised content script cannot ask for `victim.com`'s position because there is no message it can send that names a URL. Its reach is structurally pinned to the page it is already running on — which the user opted into via `activeTab`. Enumeration is impossible, not merely discouraged.
- **Load-bearing gate dependency (do not refactor away):** the `sender.url` guarantee for CS position handlers is contingent on two checks in `on-message.ts` running _before_ the handler — (a) the foreign-extension rejection (`sender.id !== chrome.runtime.id`), without which `sender.url` could be `undefined` for a cross-extension sender, and (b) the CS sender-shape gate (`sender.tab?.id !== undefined && sender.frameId === 0`), which keeps popup/options (`chrome-extension://` origin) senders out of CS-typed handlers. Removing either gate silently breaks the URL-binding security invariant. The impl PR must carry a comment at the handler binding `sender.url` pointing back to this dependency.
- **Popup is exempt by design:** `position/list`, `position/delete`, and `position/clear-all` carry a `url` (or no scoping at all) and are accepted only from popup-shaped senders. The popup is the user's own history-management surface; returning all URLs to it is the feature, not the threat.
- **Null/opaque-origin URL → hard reject, no write.** If `canonicalizeUrl(sender.url)` returns `null` — `sender.url` absent (would only happen if the foreign-extension gate were bypassed), or an opaque-origin top frame (`about:blank`, `data:`), or a disallowed scheme — the handler MUST return `Result.err` and MUST NOT write. Without this guard a `null`/`undefined` URL could land under the literal storage key `"position:undefined"`, silently poisoning the store. The canonicalizer already rejects non-http(s) schemes, so this is closing the _handler's_ response to that rejection, not re-deriving it. (Reproducer note: check 2 below includes an `about:blank` top frame to confirm the `null` path, not only a normal `https://` page.)
- **Gate is allowlist, registered atomically.** Today `on-message.ts` assigns each type to `CS_ONLY_TYPES` or `POPUP_ONLY_TYPES`; a type in _neither_ set currently passes the per-set checks and reaches the router by sender shape alone. The six `position/*` types MUST be added to their provenance set **in the same commit** that registers their handler — never handler-first — so there is no window where a `position/list` from a CS sender routes ungated. The impl PR treats type-set membership + handler wiring as one atomic change; an integration test asserts every `position/*` type is rejected for the wrong sender shape at the gate layer (not only at the handler). Backing the process rule with a **code invariant**: `on-message.ts` adds a fail-closed default — a type present in neither `CS_ONLY_TYPES` nor `POPUP_ONLY_TYPES` is rejected (`invalid-payload`) instead of forwarded to the router by sender shape, so an accidentally-omitted position type fails closed rather than routing ungated.

### Message Registry (additive to `src/core/messaging/types.ts`)

Six new one-shot `sendMessage` RPCs. Three are content-script-only, three are popup-only — mapping cleanly onto the existing `CS_ONLY_TYPES` / `POPUP_ONLY_TYPES` sets in `on-message.ts`. The split is the invariant made syntactic: no content-script message type carries a `url`.

| Type                 | Source | Provenance set     | Payload                     | URL source              | Response                           |
| -------------------- | ------ | ------------------ | --------------------------- | ----------------------- | ---------------------------------- |
| `position/get`       | CS     | `CS_ONLY_TYPES`    | `{}`                        | `sender.url`            | `Result<ReadingPosition \| null>`  |
| `position/set`       | CS     | `CS_ONLY_TYPES`    | `{ wordIndex, totalWords }` | `sender.url`            | `Result<void>`                     |
| `position/clear`     | CS     | `CS_ONLY_TYPES`    | `{}`                        | `sender.url`            | `Result<void>`                     |
| `position/list`      | popup  | `POPUP_ONLY_TYPES` | `{}`                        | n/a (all)               | `Result<Array<{ url, position }>>` |
| `position/delete`    | popup  | `POPUP_ONLY_TYPES` | `{ url }`                   | payload `url` (trusted) | `Result<void>`                     |
| `position/clear-all` | popup  | `POPUP_ONLY_TYPES` | `{}`                        | n/a (all)               | `Result<void>`                     |

Notes:

- The CS-side `position/clear` (sender-bound, no payload) and the popup-side `position/delete` (url param) are deliberately **distinct types**. A single shared `position/clear` cannot satisfy the gate, which assigns each type to exactly one sender-shape set. Two types also make the trust boundary auditable: a content script literally has no `delete-by-url` capability.
- All responses use the existing `Result<T, E>` envelope. Errors are values; a handler that throws is a bug.
- Wire shape narrowing for the new types extends `validateMsg` in `src/core/messaging/validate.ts` (per the messaging-contract spec's payload-validation discipline).

## Thin-Client Interfaces

The content-script client drops the `url` parameter entirely — the binding lives server-side:

```ts
// CS-side (src/chrome/content/...): the page's own position only.
interface ContentPositionClient {
  read(): Promise<ReadingPosition | undefined>; // position/get
  write(p: WritableReadingPosition): Promise<void>; // position/set
  clear(): Promise<void>; // position/clear
}
```

This changes the call sites in `content/index.ts` (`positionStore.read(pageUrl)` → `client.read()`, etc.). The larger diff over keeping a `url` parameter is intentional: a `url`-accepting CS client would imply cross-URL reads work, the exact misconception the threat model forbids. **The CS no longer has any direct `chrome.storage.local` fallback** — `setAccessLevel` revoked it — so the RPC client is the _only_ path, not merely the preferred one.

The popup client mirrors the three popup RPCs:

```ts
// Popup-side (src/chrome/popup/...): full-history management.
interface PopupHistoryClient {
  list(): Promise<Array<{ url: string; position: ReadingPosition }>>; // position/list
  delete(url: string): Promise<void>; // position/delete
  clearAll(): Promise<void>; // position/clear-all
}
```

`popup/index.ts:216,241` (`store.list()`, `store.clearAll()`) and `:240` (`store.clear(url)` → `client.delete(url)`) rebind to this client.

**Every trusted context MUST route writes through the RPC path, never a direct `chrome.storage.local` write — this is normative, not stylistic, and it binds both the popup AND the options page.** Trusted contexts (popup, options) run under `chrome-extension://<id>` and _retain_ direct `chrome.storage.local` access even after `setAccessLevel` (so a direct write is not a _security_ hole). It is forbidden anyway because `delete` and `clear-all` are _writes_ that mutate the shared LRU index: a trusted page writing directly would be a second writer racing the SW's module-scope queue, reintroducing exactly the cross-tab LRU-index divergence the single-writer design (§Message ordering) exists to close. Routing all mutations through the SW keeps **one writer**. Concretely: the popup's `store.clearAll()`/`store.clear(url)` (`popup/index.ts`) **and** the options page's `positionStore.clearAll()` on the history-disable toggle (`options/index.ts:30`) both rebind to the `position/clear-all` / `position/delete` RPCs — the options use case is covered verbatim by the popup's `position/clear-all`. (A trusted context's _read_-only access could technically read `local` directly without a write race, but the impl keeps even reads on the RPC path for one code surface and one trust story.)

## Lifecycle Hazards

### `setAccessLevel` re-assertion (the new backend's one moving part)

`setAccessLevel` is a runtime call, not always-on origin-scoping, so the isolation holds only once the SW has called it. Three facts bear on safety — two settled, one reproducer-gated:

1. **Re-asserted every wake, synchronously issued before the first `await`** — same discipline as listener registration (SW-lifecycle spec). The area is re-gated on every SW startup, so we never depend on the access level persisting across SW restarts (Chrome's docs do not specify whether it does; we assume it does not). _Precision (architect review):_ `setAccessLevel` returns a Promise — only the _call_ is synchronous; the access-level change resolves on a microtask. This opens no exfiltration window, because the threat is a CS's _direct_ `local` access and the CS has no such path post-injection regardless of resolution timing (its only route is the SW-side RPC, where access is always trusted). The access-gate unit test therefore asserts **call ordering** (issued before the store's first storage op), not resolution ordering, to avoid a flaky timing assertion.
2. **No _newly-injected_ content script can run ahead of the gate.** The manifest declares no `content_scripts` (`manifest.ts:9`, lazy/on-demand injection). A CS exists only after a user gesture wakes the SW and the SW injects it via `chrome.scripting`. The SW (and its top-level `setAccessLevel`) therefore always runs before any CS it spawns. There is no document-start declared CS that could read `local` on a fresh browser launch ahead of the SW. **Load-bearing:** if a future change adds a declared `content_scripts` entry, this analysis must be revisited (flagged in §Acceptance Criteria as an invariant the impl comment records).
3. **Long-lived CS during SW eviction — measured, holds (check 6, PASS).** A CS from a prior activation outlives SW eviction in its tab. The no-`content_scripts` argument does NOT close this (the CS already exists; nothing re-injects it), so whether the restriction persists across SW eviction had to be measured rather than reasoned. Check 6 (§Empirical Precondition) stops the SW via CDP and fires an already-alive CS's `local` probe: on Chrome 148 the restriction **persists** — the CS stays blocked while the SW is down. The merge gate is cleared on this axis. (Re-confirm on the min-supported Chrome per the open item in §Acceptance Criteria — the behavior is version-sensitive in principle.)

### Cold-start latency on first read (issue Q1)

The first `position/get` after an SW eviction pays cold-start (~50–200 ms wake + one `chrome.storage.local.get`). Two options:

- **(A) Block first-word render on the read** (current #48 behavior: `await positionStore.read(pageUrl)` before mount, `content/index.ts:260`).
- **(B) Render at index 0 and patch to the saved index when the read resolves** — avoids the latency but flashes word 0 before jumping.

**Selected: (A), keep blocking.** Rationale: (1) resume-to-saved-position is the entire value proposition; flashing word 0 then jumping is more jarring than a sub-200 ms one-time delay on a cold SW; (2) a cold start happens at most once per ~30 s idle window, not per read; (3) ≤200 ms sits at/under the perception threshold for an intentional "resuming…" beat. The CS already guards persistence behind a feature check, so the blocking read is skipped entirely when persistence is unavailable.

**No migration on the first-read path.** Because the data stays in `chrome.storage.local`, the first `position/get` is a single `chrome.storage.local.get` — no `onupgradeneeded` schema creation, no migration transaction reading up to 100 legacy records before the first read resolves. The IDB direction's worst-case "cold SW + 100-record migration → 300–500 ms" path **does not exist here**; `chrome.storage.local.get` of one key is well under the perception threshold. The blocking default (A) is therefore unconditional — there is no migration-latency case that could force a flip to (B). (A light reproducer measurement of warm/cold `position/get` P95 is still worth recording in the impl PR, but it is no longer a merge-gate the way the IDB migration latency was.)

### Message ordering during overlay mount (issue Q2) — and a side-effect

The SW constructs **one** module-scope `ReadingPositionStore`. Every write from every tab serializes through that single instance's internal promise-queue (`reading-position.ts:176`). This is strictly stronger than #48, where each content script held its own queue that could not coordinate cross-tab — `reading-position.ts:167–175` documents the resulting cross-tab LRU-index divergence as a known limitation. **Centralizing the store in the SW closes that race**: two tabs writing near-simultaneously now enqueue on the same queue, so the LRU index read-modify-write no longer interleaves. (`setAccessLevel` reinforces this: the CS _cannot_ write `local` directly even if a future bug tried to, so the SW queue is the only writer by construction, not just by convention.)

This is a welcome side-effect, **proved by architecture** (single module-scope writer), not a #196 deliverable — it is NOT an acceptance criterion, and it is deliberately NOT asserted by a unit test: a `sinon-chrome` integration test dispatches both `sendMessage` calls in one event loop, so they serialize trivially whether or not the fix is present (the test passes even if the store is reverted to the CS — a `git stash` false-positive). The only runtime check that distinguishes broken from fixed is the multi-tab E2E (two real tabs, simultaneous writes, inspect the LRU index for consistency); see Test Strategy.

### SW eviction mid-write

A debounced write dispatched as the SW is evicting either completes (SW stays alive for the in-flight message) or the `sendMessage` rejects; the CS's existing `.catch` swallows it (`content/index.ts:99,115`). Position writes are idempotent and best-effort — a dropped write loses at most one ~1 s increment of progress, re-established on the next advance. No correctness hazard.

## Perf Envelope (issue Q3, Q4)

- **Write rate:** every persisted advance becomes one CS→SW `sendMessage` round-trip + one `chrome.storage.local` read-modify-write, bounded by the existing 1 s write debounce (`POSITION_WRITE_DEBOUNCE_MS`). Sustainable at 1 Hz. **Constraint:** the debounce is load-bearing for this design; dropping it would turn per-word advances into per-word IPC + storage writes. Documented as a guardrail.
- **Operations per write:** the core store's `write` does a read-modify-write of the payload + the LRU index (`reading-position.ts:265–298`) — expressed as separate `get`/`set`/`remove` calls on the `StorageAdapter`. The existing `chrome.storage.local` adapter already implements this exact shape (it is the same adapter #48 shipped), so there is **no new per-write cost** versus the status quo — the only change is that the calls now run in the SW and reach `local` after `setAccessLevel` (trusted access is unaffected). No `transaction(ops)` seam extension is needed (the IDB direction needed one to avoid 4–5 IDB transactions; `chrome.storage.local` has no transaction model to optimize).
- **Cross-tab queue:** the single module-scope promise-queue serializes _all_ tabs' writes, so N tabs each writing at 1 Hz give O(N) queue depth. Acceptable at the expected N (a handful of reading tabs). **Impl note:** if multi-tab tail latency regresses, shard the queue by canonical URL — mutations on distinct URLs are order-independent; only same-URL mutations and the shared LRU-index mutation need serialization. Recorded as an option, not required now.
- **List size:** `position/list` returns all entries, capped by `POSITION_LRU_MAX` (100). Fine for the popup history surface. Paginate only if the LRU cap is ever raised past ~1000.

## Migration — none required (issue Q5)

**There is no data migration.** The reading positions are already in `chrome.storage.local` under `position:*` keys (`chrome-position-store.ts`, shipped in #48). The pivot leaves every byte in place. The transition to this spec's design is purely behavioral:

1. The SW calls `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` at top-level on every wake — the one-line gate.
2. The CS and popup switch from direct `chrome.storage.local` access to the sender-bound RPCs.

No copy, no purge, no `positions-migrated` marker, no crash-safe failure-ordering, no `get(null)` purge-sweep. The entire crash-safety regime the IndexedDB direction required existed solely to move bytes between stores and then delete the originals without stranding or leaking them under arbitrary SW kills. **Because nothing moves and nothing is deleted, that whole class of hazard — and the irreversible purge of live user reading-history it entailed — is gone.** This is the largest single reason the pivot dominates IDB.

One consequence worth stating plainly: the pre-existing `position:*` keys were CS-readable up until the upgrade that ships this spec's `setAccessLevel` call. That is the status-quo exposure #195 already flagged; this spec _closes_ it going forward and does not need to scrub history that the same user's own content scripts could already read. After the upgrade's first SW wake, the keys are gated. No residual-exposure window is introduced by the transition (the injection-model analysis in §Lifecycle Hazards covers the only candidate window).

**Legacy LRU index is adopted as-is and self-heals (probe, challenger review).** #48's per-CS writers could leave a cross-tab-divergent `position-index` in `local` (`reading-position.ts:167–175`). The new single SW writer **inherits that index unchanged** — there is no one-time reconciliation pass, and none is required: the index is best-effort, every subsequent `position/set` does a read-modify-write that re-converges it, and a stale/divergent slot costs at most one wrong LRU eviction (a dropped saved position, re-established on next advance — the same best-effort contract as §SW eviction mid-write). A mid-upgrade in-flight write is a non-event for the same reason: the old CS code unloads and the new SW path takes over; a write lost in the seam is one ~1 s increment. If a future change makes the LRU index correctness-critical, add a first-wake index-rebuild then; it is unnecessary now.

**`chrome.storage.sync` is untouched.** No code path has ever written `position:*` to `.sync` — positions were `.local`-only in #48 (`chrome-position-store.ts`), and `.sync` carries only settings (`settings/storage.ts`). Confirmed by grep at spec time; the impl PR re-confirms. `setAccessLevel` is applied to `local` only; `sync` (settings) keeps its default access — settings are not the threat surface and the options page needs them.

## Privacy Semantics That Survive (issue Q6)

The `chrome.storage.local` store holds plaintext canonical URLs. A user who inspects the extension's storage via DevTools on `chrome-extension://<id>`, or who has the extension data extracted after corruption/uninstall, can still see their history. **That is out of scope.** The threat this spec closes is specifically _cross-origin enumeration from a content-script context the user opted into via `activeTab`_ — not at-rest disk privacy. At-rest encryption keyed to a user secret is a separate, larger feature (and still subject to the key-availability problem the #48 fix-builder identified).

## Empirical Precondition — `setAccessLevel` Isolation + `sender.url` Reproducer

Three facts are load-bearing. The entire backend decision is void if any fails, so the reproducer is a **precondition for merging this spec PR** — it runs _inside_ this PR and its results are recorded here before merge, gating the status flip to Accepted. No implementation PR dispatches until all three pass. (Gating only "before the spec flips to Accepted" while leaving the impl PR free to dispatch in the Proposed window would let a multi-file build proceed before the claim that justifies it is confirmed — the expensive rollback this section exists to prevent. The sw-lifecycle spec's reproducer likewise blocked shipping, not just a status label.)

1. **A content script injected via `activeTab` cannot read `chrome.storage.local` after the SW calls `setAccessLevel('TRUSTED_CONTEXTS')`.** Reproducer: SW writes a sentinel to `chrome.storage.local`, then calls `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`; an injected CS attempts a keyed `get`, a `get(null)` enumeration, and a `set`. **Objective pass criterion:** all three CS operations fail (the sentinel is never returned and no CS write lands). The inverse trusted-access check runs from the **popup**: after the restriction, `position/list`-style reads still return the sentinel, confirming `TRUSTED_CONTEXTS` keeps trusted contexts in while locking untrusted ones out.
2. **`sender.url` is populated for a CS→SW message under `activeTab` without the `tabs` permission**, and equals the top-frame page URL. Reproducer: CS sends `position/get`; SW logs `sender.url`, `sender.frameId`, `sender.tab?.url`; confirm `sender.url` is the page URL and `frameId === 0`. **Also run against an `about:blank` top frame** to confirm the opaque-origin path yields a `null`-canonicalizing URL that the handler rejects (per the null/opaque-origin guard in §Sender-URL Binding), not a silent write.
3. **The `setAccessLevel('TRUSTED_CONTEXTS')` restriction on `local` holds while the SW is not running — a long-lived content script stays blocked.** This is the window §Lifecycle Hazards fact 3 raises and the one that determines whether the pivot beats IDB. Reproducer: SW writes the sentinel + calls `setAccessLevel`; inject a CS that retains a `chrome.storage.local.get(null)` probe; **stop the service worker** (the harness uses CDP `ServiceWorker.stopAllWorkers`, with liveness confirmed via `Target.getTargets` — NOT `context.serviceWorkers()`, which keeps a stale handle); while the SW is stopped, fire the already-alive CS's probe. **Objective pass criterion:** the probe still fails (`chrome.runtime.lastError` set, sentinel absent) — the restriction did not lapse with the SW. **Fail criterion:** the CS reads the sentinel while the SW is down → the restriction is SW-lifetime-scoped and the design has an open exfiltration window during eviction.

   **Faithfulness caveat (raised in challenger review, recorded honestly).** CDP `ServiceWorker.stopAllWorkers` is a developer-commanded stop, not Chrome's own ~30 s idle-eviction. The two _could_ reclaim different per-extension state. The access level is managed by the browser process (not the SW renderer), so it is _architecturally likely_ to persist identically under both — but that is reasoning, not measurement. **Recommended once-per-Chrome-major manual smoke (same gate shape as check 2′, non-merge-blocking): let an injected-CS tab's SW idle out naturally (~30–40 s, no CDP), then fire the CS `local` probe and confirm it is still blocked; record the Chrome version.** If a natural-eviction smoke ever shows the gate dropping where CDP-stop did not, check 6's automated PASS is void and the eviction window reopens against IDB.

Reproducer lives at `experiments/idb-isolation-check/` (named for the prior IDB investigation; the harness now also carries the `setAccessLevel` checks that drove the pivot). If (1) fails, the backend decision is void and the spec returns to Solution Design. If (2) fails, the binding falls back to `sender.tab.url` and the spec must add the `tabs` permission (with its own privacy review) or a CS-supplied-then-SW-validated URL scheme. If (3) fails, the restriction lapses during eviction and the pivot loses its dominance over IDB — the decision returns to Solution Design (likely back to IDB, whose origin-scoping never lapses) before any impl.

### Reproducer Outcome (recorded in-PR before the Accepted flip)

Harness: `experiments/idb-isolation-check/`. Automated suite: `npm run test:idb` — **13/13 passing** (Chromium via Playwright `--load-extension`, Chrome 148). Two independent non-vacuity red-checks confirm the load-bearing assertions are live, not vacuously green: (a) forcing C2a's expected URL to a wrong value failed with `Received: "http://127.0.0.1:.../"` (the `sender.url` assertion); (b) mutating C6b to expect the CS to SEE the sentinel failed with `Expected: true, Received: false` (the eviction-persistence probe genuinely ran and observed the value unreadable).

| Check | Method | Status | Evidence |
|---|---|---|---|
| **5 — CS blocked from `local` after `setAccessLevel`** (the backend-pivot gate) | Automated (structural; gesture-independent) | **PASS** | `C5a`: `chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})` is a function and succeeds with no `lastError` on Chrome 148. `C5b`: a declared CS's keyed `get`, `get(null)` enumeration, **and** `set` all fail with `chrome.runtime.lastError = "Access to storage is not allowed from this context."` (async `lastError` path, not a sync throw) — the sentinel is never returned and the CS write never lands. `C5c`: the popup (trusted) STILL reads the sentinel after the restriction. CS-isolation, CS-write-block, and trusted-read-survives all hold. |
| **1 — CS cannot open extension-origin IDB** (legacy check; no longer load-bearing) | Automated | **PASS** | Retained from the IDB investigation: `C1a` page/CS-origin `indexedDB.open` fires `onupgradeneeded` with `oldVersion === 0`; `C1b` popup `position/list` shares the namespace. Not part of the selected design but left green as corroborating evidence. |
| **2 — `sender.url` populated under `activeTab`, no `tabs` perm** | Automated (declared CS path) | **PASS** | `C2a`: `sender.url` == page URL, `frameId === 0`, manifest carries no `tabs`. `C2b`: `about:blank`/`data:`/`undefined` canonicalize to `null` → handler hard-rejects (no silent write), per §Sender-URL Binding. |
| **6 — restriction holds while SW is evicted (long-lived CS stays blocked)** | Automated (CDP `ServiceWorker.stopAllWorkers`; liveness via `Target.getTargets`) | **PASS** | `C6b`: with the SW confirmed stopped, an already-alive CS's keyed `get`, `get(null)` enumeration, and `set` ALL still fail with `chrome.runtime.lastError = "Access to storage is not allowed from this context."` — sentinel never returned. The restriction persists across SW eviction on Chrome 148. `C6a` (negative control): the same DOM-channel probe is blocked while the SW is alive AND the sentinel provably exists (trusted read), so C6b's "blocked" is not a silent-channel false pass. SW-stopped liveness asserted before and after the probe (target absent), guarding against a secretly-alive SW. |
| **2′ — `activeTab`-`executeScript`-injected CS variant** | **Manual** (gesture-provenance; same limit as the D10 reproducer's T4) | **UNVERIFIED** | Once-per-Chrome-major smoke. Load-bearing claim already covered by C2a; this variant does not gate merge. |
| **3 — `chrome.storage.session` survival across restart** | n/a | **MOOT — design no longer uses `session`** | The prior IDB direction needed to prove `session` does NOT survive restart (to reject the cheaper `session`+`setAccessLevel` path). The selected backend uses `chrome.storage.local`, which is _designed_ to survive restart, so this check is no longer load-bearing. (Historical note: the earlier manual run found `session` _did_ survive a session-restore config on Chrome 138 — a config-dependent result — which is itself one reason `session` was not viable. Irrelevant to the `local` decision.) |

**Merge gate status: CLEARED for the selected backend.** The three load-bearing checks PASS, all automated: check 5 (CS blocked from `local` after `setAccessLevel` while the SW is alive), check 2 (`sender.url` binds correctly), and check 6 (the restriction persists across SW eviction, so a long-lived CS stays blocked). The eviction window that was the pivot's single remaining risk against IDB is empirically closed on Chrome 148. Check 3 is moot (design dropped `session`). Per the Acceptance Criteria, Status flips to **Accepted on merge** of this PR. The only residual is the min-supported-Chrome re-confirmation, carried to the impl PR as a non-merge-blocking open item.

## Code Layout

```
src/core/
  storage/reading-position.ts        UNCHANGED — reused behind StorageAdapter
  messaging/types.ts                 + 6 position message types (additive)
  messaging/validate.ts              + narrowing for the 6 new types

src/chrome/background/
  position/access-gate.ts            NEW — calls chrome.storage.local.setAccessLevel(
                                     TRUSTED_CONTEXTS) at module top-level, synchronously,
                                     before any await; feature-detects setAccessLevel.
                                     One small file; replaces the entire idb-adapter +
                                     migrate surface the IDB direction would have needed.
  position/store.ts                  NEW — module-scope ReadingPositionStore wired to the
                                     existing chrome.storage.local adapter (+ Date.now)
  position/handlers.ts               NEW — 6 message handlers; sender.url binding for CS types
  route.ts                           + dispatch the 6 position/* types. Each handler uses the
                                     void (async () => { ...; sendResponse(...) })() shape of the
                                     existing activate-reader handler and the listener returns true
                                     synchronously; route() stays void — an async route() drops
                                     sendResponse (Chrome invalidates it when the sync listener
                                     returns without true). No unit test catches this; it is normative.
  messaging/on-message.ts            + 3 types to CS_ONLY_TYPES, 3 to POPUP_ONLY_TYPES;
                                     + fail-closed default: a type in NEITHER set is rejected
                                     (invalid-payload) rather than forwarded to route by sender
                                     shape alone — a code invariant backing the atomic-registration rule

src/chrome/content/
  position/client.ts                 NEW — ContentPositionClient over sendMessage
  index.ts                           rebind positionStore -> client (drop url args).
                                     The CS NO LONGER imports chrome-position-store.ts — its
                                     raw chrome.storage.local path is gone (setAccessLevel revoked it).

src/chrome/popup/
  position/client.ts                 NEW — PopupHistoryClient over sendMessage
  index.ts                           rebind store -> client (clear(url) -> delete(url))

src/chrome/options/
  index.ts                           rebind createChromePositionStore().clearAll() (:18,:30)
                                     -> PopupHistoryClient.clearAll() via position/clear-all RPC.
                                     Removes the second direct chrome.storage.local writer.

src/chrome/storage/
  chrome-position-store.ts           UNCHANGED, RELOCATED IN USE — the existing
                                     chrome.storage.local adapter is now constructed SW-side
                                     (by background/position/store.ts) instead of CS-side.
                                     NOT deleted, NOT rewritten — no migration adapter needed.
```

## Test Strategy

### Unit (Vitest, pure)

- `store`: `get`/`set`/`remove` round-trip through the existing `chrome.storage.local` adapter against `sinon-chrome` (or the project's existing `chrome.storage.local` test double — the adapter already has #48 unit coverage to extend, not replace).
- `handlers`: each of the 6 types — popup types honor their params. The CS sender-binding **regression test has a mandatory assertion shape** (a weaker shape is a tautology that passes a leaking impl): seed a record at `forgedUrl`, seed a _different_ record at `senderUrl`, send `position/get` from a sender with `sender.url === senderUrl` carrying `payload.url === forgedUrl`, then assert `response === record(senderUrl)` **AND** `response !== record(forgedUrl)` **AND** no store read/write touched the `forgedUrl` key. Asserting only "no error" or only "equals senderUrl record" does not catch a handler that also leaks the forged record.
- `handlers` null path: a CS `position/get`/`set`/`clear` with `sender.url === undefined` or an `about:blank`/`data:` URL returns `Result.err` and performs **zero** store writes (assert the adapter was not touched — guards against the `"position:undefined"`-key poisoning path). The test must fail if the guard is removed.
- `access-gate`: asserts `chrome.storage.local.setAccessLevel` is called exactly once at module load with `{ accessLevel: 'TRUSTED_CONTEXTS' }`, **before** the store's first storage access (ordering), and that the call is feature-detected (no throw when `setAccessLevel` is absent — exercises the fallback branch).

### Integration (Vitest + `sinon-chrome`)

- Provenance: a content-script-shaped sender is **rejected at the gate** for every `POPUP_ONLY` position type and vice-versa, for all six types (extends the existing `on-message` gate tests). This is the gate-layer assertion that closes the type-confusion window — not only a handler-layer check.
- Cold-start: first `position/get` after a simulated SW restart resolves the persisted value (blocking-read path).

The cross-tab LRU-race fix is **not** asserted here: `sinon-chrome` dispatches both `sendMessage` calls in one event loop, so they serialize regardless of the fix (a `git stash` of the centralization still passes). It is proved by architecture (single module-scope writer) and covered at runtime only by the multi-tab E2E below.

### E2E (Playwright, loaded extension)

- Activate the reader on page A, advance, close; revisit A — resumes at the saved word.
- **The least-privilege / isolation assertion (the headline E2E):** after the SW has gated `local`, from a CS context on page B attempt `chrome.storage.local.get(null)` and `chrome.storage.local.get('position:<pageA-url>')` — confirm both fail (`chrome.runtime.lastError` set, no records returned), so neither page A's position nor any other origin's is reachable; and confirm there is no message type that requests another URL's position. This is the runtime proof of check 5 inside the real extension, not just the reproducer harness.
- Popup history lists both A and B after reading each; per-entry delete and clear-all work (and the popup keeps trusted access after the SW gate).
- Cross-tab LRU race (the runtime source of truth for the §Message-ordering fix): two real tabs write `position/set` for the same URL near-simultaneously; inspect the LRU index afterward for consistency (no dropped/divergent slot).

_(No migration crash-path E2E — there is no migration. The IDB direction's seed-legacy-keys / restart / assert-purged / assert-idempotent suite is deleted from scope.)_

### Empirical reproducer

- `experiments/idb-isolation-check/` — the precondition checks, run **inside this spec PR**, results recorded in this doc before merge (gates the Accepted flip). Check 5 is the load-bearing gate: SW gates `local`, a declared CS fails read/enum/write, the popup retains access.

## Acceptance Criteria

- The empirical reproducer (run inside this spec PR) confirms `setAccessLevel('TRUSTED_CONTEXTS')` blocks CS `local` access while the SW is alive (check 5) + `sender.url` population (check 2) + **the restriction holds while the SW is evicted (check 6)**; results recorded in this doc; Status → Accepted **on merge**. If any check fails, the spec does not merge as-is — it returns to Solution Design. _(Checks 5, 2, and 6 all green as of 2026-06-15, 13/13 in `npm run test:idb`.)_
- This spec PR merges (drafting-critic + ring + reproducer green) before any implementation dispatches.
- Impl PR delivers: the top-level `setAccessLevel` access-gate (feature-detected, **fail-closed** per §The Core Decision), the SW-module-scope store wired to the **existing** `chrome.storage.local` adapter, the 6 sender-bound/popup handlers wired into `route.ts` + `on-message.ts`, and the CS + popup + **options** message clients (the options page's `positionStore.clearAll()` at `options/index.ts:30` rebinds to the `position/clear-all` RPC — no trusted context remains a direct `local` writer). **No migration code** — assert in review that the impl adds none.
- **Impl-PR merge preconditions (from review):** (a) `manifest.ts` `minimum_chrome_version` is pinned to the verified `local.setAccessLevel` floor (≥119 expected; confirmed against Chrome release notes / a ≥119 harness build); (b) a unit test asserts the absent-`setAccessLevel` branch performs **zero** `position:*` writes (fail-closed, never permissive fallback to un-gated `local`). These close the only axis on which IDB beat the pivot.
- The impl comment at the `setAccessLevel` call records BOTH load-bearing invariants: (1) the no-`content_scripts` lazy-injection model is what closes the re-assertion window — adding a declared `content_scripts` entry requires revisiting §Lifecycle Hazards; (2) `local` is now SW-trusted-only by design — future CS-side `local` needs route through an RPC, never raw `chrome.storage.local`.
- Integration/unit tests prove provenance rejection at the gate for all six types, the **forged-URL regression in its mandatory assertion shape** (response is the sender's record AND not the forged record AND the forged key is untouched), the null/opaque-origin reject-no-write path, the access-gate ordering/feature-detect, and cold-start resume. The forged-URL test is merge-blocking — a weaker assertion does not satisfy it.
- The E2E isolation assertion passes: a CS on page B cannot `chrome.storage.local.get` any position after the SW gate (read + enumerate both fail), and no message type exposes another URL's position.
- **Recommended follow-up (non-blocking):** a once-per-Chrome-major manual smoke confirming the check-6 result under _natural_ idle-eviction (not CDP-stop) — see §Empirical Precondition check 3-faithfulness caveat.

## Out of Scope

- At-rest encryption / DevTools-inspection privacy (Q6) — separate feature, separate spec.
- Cross-device sync of positions (explicitly deferred in #48).
- SPA in-page route changes that diverge from the tab's committed URL — positions key off the canonical committed-frame URL, same behavior class as #48.
- Raising `POSITION_LRU_MAX` and the pagination it would require.
- Extension-origin IndexedDB as the backend (investigated, rejected in favor of `setAccessLevel` — see §The Core Decision; the IDB-isolation reproducer checks remain green in the harness as corroborating evidence only).
