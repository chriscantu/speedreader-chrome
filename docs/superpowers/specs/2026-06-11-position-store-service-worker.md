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

`chrome.storage.session` is the closest viable alternative and worth stating precisely: it is held in the browser process, so it survives SW idle-eviction (unlike in-memory SW state), and `setAccessLevel('TRUSTED_CONTEXTS')` does block content-script reads (Chrome 112+). It is rejected solely because it is cleared on browser restart — a "resume where you left off" feature that forgets every position when the user reopens Chrome fails its own value proposition.

This rejection is load-bearing: it is the single fact that justifies the entire IDB direction over a far smaller `session` + `setAccessLevel` change. Per the [`chrome.storage.session` docs](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session) the area is in-memory and cleared when the browser shuts down. Because every downstream design element rests on it, the claim is **reproducer-gated alongside the IDB-isolation check** (§Empirical Precondition, check 3) — not merely asserted. If the reproducer shows `session` data surviving a real browser restart on the target Chrome, this rejection is void and the spec returns to Solution Design before any impl.

IndexedDB is origin-scoped. The service worker's `indexedDB` is bound to the `chrome-extension://<id>` origin. A content script's `indexedDB` is bound to the **host page's** origin (content scripts get DOM/web-platform APIs in the page's origin, isolated world notwithstanding). The CS therefore has no handle to the SW's database. The only path from a content script to position data becomes a `sendMessage` to the SW — which this spec binds to the sender's own URL.

This decision is load-bearing on the IDB-isolation claim and is gated by the empirical reproducer below.

**All extension contexts share one IDB namespace.** The SW, popup, and options page all run under `chrome-extension://<id>`, so the popup's `position/list` reads the same database the SW writes — the cross-context composability the popup history surface depends on. The reproducer (below) confirms the inverse: the _content script_, running in the host-page origin, sees only the page's databases. Both directions must hold.

**Adapter connection discipline.** The IDB adapter opens the database connection **once** at module-scope store construction (one wake cycle = one connection; the module re-evaluates and reopens on each SW wake) and caches the open-connection **promise**, not the resolved handle; it does NOT `indexedDB.open()` per operation. Per-operation opens would race competing `onupgradeneeded` transactions on a fresh install and on any future schema bump (IDB blocks concurrent opens until an in-flight upgrade transaction completes). **Every IDB operation MUST `await` the shared open-connection promise before touching the `IDBDatabase` handle — even on a warm SW** — because Chrome can deliver a queued message to a freshly-woken SW before the module's async `open()` resolves; a handler that assumes the handle is ready throws. The single shared promise — awaited by every handler AND by the migration entrypoint — serializes first-wake work behind one upgrade and matches the single-store-instance concurrency model below.

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
- **Null/opaque-origin URL → hard reject, no write.** If `canonicalizeUrl(sender.url)` returns `null` — `sender.url` absent (would only happen if the foreign-extension gate were bypassed), or an opaque-origin top frame (`about:blank`, `data:`), or a disallowed scheme — the handler MUST return `Result.err` and MUST NOT write. Without this guard a `null`/`undefined` URL could land under the literal IDB key `"undefined"`, silently poisoning the store. The canonicalizer already rejects non-http(s) schemes, so this is closing the _handler's_ response to that rejection, not re-deriving it. (Reproducer note: check 2 below must include an `about:blank` top frame to confirm the `null` path, not only a normal `https://` page.)
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

**The popup MUST use the RPC path, never a direct IDB open — this is normative, not stylistic.** The popup runs under `chrome-extension://<id>` and _could_ open the shared IDB directly (it is a trusted same-origin context, so this is not a security hole). It is forbidden anyway because `delete` and `clear-all` are _writes_ that mutate the shared LRU index: a popup writing directly would be a second writer racing the SW's module-scope queue, reintroducing exactly the cross-tab LRU-index divergence the single-writer design (§Message ordering) exists to close. Routing popup mutations through the SW keeps **one writer**. The "all extension contexts share one IDB namespace" note in §The Core Decision is a _correctness_ statement about the reproducer (the popup-side read in the reproducer confirms the namespace is shared), not a license to open IDB from the popup at runtime.

## Lifecycle Hazards

### Cold-start latency on first read (issue Q1)

The first `position/get` after an SW eviction pays cold-start (~50–200 ms wake + IDB open). Two options:

- **(A) Block first-word render on the read** (current #48 behavior: `await positionStore.read(pageUrl)` before mount, `content/index.ts:260`).
- **(B) Render at index 0 and patch to the saved index when the read resolves** — avoids the latency but flashes word 0 before jumping.

**Selected: (A), keep blocking — but gated on a measurement.** Rationale: (1) resume-to-saved-position is the entire value proposition; flashing word 0 then jumping is more jarring than a sub-200 ms one-time delay on a cold SW; (2) a cold start happens at most once per ~30 s idle window, not per read; (3) ≤200 ms sits at/under the perception threshold for an intentional "resuming…" beat. The CS already guards persistence behind a feature check, so the blocking read is skipped entirely when persistence is unavailable.

**The ~50–200 ms figure is a warm-extension estimate and the reproducer must confirm it.** First-ever activation pays an extra `onupgradeneeded` schema-creation transaction, and the **migration wake** (next §) reads up to 100 legacy records and writes them in one transaction _before_ the first `position/get` resolves — plausibly 300–500 ms on a slow disk with a full LRU. So the blocking default (A) is conditional: the empirical reproducer measures `position/get` round-trip at P95 on a low-end profile for (a) warm SW, (b) cold SW no migration, (c) cold SW + 100-record migration. **If case (c) P95 exceeds ~250 ms, the default flips to (B)** (render at 0, patch on resolve), OR migration moves off the first-read path (read legacy `chrome.storage.local` directly when the marker is absent, migrate asynchronously after the first render, so only the _second_ wake is IDB-backed). Recording the measurement is a merge-gate, not a post-hoc check.

### Message ordering during overlay mount (issue Q2) — and a side-effect

The SW constructs **one** module-scope `ReadingPositionStore`. Every write from every tab serializes through that single instance's internal promise-queue (`reading-position.ts:176`). This is strictly stronger than #48, where each content script held its own queue that could not coordinate cross-tab — `reading-position.ts:167–175` documents the resulting cross-tab LRU-index divergence as a known limitation. **Centralizing the store in the SW closes that race**: two tabs writing near-simultaneously now enqueue on the same queue, so the LRU index read-modify-write no longer interleaves.

This is a welcome side-effect, **proved by architecture** (single module-scope writer), not a #196 deliverable — it is NOT an acceptance criterion, and it is deliberately NOT asserted by a unit test: a `sinon-chrome` integration test dispatches both `sendMessage` calls in one event loop, so they serialize trivially whether or not the fix is present (the test passes even if the store is reverted to the CS — a `git stash` false-positive). The only runtime check that distinguishes broken from fixed is the multi-tab E2E (two real tabs, simultaneous writes, inspect IDB for LRU consistency); see Test Strategy.

### SW eviction mid-write

A debounced write dispatched as the SW is evicting either completes (SW stays alive for the in-flight message) or the `sendMessage` rejects; the CS's existing `.catch` swallows it (`content/index.ts:99,115`). Position writes are idempotent and best-effort — a dropped write loses at most one ~1 s increment of progress, re-established on the next advance. No correctness hazard.

## Perf Envelope (issue Q3, Q4)

- **Write rate:** every persisted advance becomes one CS→SW `sendMessage` round-trip + one IDB transaction, bounded by the existing 1 s write debounce (`POSITION_WRITE_DEBOUNCE_MS`). Sustainable at 1 Hz. **Constraint:** the debounce is load-bearing for this design; dropping it would turn per-word advances into per-word IPC + IDB writes. Documented as a guardrail.
- **Transactions per write:** the core store's `write` does a read-modify-write of the payload + the LRU index (`reading-position.ts:265–298`) — today expressed as separate `get`/`set`/`remove` calls, i.e. 4–5 sequential IDB transactions. The `StorageAdapter` `get`/`set`/`remove` seam cannot express a single atomic transaction. **Impl note:** the IDB adapter SHOULD batch the read-modify-write into one `readwrite` transaction; if the seam forbids it, consider extending `StorageAdapter` with a `transaction(ops)` / `readModifyWrite(key, fn)` method rather than paying 4–5 transactions per 1 Hz write. Not a blocker at 1 Hz single-tab; matters under multi-tab load.
- **Cross-tab queue:** the single module-scope promise-queue serializes _all_ tabs' writes, so N tabs each writing at 1 Hz give O(N) queue depth and O(N × IDB-RTT) tail latency for the last tab. Acceptable at the expected N (a handful of reading tabs). **Impl note:** if multi-tab tail latency regresses, shard the queue by canonical URL — mutations on distinct URLs are order-independent; only same-URL mutations and the shared LRU-index mutation need serialization. Recorded as an option, not required now.
- **List size:** `position/list` returns all entries, capped by `POSITION_LRU_MAX` (100). Fine for the popup history surface. Paginate only if the LRU cap is ever raised past ~1000.

## Migration (issue Q5 — corrected)

Contrary to the issue's "no schema change, ownership-only" framing, this is a **real one-time data migration**, because the backend changes (`chrome.storage.local` → IDB). The MV3 SW can be idle-killed at any step, so the ordering is **crash-safe by construction** — the marker is made durable _before_ the legacy keys are purged, and the purge is the last step.

**Trigger — every wake, not `onInstalled`.** "First SW activation after upgrade" is not a Chrome lifecycle event, and `chrome.runtime.onInstalled` fires exactly once at install/update — if the SW is idle-killed before the migration transaction commits, `onInstalled` will not fire again and the legacy data is stranded forever. So the migration entrypoint runs on **every SW wake**, at module top-level, chained onto the same shared IDB open-connection promise the store uses (NOT a separate `indexedDB.open()` — see §Code Layout). The `positions-migrated` marker makes this a cheap no-op on every wake after the copy succeeds; the marker-independent purge-sweep (below) still runs each wake until the legacy keys are gone.

1. On each SW wake, after the IDB connection resolves, check the `positions-migrated` marker. If present, skip the copy (run only the purge-sweep).
2. Read legacy `position:*` keys and `position-index` from `chrome.storage.local` via a one-shot adapter.
3. In **one IDB transaction**, write the copied records (same key shape and schema — `POSITION_SCHEMA_VERSION` unchanged) **and** the `positions-migrated` marker. The marker and the data commit atomically: either both land or neither does.
4. Only after the marker transaction has resolved (durable), **delete** the legacy keys from `chrome.storage.local`. This deletion is mandatory — leaving the keys behind preserves the exact enumeration path this spec exists to close.

Crash-safety by failure ordering:

- **Killed before step 3 commits:** no marker, no IDB data, legacy keys intact. Next wake re-runs from step 1 cleanly — the partial IDB transaction aborted, so there is nothing to resurrect.
- **Killed after step 3, before step 4:** marker + IDB data are durable; legacy keys still present. Next wake sees the marker and short-circuits the _re-copy_ — but **the purge-sweep is NOT gated by the marker**. On every wake, after the marker short-circuit, the migration module runs a sweep: `chrome.storage.local.get(null)`, filter keys by the `position:` prefix (plus `position-index`), and `remove` any that remain. The sweep is idempotent and cheap when empty. This is the detection path the spec REQUIRES — not an impl suggestion — because without it an impl that "runs migration once and marks done" leaves the legacy keys enumerable, and the single-run acceptance test would still pass. (`chrome.storage.local` has no prefix-scan API; `get(null)` is the only enumeration path, run once per wake on the SW, off the user-facing hot path.)
- **Killed during step 4 (partial purge):** marker durable, some legacy keys remain. The same marker-independent sweep on the next wake removes the stragglers.

The key correction over a naive design: writing the marker _last_ (after purge) would, if killed between copy and purge, leave a window where the next wake re-reads still-present legacy keys and re-copies stale data over fresher IDB records. Committing the marker _with_ the data, purging _after_, and running the purge-sweep _independent of_ the marker together eliminate both the re-copy window and the never-purged window.

**`chrome.storage.sync` needs no sweep.** No code path has ever written `position:*` to `.sync` — positions were `.local`-only in #48 (`chrome-position-store.ts`), and `.sync` carries only settings (`settings/storage.ts`). Confirmed by grep at spec time; the impl PR re-confirms before relying on it.

**Pre-purge window is accepted residual risk, not a gap.** Between the first IDB write and sweep completion, the legacy keys are briefly still present and still enumerable. Closing that window to zero would require an atomic cross-store transaction Chrome does not offer. The window is one SW wake wide, best-effort-closed on the very next wake, and is explicitly accepted — a reviewer should not gate on a zero-window guarantee the spec deliberately does not make.

## Privacy Semantics That Survive (issue Q6)

The IDB store holds plaintext canonical URLs. A user who inspects the extension's IndexedDB via DevTools on `chrome-extension://<id>`, or who has the extension data extracted after corruption/uninstall, can still see their history. **That is out of scope.** The threat this spec closes is specifically _cross-origin enumeration from a content-script context the user opted into via `activeTab`_ — not at-rest disk privacy. At-rest encryption keyed to a user secret is a separate, larger feature (and still subject to the key-availability problem the #48 fix-builder identified).

## Empirical Precondition — IDB Isolation + `sender.url` Reproducer

Two facts are load-bearing. The entire backend decision is void if either fails, so the reproducer is a **precondition for merging this spec PR** — it runs _inside_ this PR and its results are recorded here before merge, gating the status flip to Accepted. No implementation PR dispatches until both checks pass. (Gating only "before the spec flips to Accepted" while leaving the impl PR free to dispatch in the Proposed window would let a multi-file IDB adapter + a production-data-purging migration be built before the claim that justifies them is confirmed — the expensive rollback this section exists to prevent. The sw-lifecycle spec's reproducer likewise blocked shipping, not just a status label.)

1. **A content script injected via `activeTab` cannot open the extension-origin IndexedDB.** Reproducer: SW writes a sentinel record to `speedreader-positions`; an injected CS calls `indexedDB.open('speedreader-positions')`. **Objective pass criterion:** `onupgradeneeded` fires with `event.oldVersion === 0` — i.e. the database does not exist in the CS's origin — and the CS reads no sentinel. (Do NOT rely on `indexedDB.databases()` returning empty as the criterion; the `oldVersion === 0` check is unambiguous and not subject to `databases()` quirks.) The inverse composability check runs from the **popup**: `position/list` via RPC returns the SW-written records, confirming popup and SW share the `chrome-extension://<id>` namespace.
2. **`sender.url` is populated for a CS→SW message under `activeTab` without the `tabs` permission**, and equals the top-frame page URL. Reproducer: CS sends `position/get`; SW logs `sender.url`, `sender.frameId`, `sender.tab?.url`; confirm `sender.url` is the page URL and `frameId === 0`. **Also run against an `about:blank` top frame** to confirm the opaque-origin path yields a `null`-canonicalizing URL that the handler rejects (per the null/opaque-origin guard in §Sender-URL Binding), not a silent write.
3. **`chrome.storage.session` does NOT survive a real browser restart.** Reproducer: write a record to a `session`-backed store, fully quit and relaunch Chrome, confirm the record is absent. This gates the rejection that justifies the IDB direction over the cheaper `session` + `setAccessLevel` alternative (§The Core Decision).

Reproducer lives at `experiments/idb-isolation-check/`. If (1) fails, the backend decision is void and the spec returns to Solution Design. If (2) fails, the binding falls back to `sender.tab.url` and the spec must add the `tabs` permission (with its own privacy review) or a CS-supplied-then-SW-validated URL scheme. If (3) fails (`session` survives restart), the `session` + `setAccessLevel` path may be sufficient and the IDB direction is re-opened before any impl.

## Code Layout

```
src/core/
  storage/reading-position.ts        UNCHANGED — reused behind StorageAdapter
  messaging/types.ts                 + 6 position message types (additive)
  messaging/validate.ts              + narrowing for the 6 new types

src/chrome/background/
  position/idb-adapter.ts            NEW — StorageAdapter over extension-origin IDB;
                                     owns the single shared open-connection promise
  position/store.ts                  NEW — module-scope ReadingPositionStore (IDB adapter + Date.now)
  position/handlers.ts               NEW — 6 message handlers; sender.url binding for CS types
  position/migrate.ts                NEW — one-time chrome.storage.local -> IDB + purge + marker.
                                     RECEIVES the shared IDB connection from idb-adapter/store —
                                     MUST NOT call indexedDB.open() itself (would race onupgradeneeded)
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
- `handlers`: each of the 6 types — popup types honor their params. The CS sender-binding **regression test has a mandatory assertion shape** (a weaker shape is a tautology that passes a leaking impl): seed a record at `forgedUrl`, seed a _different_ record at `senderUrl`, send `position/get` from a sender with `sender.url === senderUrl` carrying `payload.url === forgedUrl`, then assert `response === record(senderUrl)` **AND** `response !== record(forgedUrl)` **AND** no IDB write/read touched the `forgedUrl` key. Asserting only "no error" or only "equals senderUrl record" does not catch a handler that also leaks the forged record.
- `handlers` null path: a CS `position/get`/`set`/`clear` with `sender.url === undefined` or an `about:blank`/`data:` URL returns `Result.err` and performs **zero** IDB writes (assert the store was not touched — guards against the `"undefined"`-key poisoning path). The test must fail if the guard is removed.
- `migrate`: legacy keys copied; marker + data commit atomically; purge runs only after the marker is durable; marker short-circuits re-copy on a second run; the marker-independent purge-sweep fires when the marker is present but legacy keys remain (kill-after-commit-before-purge) and when only _some_ legacy keys remain (kill-during-partial-purge — seed marker + full IDB data + 3-of-5 legacy keys, re-invoke, assert all 5 gone); kill-before-commit leaves nothing to resurrect. These are **logic** assertions given a _simulated_ abort — see the fidelity caveat; the real-process-death guarantee is the E2E.

**`fake-indexeddb` fidelity caveat.** `fake-indexeddb` does not model SW-kill / transaction-abort, `indexedDB.databases()` was unimplemented through 4.x (pin a version that supports it, or skip the enumeration assertion in unit and rely on E2E), and it does not reproduce real durability/eviction. The crash-ordering cases above are simulated by _explicit_ test scaffolding (abort the transaction, re-invoke the migration entrypoint), not by real process death — so the kill-mid-transaction guarantees are _additionally_ covered by the Playwright E2E reload path, which is the source of truth for crash behavior. Unit tests assert the _logic_ given a simulated abort; E2E asserts it under a real SW restart.

### Integration (Vitest + `sinon-chrome`)

- Provenance: a content-script-shaped sender is **rejected at the gate** for every `POPUP_ONLY` position type and vice-versa, for all six types (extends the existing `on-message` gate tests). This is the gate-layer assertion that closes the type-confusion window — not only a handler-layer check.
- Cold-start: first `position/get` after a simulated SW restart resolves the persisted value (blocking-read path).

The cross-tab LRU-race fix is **not** asserted here: `sinon-chrome` dispatches both `sendMessage` calls in one event loop, so they serialize regardless of the fix (a `git stash` of the centralization still passes). It is proved by architecture (single module-scope writer) and covered at runtime only by the multi-tab E2E below.

### E2E (Playwright, loaded extension)

- Activate the reader on page A, advance, close; revisit A — resumes at the saved word.
- The least-privilege assertion: from a CS context on page B, attempt to read page A's position — confirm impossible (no message type exists to request it; raw IDB open sees only page B's origin).
- Popup history lists both A and B after reading each; per-entry delete and clear-all work.
- Migration crash path: seed legacy `position:*` keys in `chrome.storage.local`, trigger SW restart, assert positions appear in IDB AND `chrome.storage.local.get(null)` returns no `position:*` keys; restart again to confirm idempotency (no re-resurrection). Partial-purge variant: seed a `positions-migrated` marker + full IDB data + a _subset_ of legacy keys (simulating a kill mid-purge), restart, assert the purge-sweep clears the stragglers.
- Cross-tab LRU race (the runtime source of truth for the §Message-ordering fix): two real tabs write `position/set` for the same URL near-simultaneously; inspect the IDB LRU index afterward for consistency (no dropped/divergent slot).

### Empirical reproducer

- `experiments/idb-isolation-check/` — the two precondition checks, run **inside this spec PR**, results recorded in this doc before merge (gates the Accepted flip). Check 1 also asserts the inverse composability: the **popup** opens the same `chrome-extension://<id>` IDB the SW wrote (so `position/list` is non-empty), while the **content script** sees only the host-page origin.

## Acceptance Criteria

- The empirical reproducer (run inside this spec PR) confirms IDB isolation + `sender.url` population; results recorded in this doc; Status → Accepted **on merge**. If either check fails, the spec does not merge as-is — it returns to Solution Design.
- This spec PR merges (drafting-critic + ring + reproducer green) before any implementation dispatches.
- Impl PR delivers: IDB `StorageAdapter`, SW-module-scope store, the 6 sender-bound/popup handlers wired into `route.ts` + `on-message.ts`, CS + popup message clients, and the one-time migration-with-purge.
- Integration/unit tests prove provenance rejection at the gate for all six types, the **forged-URL regression in its mandatory assertion shape** (response is the sender's record AND not the forged record AND the forged key is untouched), the null/opaque-origin reject-no-write path, and cold-start resume. The forged-URL test is merge-blocking — a weaker assertion does not satisfy it.
- The legacy `chrome.storage.local` `position:*` keys (and `position-index`) are gone after migration completes — verified by a test asserting `chrome.storage.local.get(null)` returns no `position:`-prefixed keys, including after the marker-present partial-purge path. The pre-purge window (§Migration) is accepted residual risk, explicitly not a zero-window guarantee.

## Out of Scope

- At-rest encryption / DevTools-inspection privacy (Q6) — separate feature, separate spec.
- Cross-device sync of positions (explicitly deferred in #48).
- SPA in-page route changes that diverge from the tab's committed URL — positions key off the canonical committed-frame URL, same behavior class as #48.
- Raising `POSITION_LRU_MAX` and the pagination it would require.
