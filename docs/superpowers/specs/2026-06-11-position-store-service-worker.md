# SW-Owned Reading-Position Store Spec

**Date:** 2026-06-11
**Status:** Proposed (2026-06-11)
**Issue:** [#196 — spec: move reading-position store into service worker (S3 follow-up to #48)](https://github.com/chriscantu/speedreader-chrome/issues/196)
**Milestone:** M3 (privacy hardening)
**Scope:** Close the cross-origin reading-history enumeration threat that PR #195's ring surfaced (S3, carved out of #48). Moves the reading-position store off `chrome.storage.local` and into a service-worker-private **IndexedDB** store. Content scripts and the popup become thin clients reaching the store only through sender-bound `sendMessage` RPCs. Composes with the messaging-contract (`2026-05-08-messaging-contract.md`) and SW-lifecycle (`2026-05-22-sw-lifecycle-activation.md`) specs by reference; does not modify them.

---

## Problem Statement

PR #195 shipped the #48 reading-position store as a content-script-owned wrapper over `chrome.storage.local`. The security-adversary critic (tier-2) flagged a privacy defect:

> A content script — injected on any page the user activates the reader on, via the `activeTab` user-gesture grant — can call `chrome.storage.local.get(null)` and enumerate every `position:<canonicalURL>` key, exfiltrating the user's **cross-origin** reading history to whatever site the reader was activated on.

S3 (the structural fix) was deferred from #195 to #196 after the fix-builder correctly argued that encryption is theater here: any AES-GCM key stored in `chrome.storage.local` is read by the same content script alongside the blobs, and any key stored in `chrome.storage.session` is **cleared on browser restart** — so while it survives SW idle-eviction, the encrypted blobs in `chrome.storage.local` outlive the key, leaving the data permanently unreadable after the next browser restart (fatal for a cross-session persistence feature). SHA-256 URL hashing is a public algorithm with zero obstruction value.

### Why moving the _abstraction_ to the SW is not enough

Issue #196 proposes "move the store into the SW; the SW owns the `chrome.storage.local` `position:*` keyspace; the CS simply has no read path." **This is insufficient on its central claim.** The `storage` permission is extension-wide (`manifest.ts:63` — `permissions: ['storage', ...]`); there is no per-context grant. A content script retains direct `chrome.storage.local` / `chrome.storage.sync` API access whether or not our store abstraction lives in the SW. It can call `chrome.storage.local.get(null)` and read the `position:*` keys regardless of who "owns" them.

The threat is closed only when the data lives in a store the content script's **API surface cannot reach** — not merely an abstraction it doesn't import.

### Least-privilege framing

The content script runs in proximity to untrusted page content (it is injected into arbitrary web origins via `activeTab`). It must not hold the capability to read other origins' positions. It needs exactly one thing: read/write/clear the position for **its own current page**. Everything else is excess privilege. This spec enforces that boundary structurally, at the storage layer and at the message gate.

## Constraints

- **MV3 service worker.** No persistent in-memory state across wake cycles. All listeners registered top-level, synchronously, before any `await` (per SW-lifecycle spec). The position store is reconstructed on each SW wake; durability lives in IndexedDB.
- **Persistence across browser sessions is the value proposition.** Any store that does not survive a browser restart is disqualified: in-memory SW state (wiped on every ~30 s idle-eviction) and `chrome.storage.session` (survives SW eviction, but cleared on browser restart) both fail.
- **CS-unreachable at the API layer.** The chosen backend must be inaccessible to a content script's execution context, not merely un-imported by it.
- **Compose, don't supersede.** The messaging-contract `Result<T, E>` envelope, the `Msg` registry source-of-truth (`src/core/messaging/types.ts`), and the SW-lifecycle sender-provenance gate (`background/messaging/on-message.ts`) are reused unchanged and extended additively.
- **`src/core/` boundary.** `core/storage/reading-position.ts` (the LRU/schema/serialization logic) stays free of `chrome.*` and is reused verbatim behind its `StorageAdapter` seam. The IndexedDB adapter and message glue live in `src/chrome/`.
- **Local-only.** No telemetry, no remote calls.
- **Structured-clone payloads only.** Same as the messaging-contract spec.

## The Core Decision — Storage Backend

| Candidate                                     | Survives browser restart?           | Reachable by content script?       | Verdict                                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chrome.storage.local`                        | yes                                 | **yes** (raw API)                  | rejected — the status quo defect                                                                                                                                               |
| `chrome.storage.sync`                         | yes                                 | **yes** (raw API)                  | rejected — same reach + quota limits                                                                                                                                           |
| `chrome.storage.session` (`TRUSTED_CONTEXTS`) | **no** (cleared on browser restart) | no (`setAccessLevel` gates out CS) | rejected — `setAccessLevel('TRUSTED_CONTEXTS')` _would_ close the CS enumeration threat (Chrome 112+), but positions vanish on browser restart, defeating cross-session resume |
| **Extension-origin IndexedDB**                | **yes**                             | **no**                             | **selected**                                                                                                                                                                   |

`chrome.storage.session` is the closest viable alternative and worth stating precisely: it is held in the browser process, so it survives SW idle-eviction (unlike in-memory SW state), and `setAccessLevel('TRUSTED_CONTEXTS')` does block content-script reads. It is rejected solely because it is cleared on browser restart — a "resume where you left off" feature that forgets every position when the user reopens Chrome fails its own value proposition.

IndexedDB is origin-scoped. The service worker's `indexedDB` is bound to the `chrome-extension://<id>` origin. A content script's `indexedDB` is bound to the **host page's** origin (content scripts get DOM/web-platform APIs in the page's origin, isolated world notwithstanding). The CS therefore has no handle to the SW's database. The only path from a content script to position data becomes a `sendMessage` to the SW — which this spec binds to the sender's own URL.

This decision is load-bearing on the IDB-isolation claim and is gated by the empirical reproducer below.

**All extension contexts share one IDB namespace.** The SW, popup, and options page all run under `chrome-extension://<id>`, so the popup's `position/list` reads the same database the SW writes — the cross-context composability the popup history surface depends on. The reproducer (below) confirms the inverse: the _content script_, running in the host-page origin, sees only the page's databases. Both directions must hold.

**Adapter connection discipline.** The IDB adapter opens the database connection **once** at module-scope store construction and caches it for the SW's lifetime; it does NOT `indexedDB.open()` per operation. Per-operation opens would race competing `onupgradeneeded` transactions on a fresh install and on any future schema bump (IDB blocks concurrent opens until an in-flight upgrade transaction completes). A single shared open-connection promise — awaited by every handler — serializes first-wake reads behind one upgrade and matches the single-store-instance concurrency model below.

## Actors and Ownership

```
Service Worker  (data owner — sole writer/reader of the IDB store)
  ├─ owns extension-origin IndexedDB database 'speedreader-positions'
  ├─ constructs ONE module-scope ReadingPositionStore wired to the IDB adapter
  ├─ position message handlers (sender-bound for CS, url-param for popup)
  └─ one-time migration: chrome.storage.local 'position:*' -> IDB, then purge local

Content Script  (thin client — least privilege)
  ├─ reaches ONLY its own page's position, via sender-bound RPC
  ├─ has NO message type that accepts a url parameter
  └─ debounced 1 Hz writes + pagehide/visibilitychange flush still apply

Popup  (trusted client — the user's own surface)
  ├─ lists / deletes-by-url / clears-all the full history
  └─ trusted because the user explicitly opened it to manage their history
```

## Sender-URL Binding — the Security Invariant

**A content-script position RPC derives its URL from `sender.url`, never from the message payload.** A content script's messages carry no URL field at all; the message types it is allowed to send have no `url` parameter in their wire shape. The SW reads the sending frame's own URL from the `MessageSender` and canonicalizes it.

- **Why `sender.url`, not `sender.tab.url`:** `sender.url` is the URL of the frame that sent the message — the CS's own page — and is populated by Chrome for any extension-internal message regardless of the `tabs` permission (which this extension does not hold). `sender.tab.url` can be redacted without `tabs`/host permission. Combined with the existing provenance gate's top-frame requirement (`sender.frameId === 0`, `on-message.ts:84`), `sender.url` is the top-frame page URL.
- **Why this is the teeth:** a hostile or compromised content script cannot ask for `victim.com`'s position because there is no message it can send that names a URL. Its reach is structurally pinned to the page it is already running on — which the user opted into via `activeTab`. Enumeration is impossible, not merely discouraged.
- **Load-bearing gate dependency (do not refactor away):** the `sender.url` guarantee for CS position handlers is contingent on two checks in `on-message.ts` running _before_ the handler — (a) the foreign-extension rejection (`sender.id !== chrome.runtime.id`), without which `sender.url` could be `undefined` for a cross-extension sender, and (b) the CS sender-shape gate (`sender.tab?.id !== undefined && sender.frameId === 0`), which keeps popup/options (`chrome-extension://` origin) senders out of CS-typed handlers. Removing either gate silently breaks the URL-binding security invariant. The impl PR must carry a comment at the handler binding `sender.url` pointing back to this dependency.
- **Popup is exempt by design:** `position/list`, `position/delete`, and `position/clear-all` carry a `url` (or no scoping at all) and are accepted only from popup-shaped senders. The popup is the user's own history-management surface; returning all URLs to it is the feature, not the threat.

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

This changes the call sites in `content/index.ts` (`positionStore.read(pageUrl)` → `client.read()`, etc.). The larger diff over keeping a `url` parameter is intentional: a `url`-accepting CS client would imply cross-URL reads work, the exact misconception the threat model forbids.

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

## Lifecycle Hazards

### Cold-start latency on first read (issue Q1)

The first `position/get` after an SW eviction pays cold-start (~50–200 ms wake + IDB open). Two options:

- **(A) Block first-word render on the read** (current #48 behavior: `await positionStore.read(pageUrl)` before mount, `content/index.ts:260`).
- **(B) Render at index 0 and patch to the saved index when the read resolves** — avoids the latency but flashes word 0 before jumping.

**Selected: (A), keep blocking.** Rationale: (1) resume-to-saved-position is the entire value proposition; flashing word 0 then jumping is more jarring than a sub-200 ms one-time delay on a cold SW; (2) a cold start happens at most once per ~30 s idle window, not per read; (3) ≤200 ms sits at/under the perception threshold for an intentional "resuming…" beat. The CS already guards persistence behind a feature check, so the blocking read is skipped entirely when persistence is unavailable. Option (B) is recorded as the escape hatch if cold-start ever measurably regresses.

### Message ordering during overlay mount (issue Q2) — and a bonus fix

The SW constructs **one** module-scope `ReadingPositionStore`. Every write from every tab serializes through that single instance's internal promise-queue (`reading-position.ts:176`). This is strictly stronger than #48, where each content script held its own queue that could not coordinate cross-tab — `reading-position.ts:167–175` documents the resulting cross-tab LRU-index divergence as a known limitation. **Centralizing the store in the SW closes that race**: two tabs writing near-simultaneously now enqueue on the same queue, so the LRU index read-modify-write no longer interleaves. Call this out in the impl PR as a resolved #48 limitation, not just a refactor.

### SW eviction mid-write

A debounced write dispatched as the SW is evicting either completes (SW stays alive for the in-flight message) or the `sendMessage` rejects; the CS's existing `.catch` swallows it (`content/index.ts:99,115`). Position writes are idempotent and best-effort — a dropped write loses at most one ~1 s increment of progress, re-established on the next advance. No correctness hazard.

## Perf Envelope (issue Q3, Q4)

- **Write rate:** every persisted advance becomes one CS→SW `sendMessage` round-trip + one IDB transaction, bounded by the existing 1 s write debounce (`POSITION_WRITE_DEBOUNCE_MS`). Sustainable at 1 Hz. **Constraint:** the debounce is load-bearing for this design; dropping it would turn per-word advances into per-word IPC + IDB writes. Documented as a guardrail.
- **List size:** `position/list` returns all entries, capped by `POSITION_LRU_MAX` (100). Fine for the popup history surface. Paginate only if the LRU cap is ever raised past ~1000.

## Migration (issue Q5 — corrected)

Contrary to the issue's "no schema change, ownership-only" framing, this is a **real one-time data migration**, because the backend changes (`chrome.storage.local` → IDB). The MV3 SW can be idle-killed at any step, so the ordering is **crash-safe by construction** — the marker is made durable _before_ the legacy keys are purged, and the purge is the last step:

1. On first SW activation after upgrade, check the `positions-migrated` marker in IDB. If present, short-circuit (done).
2. Read legacy `position:*` keys and `position-index` from `chrome.storage.local` via a one-shot adapter.
3. In **one IDB transaction**, write the copied records (same key shape and schema — `POSITION_SCHEMA_VERSION` unchanged) **and** the `positions-migrated` marker. The marker and the data commit atomically: either both land or neither does.
4. Only after the marker transaction has resolved (durable), **delete** the legacy keys from `chrome.storage.local`. This deletion is mandatory — leaving the keys behind preserves the exact enumeration path this spec exists to close.

Crash-safety by failure ordering:

- **Killed before step 3 commits:** no marker, no IDB data, legacy keys intact. Next wake re-runs from step 1 cleanly — the partial IDB transaction aborted, so there is nothing to resurrect.
- **Killed after step 3, before step 4:** marker + IDB data are durable; legacy keys still present. Next wake sees the marker and short-circuits — but the legacy keys were never purged, so a **purge-sweep also runs whenever the marker is present but legacy keys still exist** (idempotent best-effort cleanup), closing the enumeration window on the next wake. The marker short-circuit guards re-copy; it does NOT guard the purge.
- **Killed during step 4 (partial purge):** marker durable, some legacy keys remain. Same purge-sweep on next wake removes the stragglers.

The key correction over a naive design: writing the marker _last_ (after purge) would, if killed between copy and purge, leave a window where the next wake re-reads still-present legacy keys and re-copies stale data over fresher IDB records. Committing the marker _with_ the data and purging _after_ eliminates that window.

## Privacy Semantics That Survive (issue Q6)

The IDB store holds plaintext canonical URLs. A user who inspects the extension's IndexedDB via DevTools on `chrome-extension://<id>`, or who has the extension data extracted after corruption/uninstall, can still see their history. **That is out of scope.** The threat this spec closes is specifically _cross-origin enumeration from a content-script context the user opted into via `activeTab`_ — not at-rest disk privacy. At-rest encryption keyed to a user secret is a separate, larger feature (and still subject to the key-availability problem the #48 fix-builder identified).

## Empirical Precondition — IDB Isolation + `sender.url` Reproducer

Two facts are load-bearing. The entire backend decision is void if either fails, so the reproducer is a **precondition for merging this spec PR** — it runs _inside_ this PR and its results are recorded here before merge, gating the status flip to Accepted. No implementation PR dispatches until both checks pass. (Gating only "before the spec flips to Accepted" while leaving the impl PR free to dispatch in the Proposed window would let a multi-file IDB adapter + a production-data-purging migration be built before the claim that justifies them is confirmed — the expensive rollback this section exists to prevent. The sw-lifecycle spec's reproducer likewise blocked shipping, not just a status label.)

1. **A content script injected via `activeTab` cannot open the extension-origin IndexedDB.** Reproducer: SW writes a sentinel record to `speedreader-positions`; an injected CS attempts `indexedDB.open('speedreader-positions')` and `indexedDB.databases()`; confirm it sees the **host page's** databases, not the extension's, and cannot read the sentinel.
2. **`sender.url` is populated for a CS→SW message under `activeTab` without the `tabs` permission**, and equals the top-frame page URL. Reproducer: CS sends `position/get`; SW logs `sender.url`, `sender.frameId`, `sender.tab?.url`; confirm `sender.url` is the page URL and `frameId === 0`.

Reproducer lives at `experiments/idb-isolation-check/`. If (1) fails, the backend decision is void and the spec returns to Solution Design. If (2) fails, the binding falls back to `sender.tab.url` and the spec must add the `tabs` permission (with its own privacy review) or a CS-supplied-then-SW-validated URL scheme.

## Code Layout

```
src/core/
  storage/reading-position.ts        UNCHANGED — reused behind StorageAdapter
  messaging/types.ts                 + 6 position message types (additive)
  messaging/validate.ts              + narrowing for the 6 new types

src/chrome/background/
  position/idb-adapter.ts            NEW — StorageAdapter over extension-origin IDB
  position/store.ts                  NEW — module-scope ReadingPositionStore (IDB adapter + Date.now)
  position/handlers.ts               NEW — 6 message handlers; sender.url binding for CS types
  position/migrate.ts                NEW — one-time chrome.storage.local -> IDB + purge + marker
  route.ts                           + dispatch the 6 position/* types
  messaging/on-message.ts            + 3 types to CS_ONLY_TYPES, 3 to POPUP_ONLY_TYPES

src/chrome/content/
  position/client.ts                 NEW — ContentPositionClient over sendMessage
  index.ts                           rebind positionStore -> client (drop url args)

src/chrome/popup/
  position/client.ts                 NEW — PopupHistoryClient over sendMessage
  index.ts                           rebind store -> client (clear(url) -> delete(url))

src/chrome/storage/
  chrome-position-store.ts           DELETED — chrome.storage.local position adapter retired
                                     (its one-shot read survives only inside migrate.ts)
```

## Test Strategy

### Unit (Vitest, pure)

- `idb-adapter`: `get`/`set`/`remove` round-trip against `fake-indexeddb`; batched `get(keys[])` semantics match the `StorageAdapter` contract the core store expects.
- `handlers`: each of the 6 types — CS types derive URL from `sender.url` and **ignore any injected payload `url`** (regression test: a CS message carrying a forged `url` reads the sender's own position, never the forged one); popup types honor their params.
- `migrate`: legacy keys copied; marker + data commit atomically; purge runs only after the marker is durable; marker short-circuits re-copy on a second run; the purge-sweep still fires when the marker is present but legacy keys remain (kill-after-commit-before-purge ordering); kill-before-commit leaves nothing to resurrect.

**`fake-indexeddb` fidelity caveat.** `fake-indexeddb` does not model SW-kill / transaction-abort, `indexedDB.databases()` was unimplemented through 4.x (pin a version that supports it, or skip the enumeration assertion in unit and rely on E2E), and it does not reproduce real durability/eviction. The crash-ordering cases above are simulated by _explicit_ test scaffolding (abort the transaction, re-invoke the migration entrypoint), not by real process death — so the kill-mid-transaction guarantees are _additionally_ covered by the Playwright E2E reload path, which is the source of truth for crash behavior. Unit tests assert the _logic_ given a simulated abort; E2E asserts it under a real SW restart.

### Integration (Vitest + `sinon-chrome`)

- Provenance: a content-script-shaped sender is **rejected** for every `POPUP_ONLY` position type and vice-versa (extends the existing `on-message` gate tests).
- Cross-tab serialization: two concurrent `position/set` for the same URL produce a consistent LRU index (the #48 race, now fixed).
- Cold-start: first `position/get` after a simulated SW restart resolves the persisted value (blocking-read path).

### E2E (Playwright, loaded extension)

- Activate the reader on page A, advance, close; revisit A — resumes at the saved word.
- The least-privilege assertion: from a CS context on page B, attempt to read page A's position — confirm impossible (no message type exists to request it; raw IDB open sees only page B's origin).
- Popup history lists both A and B after reading each; per-entry delete and clear-all work.
- Migration crash path: seed legacy `position:*` keys in `chrome.storage.local`, trigger SW restart, assert positions appear in IDB AND `chrome.storage.local.get(null)` returns no `position:*` keys; restart again to confirm idempotency (no re-resurrection).

### Empirical reproducer

- `experiments/idb-isolation-check/` — the two precondition checks, run **inside this spec PR**, results recorded in this doc before merge (gates the Accepted flip). Check 1 also asserts the inverse composability: the **popup** opens the same `chrome-extension://<id>` IDB the SW wrote (so `position/list` is non-empty), while the **content script** sees only the host-page origin.

## Acceptance Criteria

- The empirical reproducer (run inside this spec PR) confirms IDB isolation + `sender.url` population; results recorded in this doc; Status → Accepted **on merge**. If either check fails, the spec does not merge as-is — it returns to Solution Design.
- This spec PR merges (drafting-critic + ring + reproducer green) before any implementation dispatches.
- Impl PR delivers: IDB `StorageAdapter`, SW-module-scope store, the 6 sender-bound/popup handlers wired into `route.ts` + `on-message.ts`, CS + popup message clients, and the one-time migration-with-purge.
- Integration tests prove provenance rejection across the CS/popup boundary, sender-URL binding (forged-payload regression), cross-tab serialization, and cold-start resume.
- The legacy `chrome.storage.local` `position:*` keys are purged post-migration — verified by a test asserting `chrome.storage.local.get(null)` returns no `position:*` keys after migration.

## Out of Scope

- At-rest encryption / DevTools-inspection privacy (Q6) — separate feature, separate spec.
- Cross-device sync of positions (explicitly deferred in #48).
- SPA in-page route changes that diverge from the tab's committed URL — positions key off the canonical committed-frame URL, same behavior class as #48.
- Raising `POSITION_LRU_MAX` and the pagination it would require.
