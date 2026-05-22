# SW Lifecycle + Activation-Trigger Spec

**Date:** 2026-05-22
**Status:** Proposed
**Issue:** [#105 — Design: SW lifecycle + unified activation-trigger architecture (unblocks #34 + #72)](https://github.com/chriscantu/speedreader-chrome/issues/105)
**Milestone:** M1 (MVP parity)
**Scope:** Pin the SW lifecycle + activation-dispatch layer beneath the existing messaging-contract spec. Defines registration discipline, the unified `dispatchActivation` funnel, the `activate-reader` RPC, restricted-URL guard, state-recovery contract, and sender-provenance validation.

---

## Problem Statement

Three activation surfaces (`chrome.commands` for #34, `chrome.contextMenus` for #72, popup) must reach the existing read-session wire defined in `2026-05-08-messaging-contract.md`. Without a pinned dispatch layer:

- Each source grows its own injection path, restricted-URL guard, and session bootstrap, drifting from the spec.
- The MV3 service worker's idle-kill behavior (and the popup's close-on-blur behavior) silently break activations that span more than one event-loop tick.
- Sender-provenance validation is absent — any content script can spoof popup-only commands by sending `{type: 'POPUP_ACTIVATE'}` to the SW.
- Storage rehydration after SW idle-kill trusts disk contents without re-validation.

This spec pins the activation layer **without modifying** the messaging-contract, article-extraction, or lazy-injection specs. It composes by reference; existing acceptance criteria from those specs continue to hold.

## Constraints

- **MV3 service worker.** No persistent in-memory state across wake cycles. All listeners registered top-level, synchronously, before any `await`.
- **Lazy injection.** Per the lazy-injection ADR, no `host_permissions` and no eager `content_scripts`. The SW injects the CS on demand via `chrome.scripting.executeScript`.
- **Compose, don't supersede.** The messaging-contract spec's vocabulary (`extract-summary`, `start-read`, `pause`, `resume`, `stop`, `overlay-state`, `settings-changed`), `Result<T>` envelope, and `rsvp-session` Port are unchanged. Activation adds ONE new one-shot RPC: `activate-reader`.
- **Local-only.** No telemetry, no remote dispatch, no analytics.
- **Structured-clone payloads only.** Same constraint as the messaging-contract spec.
- **`src/core/` boundary.** The restricted-URL predicate and activation-intent types live in `src/core/` (no `chrome.*`). Chrome adapters live in `src/chrome/background/`.

## Listener Registration Discipline

All `chrome.*` listeners MUST be registered at module top-level, synchronously, before any `await` or dynamic import. This is the load-bearing MV3 invariant — a listener registered inside an async callback after the first `await` is invisible to Chrome on subsequent wakes.

`src/chrome/background/index.ts` shape:

```ts
// Runs on EVERY wake. Top-level synchronous registration.
import { dispatchActivation } from './activation';
import { handleSwMessage } from './messages';
import { ensureContextMenu } from './context-menu';
import { handleRsvpSessionConnect } from './session';

chrome.runtime.onInstalled.addListener(ensureContextMenu);
chrome.runtime.onStartup.addListener(ensureContextMenu);

chrome.commands.onCommand.addListener((command, tab) =>
  dispatchActivation({ source: 'command', command, tab }));

chrome.contextMenus.onClicked.addListener((info, tab) =>
  dispatchActivation({ source: 'contextMenu', info, tab }));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleSwMessage(msg, sender, sendResponse);
  return true; // async response
});

chrome.runtime.onConnect.addListener(handleRsvpSessionConnect);

chrome.storage.onChanged.addListener(/* settings broadcast — see messaging-contract spec */);
```

No `init()` function. No async wrapper. No top-level `await`. If a future maintainer wants conditional registration, they MUST do it via predicates inside the listener body, never by gating the `addListener` call itself.

## Unified Activation Dispatch

### Activation intent shape

`src/core/activation/types.ts` (pure, no `chrome.*`):

```ts
export type ActivationSource = 'command' | 'contextMenu' | 'popup';

export interface ActivationIntent {
  source: ActivationSource;
  tabId: number;
  scope: 'selection' | 'full';
  // NOTE: no `selectionHint`. The CS reads the live selection at injection time.
  // See §"Context-menu selection trust" below.
}
```

### Dispatch funnel

`src/chrome/background/activation.ts`:

```ts
interface RawCommandInput  { source: 'command';     command: string; tab?: chrome.tabs.Tab; }
interface RawMenuInput     { source: 'contextMenu'; info: chrome.contextMenus.OnClickData; tab?: chrome.tabs.Tab; }
interface RawPopupInput    { source: 'popup';       tabId: number;  scope: 'selection' | 'full'; }

export async function dispatchActivation(
  raw: RawCommandInput | RawMenuInput | RawPopupInput,
): Promise<void> {
  const intent = normalizeIntent(raw);
  if (!intent) return;                                       // unknown command / no tab — drop silently

  const url = await getTabUrl(intent.tabId);
  if (isRestrictedUrl(url)) {
    await surfaceRestricted(intent);                         // see §Restricted-URL guard
    return;
  }

  await ensureContentScript(intent.tabId);                   // idempotent, see §Idempotent injection
  const result = await sendActivateReader(intent);           // see §`activate-reader` RPC
  if (!result.ok) await surfaceActivationFailure(intent, result.reason);
}
```

`normalizeIntent` is the single seam between source-specific raw input and the uniform `ActivationIntent`. Command source maps `_toggle_reader` → `{scope: 'full'}`; contextMenu source maps `contexts: ['selection']` → `{scope: 'selection'}`; popup source already passes structured input.

## `activate-reader` — the new one-shot RPC

Added to `src/core/messaging/types.ts` as one new entry in the existing `Msg` union; all other entries unchanged:

```ts
// New in this spec — activation handoff from SW to CS
| { type: 'activate-reader'; scope: 'selection' | 'full' }
```

| Type              | Source | Target | Transport     | Payload                        | Response                           |
| ----------------- | ------ | ------ | ------------- | ------------------------------ | ---------------------------------- |
| `activate-reader` | SW     | CS     | `sendMessage` | `{ scope }`                    | `Result<{ openedFresh: boolean }>` |

**Semantics:**

- `openedFresh: true` — CS injected this wake; no prior reader instance on this tab.
- `openedFresh: false` — CS already had a reader instance (e.g., user re-fires the hotkey on a tab where the reader is already mounted). The popup, if originating the dispatch, can use this to render the existing session state instead of treating it as a fresh start.

**Hand-off to the read-session wire:**

`activate-reader` is one-shot, not a Port. After the CS acknowledges, the popup (or the user, via overlay controls) opens the `rsvp-session` Port per the messaging-contract spec. Activation creates the reader instance; the Port carries `start-read` / `pause` / `resume` / `stop` / `overlay-state` per the existing contract. **The Port-keepalive model from the messaging-contract spec is unchanged.**

The popup-source dispatch path is:

1. Popup sends `activate-reader` via `chrome.runtime.sendMessage` (handled by the SW's unified `onMessage`).
2. SW runs `dispatchActivation({source: 'popup', ...})`.
3. SW injects CS (idempotent), sends `activate-reader` via `chrome.tabs.sendMessage` to the CS, awaits `Result`.
4. SW returns the `Result` to the popup.
5. Popup, on success, opens `rsvp-session` Port and sends `start-read` per the messaging-contract spec.

Command-source and contextMenu-source paths are the same, minus step 5 — they hand off to the CS, which auto-starts the read session by opening its own end of the Port routed through the SW. (The messaging-contract spec already permits CS-originated Port opens; the popup is not the only Port initiator.)

## Sender-Provenance Validation

### Manifest

The manifest MUST NOT declare `externally_connectable`. Stated explicitly in `src/chrome/manifest.ts`:

```ts
// NO externally_connectable. Web origins MUST NOT reach our onMessage / onConnect.
// (Default behavior of MV3 is to deny; this comment guards against future churn.)
```

### `onMessage` handler

`src/chrome/background/messages.ts`:

```ts
export function handleSwMessage(
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (resp: Result<unknown>) => void,
): void {
  if (sender.id !== chrome.runtime.id) {                     // other extensions
    sendResponse({ ok: false, reason: 'sender-rejected' });
    return;
  }
  const validated = validateMsg(msg);                        // discriminated-union schema
  if (!validated.ok) {
    sendResponse({ ok: false, reason: 'invalid-payload', details: validated.reason });
    return;
  }
  // Per-type sender-shape assertions:
  switch (validated.data.type) {
    case 'extract-summary':
    case 'restricted-url-probe':
      // popup-originated: sender.tab undefined, sender.url is extension URL
      if (sender.tab !== undefined ||
          !sender.url?.startsWith(chrome.runtime.getURL(''))) {
        sendResponse({ ok: false, reason: 'sender-shape-mismatch' });
        return;
      }
      break;
    // CS-originated messages (e.g., post-MVP CS→SW signals) MUST require
    // sender.tab?.id and sender.frameId === 0 (for full-page scope).
  }
  routeMsg(validated.data, sender, sendResponse);
}
```

### Payload validation

Discriminated-union schema validation lives in `src/core/messaging/validate.ts`. Hand-rolled exhaustive narrowing OR `zod` — implementation choice; either way, NO `as` casts on the wire. Add a CI grep: `src/core/messaging/**/*.ts` must not contain `as Msg` or `as unknown as`.

### `onConnect` handler

Same provenance rules, applied to `port.sender`:

```ts
export function handleRsvpSessionConnect(port: chrome.runtime.Port): void {
  if (port.name !== 'rsvp-session-v1') { port.disconnect(); return; }   // closed allowlist
  if (port.sender?.id !== chrome.runtime.id) { port.disconnect(); return; }
  if (port.sender.tab?.id === undefined) { port.disconnect(); return; }
  if (port.sender.frameId !== 0) { port.disconnect(); return; }         // top-frame only
  enforcePortLimits(port);                                              // max 1 per tab; max 4h duration
  routeRsvpPort(port);                                                  // hand off to messaging-contract spec's session router
}
```

Port `name` is bumped from the messaging-contract spec's `'rsvp-session'` to `'rsvp-session-v1'` to reserve a versioned allowlist for future protocol changes. **This is the only change to the messaging-contract spec's wire**, and it is a name-only change — frame vocabulary is unchanged. Spec PR cross-references this in the messaging-contract spec via a "See also" footnote, not a body edit.

## Restricted-URL Guard

`src/core/restricted.ts` (pure, no `chrome.*`):

```ts
const RESTRICTED_SCHEMES = new Set([
  'chrome:', 'chrome-untrusted:', 'chrome-search:',
  'devtools:', 'view-source:', 'about:',
  'data:', 'javascript:', 'file:', 'blob:', 'edge:',
]);

const RESTRICTED_HOSTS = new Set([
  'chromewebstore.google.com',
  'chrome.google.com',  // historical Web Store hostname
]);

export function isRestrictedUrl(rawUrl: string | undefined, ownExtensionId: string): boolean {
  if (!rawUrl) return true;
  let url: URL;
  try { url = new URL(rawUrl); } catch { return true; }
  if (RESTRICTED_SCHEMES.has(url.protocol)) return true;
  if (url.protocol === 'chrome-extension:') {
    // Allow our own extension URLs (popup, options); deny all others.
    return url.hostname !== ownExtensionId;
  }
  if (url.protocol === 'https:' && RESTRICTED_HOSTS.has(url.hostname)) return true;
  return false;
}
```

**Call sites (four):**

1. `dispatchActivation` — gate before any `executeScript` attempt.
2. `chrome.contextMenus.create({documentUrlPatterns})` — derived from the inverse of `RESTRICTED_SCHEMES`, so the menu doesn't render on restricted pages. Defense in depth.
3. `chrome.scripting.executeScript` rejection conversion — catches the case where a URL changes between guard check and inject (TOCTOU); converts the rejection to `Result<{ok: false, reason: 'restricted-page'}>`.
4. CS-side activation handler — early-returns when `document.activeElement` is in a focused input (see §Focused-input guard) OR when `location.href` passes the guard (subframe self-check for selection-scope activations from non-top frames).

**Subframe handling:** `chrome.runtime.onMessage` from a CS in `sender.frameId !== 0` means the message originated from a subframe whose origin can differ from `sender.tab.url`. The unified handler rejects full-page-scope activations from non-top frames (`frameId !== 0`). Selection-scope activations from subframes are allowed only when the subframe's own URL (passed in the activation payload AND re-validated server-side via `chrome.webNavigation.getFrame`) passes `isRestrictedUrl`.

## State Recovery After SW Idle-Kill

**Threat model:** user opens reader → SW goes idle (between activations, not during a Port-active read session) → user issues second activation → SW wakes fresh, has no in-memory session.

**Storage tiers:**

| State | Location | Rationale |
|---|---|---|
| User settings (WPM, font, theme, etc.) | `chrome.storage.local` | Cross-restart, canonical. Per settings-schema spec. |
| Per-tab active reader session | `chrome.storage.session` | Cleared on browser restart (correct: yesterday's position is meaningless). Requires Chrome 102+. |
| Activation correlation IDs, in-flight injection promises | In-memory `Map` | Acceptable to lose; CS is source of truth for "am I still showing the reader." |
| Context-menu item IDs | Recreated in `onInstalled`/`onStartup` | Never persisted. |

**Manifest `minimum_chrome_version`:** `"116"`. Chosen to align with the Chrome 116+ strict-idle enforcement noted in the messaging-contract spec. No conditional fallback to `storage.local` for sessions — single tier, single code path.

### `ReaderSession` schema (persisted form)

`src/core/activation/session.ts`:

```ts
export interface ReaderSession {
  tabId: number;
  scope: 'selection' | 'full';
  wpm: number;
  positionIndex: number;
  sourceHash: string;       // hash(document.title + location.href + tokenCount)
  startedAt: number;        // ms epoch
  schemaVersion: 1;
}

// NOTE: NO `selectionText`. PII risk; CS re-extracts on resume.
```

Persisted under `session:v1:<tabId>` keys (versioned namespace).

### Rehydration contract

On any incoming message for a tab the SW has no in-memory record of:

1. SW reads `session:v1:<tabId>` from `chrome.storage.session`.
2. **Re-validates against `ReaderSession` schema** — same validator used on the wire. Reject + drop the key on failure; fall through to fresh activation.
3. **Bounds-check** `wpm` (100–600, per settings-schema spec) and `positionIndex` (≥0, finite, integer). Out-of-bounds → drop + fresh.
4. Rehydrates an in-memory entry, **acquires the rehydrate-lock** (see §Concurrent-rehydrate race), proceeds.
5. On wake from any path, run `purgeStaleSessions()` — drop entries where `Date.now() - startedAt > 24h`.

### `sourceHash` resume gate

CS computes `sourceHash` on every `start-read` AND on resume:

```
sourceHash = sha1(document.title + '|' + location.href + '|' + tokenCount).slice(0, 16)
```

(SHA-1 via `crypto.subtle.digest`; 16 hex chars sufficient for collision protection at this scale.)

On resume, the SW sends the persisted `sourceHash` in the `activate-reader` payload. The CS compares against its freshly-computed hash:

- Match → CS resumes at `positionIndex`.
- Mismatch → CS starts fresh (`positionIndex: 0`), SW updates `chrome.storage.session` with the new hash. User sees a fresh read; their old position on the old content is dropped (the content moved out from under them anyway).

## Concurrent-Rehydrate Race

SW can wake from multiple events simultaneously (e.g., `chrome.tabs.onUpdated` + `chrome.runtime.onMessage`). Without serialization, two messages from the same tab can both read storage, both decide "no in-memory entry, rehydrate," both write back divergent state.

`src/chrome/background/session-locks.ts`:

```ts
const rehydrateLocks = new Map<number, Promise<ReaderSession | undefined>>();
const writeLocks = new Map<number, Promise<void>>();

export function rehydrateOnce(tabId: number): Promise<ReaderSession | undefined> {
  let existing = rehydrateLocks.get(tabId);
  if (existing) return existing;
  const p = doRehydrate(tabId).finally(() => rehydrateLocks.delete(tabId));
  rehydrateLocks.set(tabId, p);
  return p;
}

export function persistSession(tabId: number, session: ReaderSession): Promise<void> {
  // Per-tab serialized queue; chain on previous write
  const prev = writeLocks.get(tabId) ?? Promise.resolve();
  const next = prev.then(() => doPersistWithCas(tabId, session));
  writeLocks.set(tabId, next.finally(() => {
    if (writeLocks.get(tabId) === next) writeLocks.delete(tabId);
  }));
  return next;
}

async function doPersistWithCas(tabId: number, incoming: ReaderSession): Promise<void> {
  // Compare-and-swap on monotonic positionIndex — never accept regression
  const current = await readSession(tabId);
  if (current && incoming.positionIndex < current.positionIndex) return;     // drop regression
  await writeSession(tabId, incoming);
}
```

The CAS rule is critical: a delayed `CONTENT_PROGRESS`-equivalent write (sent at, say, `positionIndex: 47`) must NEVER overwrite a fresher value (e.g., `positionIndex: 52` that arrived first).

## Idempotent Content-Script Injection

Two layers, both required:

### SW-side: in-flight promise dedup

```ts
const injectionLocks = new Map<number, Promise<void>>();

export async function ensureContentScript(tabId: number): Promise<void> {
  // Reuse in-flight injection
  let inFlight = injectionLocks.get(tabId);
  if (inFlight) return inFlight;

  const p = doInject(tabId).finally(() => injectionLocks.delete(tabId));
  injectionLocks.set(tabId, p);
  await p;

  // Confirm presence with fast PING (CS sentinel may have survived an SW restart
  // while the map entry didn't)
  const pong = await sendPing(tabId, { timeoutMs: 1500 });
  if (!pong.ok) throw new Error('ensureContentScript: CS did not respond after inject');
}
```

### CS-side: top-level sentinel

`src/chrome/content/index.ts`:

```ts
declare global {
  interface Window { __SPEEDREADER_INJECTED__?: true }
}

if (window.__SPEEDREADER_INJECTED__) {
  // Already injected this page; bail before re-registering listeners.
  // The SW will discover this via the PING in ensureContentScript().
} else {
  window.__SPEEDREADER_INJECTED__ = true;
  // ...register listeners, initialize state, etc.
}
```

Both layers are required: the SW map handles same-wake double-dispatch; the window sentinel handles the case where `chrome.scripting.executeScript` re-runs the script on an already-injected page (which Chrome will do — it does NOT auto-dedupe).

## PING Timeout — Non-Destructive Resume

`sendPing(tabId, opts)` rules:

- **Default timeout:** 1500ms (matches messaging-contract spec AC #7).
- **On timeout:** distinguish "CS unreachable" (re-inject path) from "CS slow":
  - If the CS responded to any prior message in the last 5s → treat as slow; retry once with 3000ms budget.
  - Else → re-inject.
- **Resume policy:** **preserve position on uncertainty, reset only on confirmed absence.** Never overwrite `positionIndex` to 0 because of a single PING miss.

## Context-Menu Selection Trust

`info.selectionText` from `chrome.contextMenus.onClicked` is page-controlled (selection-change race, ~150-char truncation, zero-width / bidi injection). The dispatch layer MUST NOT trust it.

**Rules:**

1. `ActivationIntent.scope` is set to `'selection'` from `info.selectionText !== undefined` — used as a boolean intent signal only.
2. The actual selection text is read in the CS via `window.getSelection().toString()` AFTER `activate-reader` arrives.
3. The CS length-caps at 100k chars before tokenize.
4. The CS strips zero-width (`U+200B`–`U+200D`, `U+FEFF`) and bidi controls (`U+202A`–`U+202E`) via the existing tokenizer (`src/core/extraction/tokenize.ts`).
5. Context-menu registration sets `documentUrlPatterns` to non-restricted URL patterns (derived from the inverse of `RESTRICTED_SCHEMES`) so the menu does not render on restricted pages.

`ActivationIntent` carries NO `selectionHint` / `selectionText` field. The wire is selection-content-free.

## Focused-Input Guard (Hotkey)

The CS-side handler for `activate-reader` early-returns when the user's focus is in a sensitive input:

```ts
function isFocusedSensitiveInput(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    if (type === 'password') return true;
    const autocomplete = el.getAttribute('autocomplete') ?? '';
    if (autocomplete.startsWith('cc-')) return true;
  }
  return false;
}
```

If `isFocusedSensitiveInput()`, the CS returns `Result<{ok: false, reason: 'focused-sensitive-input'}>` from the `activate-reader` handler and does NOT mount the overlay. Surfacing:

- Command source: no badge, no surface. Silent suppression — the user can re-issue the hotkey from a non-sensitive context.
- Popup source: popup renders an inline note ("Click outside the password field, then try again").
- ContextMenu source: not reachable from a sensitive-input context (right-click doesn't change focus).

The manifest `commands` entry uses `global: false` (the default) — hotkeys never fire when Chrome is unfocused.

## Port-Keepalive Limits

Composing with the messaging-contract spec's Port use, the SW enforces:

- **Max 1 Port per tab.** Second `connect` with the same `port.sender.tab.id` is rejected (`port.disconnect()`).
- **Max session duration 4h.** `setTimeout` set on Port open; on expiry, `port.disconnect()`. User must reactivate.
- **Port `name` from closed allowlist.** Only `'rsvp-session-v1'` is accepted; unknown names disconnect immediately.

These are bounds, not invariants — a well-behaved user never hits the 4h cap, and bug-induced Port leaks are caught by the per-tab cap.

## Empirical Precondition — `activeTab` + `commands` Reproducer

The ADR ships **Proposed**, not **Accepted**, until the following test passes:

```
experiments/activeTab-commands-check/
  manifest.json     -- minimal: activeTab + scripting + commands(_toggle_reader)
  background.ts     -- registers chrome.commands.onCommand, calls
                       chrome.scripting.executeScript({target:{tabId},files:[]})
                       on https://example.com, asserts success
  content.ts        -- minimal CS that posts a "hi" message
  README.md         -- how to load unpacked + reproduce
```

Outcome cited in the ADR. If the test FAILS (i.e., `commands` invocation does not grant `activeTab` host access at `executeScript` time), the design pivots to `chrome.action.openPopup()` first per the domain-survey recommendation, and the spec is amended before the ADR moves to Accepted.

## Acceptance Criteria

1. `dispatchActivation` accepts all three source shapes and produces a uniform `ActivationIntent`. Unknown commands and missing tabs are dropped silently (no exception).
2. The unified `onMessage` handler rejects messages with `sender.id !== chrome.runtime.id`. Verified by integration test using `sinon-chrome` with a mocked foreign sender.
3. Payload validation: `validateMsg` correctly narrows every variant of the `Msg` discriminated union; CI grep confirms `src/core/messaging/**/*.ts` contains no `as Msg` or `as unknown as`.
4. `isRestrictedUrl` returns `true` for every URL in the test fixture set (`chrome://settings`, `chrome-extension://other-id/x`, `view-source:https://example.com`, `about:blank`, `data:text/html,<p>x</p>`, `javascript:void(0)`, `file:///tmp/x.html`, `blob:https://example.com/abc`, `https://chromewebstore.google.com/`, `https://chrome.google.com/webstore/`); returns `false` for `https://example.com`, `https://en.wikipedia.org/wiki/RSVP`, and `chrome-extension://<ownExtensionId>/popup.html`.
5. `chrome.contextMenus.create` is called with `documentUrlPatterns` derived from the inverse of `RESTRICTED_SCHEMES`. The context menu does not appear on `chrome://settings` in a manual smoke test.
6. State rehydration: a session persisted at `positionIndex: 47, sourceHash: 'abc'` and read back via `rehydrateOnce` is rejected if the CS reports `sourceHash: 'def'`; CS receives `positionIndex: 0`.
7. CAS write: `persistSession({positionIndex: 47})` followed in-flight by `persistSession({positionIndex: 52})` resolves with `52` as the persisted value; a later `persistSession({positionIndex: 47})` (regression) does NOT overwrite `52`.
8. Idempotent injection: two `dispatchActivation` calls within 50ms for the same `tabId` produce exactly ONE `chrome.scripting.executeScript` call; the second reuses the in-flight promise. CS sentinel prevents re-registration on a second forced `executeScript`.
9. PING timeout: a mocked 2500ms-delayed CS receives a retry with the 3000ms budget; `positionIndex` is preserved across the slow window.
10. Focused-input guard: a CS-side test with `document.activeElement = <input type="password">` returns `{ok: false, reason: 'focused-sensitive-input'}` from `activate-reader`.
11. Port limits: a second `chrome.runtime.connect({name: 'rsvp-session-v1'})` for the same tab disconnects with `{reason: 'port-already-open'}`. A Port held >4h is force-disconnected.
12. Empirical precondition (D10): the `experiments/activeTab-commands-check/` reproducer runs cleanly in a manual smoke test; ADR cites the outcome.
13. Build-path verification: `npm run build && grep "type=\"module\"" dist/manifest.json` exits 0 — the SW is emitted as an ES module per the manifest.
14. No-supersession: `git diff` of the spec PR shows no modifications to `docs/superpowers/specs/2026-05-08-messaging-contract.md`, `docs/superpowers/specs/2026-05-08-article-extraction.md`, or `docs/superpowers/decisions/2026-05-08-lazy-injection-manifest.md`.

## Code Layout

```
src/core/
  activation/
    types.ts                ActivationIntent, ActivationSource
    session.ts              ReaderSession schema + validator
  restricted.ts             isRestrictedUrl(url, ownExtensionId)
  messaging/
    types.ts                Msg union — adds `activate-reader` entry only
    validate.ts             discriminated-union validator (new)

src/chrome/
  background/
    index.ts                top-level synchronous listener registration
    activation.ts           dispatchActivation, normalizeIntent
    messages.ts             handleSwMessage, sender-provenance gate
    context-menu.ts         ensureContextMenu, documentUrlPatterns
    restricted.ts           thin adapter — getTabUrl, surfaceRestricted
    session-locks.ts        rehydrateLocks, writeLocks, persistSession (CAS)
    session.ts              handleRsvpSessionConnect, Port limits
    inject.ts               ensureContentScript (idempotent)
  content/
    index.ts                window.__SPEEDREADER_INJECTED__ sentinel
    activate.ts             activate-reader handler, focused-input guard
```

`src/core/**` has zero `chrome.*` references (CI grep, same as the messaging-contract and settings-schema specs).

## Test Strategy

### Unit (Vitest, pure)

- `isRestrictedUrl` — exhaustive fixture set.
- `normalizeIntent` — every raw input shape → expected `ActivationIntent`.
- `ReaderSession` validator — every malformed shape rejected.
- `validateMsg` — exhaustive `Msg` union narrowing, including `activate-reader`.
- `sourceHash` — stability across whitespace-only changes to `document.title` (digest of normalized inputs).

### Integration (Vitest + `sinon-chrome`)

- `dispatchActivation`: each source shape → `chrome.tabs.sendMessage` with the expected `activate-reader` payload.
- Sender-provenance: foreign `sender.id` → rejected; valid popup → accepted; valid CS → accepted; CS spoofing popup shape → rejected.
- Concurrent-rehydrate race: two parallel rehydrate calls observe one storage read; CAS regression rejected.
- Idempotent injection: parallel `dispatchActivation` calls produce one `executeScript`.
- Port limits: second connect rejected; 4h timer enforced.
- Restricted-URL guard: `chrome.contextMenus.create` called with expected `documentUrlPatterns`.

### E2E

Deferred to Playwright (#38). Smoke: load unpacked, fire hotkey on `https://example.com`, verify overlay mounts; fire on `chrome://settings`, verify badge appears and no overlay mounts; right-click selection on a paragraph, verify scope='selection' overlay mounts.

## Out of Scope

- **Read-session wire changes** — owned by `2026-05-08-messaging-contract.md`. This spec only adds `activate-reader` and the Port `name` versioning (`rsvp-session-v1`).
- **Settings broadcast** — owned by the messaging-contract spec (`settings-changed`). Unchanged.
- **Extraction** — owned by `2026-05-08-article-extraction.md`. Unchanged.
- **Omnibox keyword activation, action.onClicked** — future; design extends `ActivationSource` without touching the dispatch funnel.
- **`onSuspend` / `onSuspendCanceled` flush** — Chrome marks both unreliable; we accept lossy `positionIndex` debounce buffers in exchange for reliable behavior.
- **Cross-tab session migration** — out of scope; closing a tab discards the session per existing extraction-spec contract.
