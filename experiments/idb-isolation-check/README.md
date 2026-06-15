# IDB-isolation + `sender.url` Reproducer — `experiments/idb-isolation-check/`

Empirical precondition for the SW-owned reading-position store spec
([`docs/superpowers/specs/2026-06-11-position-store-service-worker.md`](../../docs/superpowers/specs/2026-06-11-position-store-service-worker.md)
§Empirical Precondition). This reproducer **gates the merge of the spec PR (#232)**:
the spec flips `Status: Proposed` → `Accepted` only when checks 1 and 2 pass; check 3
gates the rejection of the cheaper `chrome.storage.session` + `setAccessLevel`
alternative. **Check 5 is the backend-pivot gate** — it tests a different cheaper
candidate (`chrome.storage.local` + `setAccessLevel('TRUSTED_CONTEXTS')`) that, if its
isolation claim holds, dominates extension-origin IDB (durable AND CS-isolated, zero
migration since positions already live in `local`). No implementation PR dispatches
until the load-bearing checks pass.

## Questions this answers

1. **Can a content script (host-page origin) open the extension-origin IndexedDB
   `speedreader-positions` the SW owns?** It must NOT — that's the storage-layer
   teeth of the spec's cross-origin-enumeration fix.
   - **PASS** → backend decision (extension-origin IDB) holds. CS sees only its own
     page's origin; popup (same `chrome-extension://<id>` origin as the SW) sees the
     SW's records.
   - **FAIL** → backend decision is void; spec returns to Solution Design.
2. **Is `sender.url` populated for a CS→SW message under `activeTab` WITHOUT the
   `tabs` permission, and does it equal the top-frame page URL?** This is the
   security invariant: a CS's reach is pinned to `sender.url` (its own page), never a
   payload URL — so enumeration is structurally impossible.
   - **PASS** → the URL-binding invariant is sound on the proposed permission set.
   - **FAIL** → binding falls back to `sender.tab.url`, forcing the `tabs` permission
     (its own privacy review) or a CS-supplied-then-validated URL scheme.
3. **Does `chrome.storage.session` survive a real browser restart?** It must NOT —
   the entire IDB direction is justified by `session` losing data on restart (the
   cheaper `session` + `setAccessLevel('TRUSTED_CONTEXTS')` alternative would
   otherwise close the same enumeration threat on Chrome 112+).
   - **`session` absent after restart (expected)** → IDB direction confirmed.
   - **`session` survives restart** → rejection is void; the cheaper `session` path
     re-opens and the spec returns to Solution Design before any impl.
4. **Does the `setAccessLevel('TRUSTED_CONTEXTS')` restriction PERSIST while the SW is
   idle-evicted/stopped?** (check 6 — the follow-up to check 5.) Check 5 proved the
   restriction blocks a content script **while the SW is alive**. A CS injected during a
   prior activation stays alive in its tab's renderer after the SW is evicted (~30s idle).
   If the restriction were SW-lifetime-scoped and lapsed when the SW stopped, that
   already-alive CS could enumerate `chrome.storage.local` (the user's cross-origin
   reading history) during the (usually long) evicted window. The Chrome docs do not state
   whether it persists, so we measure it.
   - **PASS (restriction persists)** → no eviction-window leak; `local` + `setAccessLevel`
     remains a sound CS-isolation backend through SW idle/eviction.
   - **FAIL (restriction lapses)** → there is an exfiltration window during eviction;
     `local` + `setAccessLevel` cannot be relied on for CS isolation across the SW lifecycle.

## Manifest

The reproducer uses the SAME least-privilege permission set the spec proposes:

```
"permissions": ["activeTab", "scripting", "storage"]
```

Justification (per spec §Least-privilege framing):

- **`activeTab`** — the gesture grant the reader is injected under; the CS runs in
  proximity to untrusted page content.
- **`scripting`** — present in the proposed set (lazy-injection path); the reproducer
  declares a `content_scripts` entry to exercise the `sender.url` path without a
  gesture (see Automation scope / check 2).
- **`storage`** — needed for `chrome.storage.session` (check 3) and for the SW to
  stash the latest sender-probe so the automated suite can read it deterministically.
- **NO `tabs`** — deliberately excluded. Check 2's whole point is that `sender.url` is
  populated _without_ `tabs`. T1 asserts `tabs` stays out of the set; a regression
  that re-adds it is caught.

`content_scripts` matches `http://*/*` + `https://*/*` with `match_about_blank: true`
(for the check-2 opaque-origin path) and `all_frames: true`. The `action.default_popup`
drives the check-1 inverse RPC.

## How to run

### Automated (checks 1, 2 — the merge-gating pair)

```
npm run test:idb
```

(Wraps `npx playwright test --config experiments/idb-isolation-check/playwright.config.ts`.)
Runs headed Chromium with the extension loaded via `--load-extension`, serves a
local-only fixture on `127.0.0.1` (no network), and asserts T1–T3 plumbing + C1a/C1b
(origin isolation + popup inverse) + C2a/C2b (`sender.url` + about:blank reject).

### Manual (check 3 — real browser restart; checks 1/2 console smoke)

1. **Open Chrome.** Tested floor: Chrome 112+ (`setAccessLevel('TRUSTED_CONTEXTS')`
   availability; `chrome.storage.session` cleared-on-restart semantics).
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this
   directory (`experiments/idb-isolation-check/`).
3. Open the SW DevTools: extension card → **Inspect views: service worker**. You
   should see:
   - `[idb] background.js loaded — DB: speedreader-positions store: positions`
   - `[idb] SW sentinel written to speedreader-positions -> position:https://sentinel.example/`
   - `[session] setAccessLevel(TRUSTED_CONTEXTS) requested (no sentinel written on wake)`
     — note the session sentinel is **no longer** written at SW boot (methodology fix,
     see check 3 below).
4. **Check 1 (CS isolation):** open `http://127.0.0.1:<port>/` (or any `https://`
   page) and open the **page** DevTools console. Look for:
   - `[content][check1] page-origin IDB probe: {"upgradeFired":true,"oldVersion":0,"sawSentinel":false} ...`
     → PASS (page origin does not see the SW DB).
   - **Check 1 inverse:** click the toolbar icon to open the popup; it should read
     `PASS — popup sees the SW sentinel (shared namespace)`.
5. **Check 2 (`sender.url`):** in the SW DevTools console, on the same page load, look
   for `[sender] position/get { 'sender.url': 'http://127.0.0.1:<port>/', 'sender.frameId': 0, ... }`.
   Confirm `sender.url` equals the page URL and `frameId === 0`. Then open
   `about:blank` in a tab and watch for
   `[guard] REJECT position/get — null/opaque-origin sender.url: about:blank`.
6. **Check 3 (restart survival) — the load-bearing manual step:**

   > **Methodology fix (why the flow changed).** Previously `background.js` wrote the
   > session sentinel at SW top-level on every wake. Opening **any** extension context —
   > SW DevTools **or** the popup — wakes the SW, reruns `background.js`, and re-stamps
   > the sentinel with a fresh `writtenAt`. After a real restart the relaunched SW would
   > repopulate the value **before you could observe it cleared**, making "cleared on
   > shutdown" indistinguishable from "survived." The fix: the sentinel is written
   > **only** via an explicit `session/write-sentinel` trigger (the popup's **Write**
   > button), and **reading no longer writes**. `setAccessLevel('TRUSTED_CONTEXTS')` is
   > still called on every wake (it's the config the spec's rejection rests on) — it just
   > no longer writes the sentinel. So even if you open SW DevTools first, the value is
   > not rewritten.

   1. **Cold-vs-restore distinction (read first).** Chrome's *Continue where you left off*
      restore-on-startup keeps the prior session — including `chrome.storage.session` and
      often the SW itself — alive across a relaunch, so a sentinel surviving that is
      **expected** and proves nothing. The decisive test is a **non-restore** startup: set
      `chrome://settings` → On startup → **Open the New Tab page** before testing, so a
      relaunch is a true **cold** session boundary. (A manual Chrome 138 run with
      restore-on-startup showed the sentinel surviving with a ~452s-old `writtenAt`
      precisely because session-restore kept the SW alive and it never reran the write —
      that's the restore path, not a cold boundary.)
   2. **Write the sentinel.** Click the toolbar icon to open the popup → in the **Check 3**
      section click **Write session sentinel**. It shows `Written — writtenAt <time>`.
      This is the only thing that writes the sentinel.
   3. **Fully quit Chrome** — `Cmd+Q` (macOS) / fully exit, not just close the window.
      Wait a few seconds for the browser process to terminate.
   4. **Relaunch Chrome.** Do **not** open the SW DevTools first (not required, and even if
      you do it no longer rewrites the sentinel).
   5. **Read the sentinel.** Open the popup → click **Read session sentinel**. Interpret the
      verdict it renders:
      - **ABSENT / `{}` → PASS:** `session` did NOT survive the restart, confirming the
        spec's rejection of the `session` alternative.
      - **PRESENT → SURVIVED / FAIL:** the sentinel is still there. A **large** `delta`
        spanning the quit = genuine survival → the rejection is void, re-open Solution
        Design. A **small** delta would mean the SW re-wrote on wake — that should no
        longer happen now that auto-write is removed; if you see it, surface it (the
        methodology fix regressed).

## Expected output (automated suite)

### PASS

```
  ✓ T1 — manifest declares the spec permission set, content_scripts, popup
  ✓ T2 — SW opens the extension-origin IDB and writes the sentinel
  ✓ T3 — SW registered the onMessage listener (plumbing)
  ✓ C1a — content/page origin cant open the SW IDB (oldVersion === 0, no sentinel)
  ✓ C1b — popup position/list returns the SW sentinel (shared extension-origin namespace)
  ✓ C2a — declared CS gets sender.url == page URL, frameId === 0, without tabs perm
  ✓ C2b — about:blank top frame -> sender.url canonicalizes null -> handler rejects
  ✓ C3-plumbing — explicit session/write then read returns the value; a write-free wake reads ABSENT
  ✓ C5a — SW setAccessLevel(local, TRUSTED_CONTEXTS) is supported and succeeds on this Chrome
  ✓ C5b — declared CS is BLOCKED from reading/enumerating/writing local after setAccessLevel
  ✓ C5c — popup (trusted context) STILL reads the local sentinel after setAccessLevel
  ✓ C6a — negative control: DOM-channel probe is BLOCKED while the SW is ALIVE
  ✓ C6b — restriction PERSISTS while the SW is STOPPED (already-alive CS still blocked)

  13 passed
```

`C3-plumbing` is **plumbing only** — it proves the new `session/write-sentinel` /
`session/read-sentinel` handlers work in-session and that a write-free SW wake reads
ABSENT (the methodology fix). It does **NOT** prove the cold-restart verdict; that
stays manual (see §Why check 3 stays manual).

### FAIL signatures to watch for

- **C1a** `Expected: 0 / Received: 1` on `oldVersion` → the page origin somehow shares
  the SW's IDB. This would VOID the backend decision. Investigate before trusting it.
- **C2a** `sender.url` empty / `undefined` → `sender.url` is NOT populated on the
  proposed permission set; check-2 FAIL, binding must fall back to `sender.tab.url`.
- **C2a** `frameId !== 0` → the message came from a sub-frame; the top-frame invariant
  the gate relies on does not hold for this path.
- **C2b** `about:blank` canonicalized to non-null → the opaque-origin guard is missing
  the `null`-key poisoning path the spec requires.

## Reporting the outcome

Paste results into the spec's **§Empirical Precondition** before merge, plus the Chrome
version (`chrome://version` → first line).

### Check 1 — IDB origin isolation + popup inverse  ·  status: **AUTOMATED**

Fill from `npm run test:idb` (C1a + C1b) — record PASS/FAIL and the suite tail.

```
oldVersion (page origin): ____   sawSentinel (page): ____   popup position/list saw sentinel: ____
```

### Check 2 — `sender.url` population + about:blank reject  ·  status: **AUTOMATED**

Fill from `npm run test:idb` (C2a + C2b).

```
sender.url == page URL: ____   frameId === 0: ____   tabs perm present: NO
about:blank canonicalizes null (reject): ____
```

### Check 3 — `chrome.storage.session` restart survival  ·  status: **UNVERIFIED — awaiting manual run**

> **This callout is UNVERIFIED.** It requires a real OS-level Chrome quit+relaunch
> (Playwright context teardown is NOT equivalent — see §Why check 3 stays manual). The
> automated `C3-plumbing` test proves the handlers work in-session but does NOT and
> cannot record the cold-restart verdict — do NOT record a PASS here from the suite.
> Run the explicit Write → Cmd+Q → relaunch → Read flow (§How to run, manual step 6),
> with **restore-on-startup OFF** (Open the New Tab page) so the relaunch is a true cold
> boundary, then fill:

```
Chrome version:                 ____
Startup mode (must be non-restore / New Tab page): ____
session-sentinel after Write (before quit):   ____  (expected: present)
session-sentinel after relaunch + Read:       ____  (expected: ABSENT / {})
delta on relaunch read (large=survival, small=re-write regression): ____
Verdict (session cleared on restart → IDB direction confirmed):  PASS / FAIL  ____
```

## Automation scope

| Check | What it verifies | Coverage |
|-------|------------------|----------|
| **T1** | Manifest = proposed set (`activeTab`+`scripting`+`storage`, NO `tabs`) + content_scripts + popup | Full |
| **T2** | SW opens extension-origin IDB and writes the sentinel | Full |
| **T3** | SW registered the `onMessage` listener (plumbing) | Plumbing only |
| **C1a** | Page-origin `indexedDB.open('speedreader-positions')` → `oldVersion === 0`, no sentinel | **Full (automated)** |
| **C1b** | Popup-equivalent `position/list` RPC returns the SW sentinel (shared namespace) | **Full (automated)** |
| **C2a** | **Declared** CS → SW `sender.url` == page URL, `frameId === 0`, no `tabs` perm | **Full (automated)** |
| **C2b** | `about:blank` opaque-origin → `sender.url` canonicalizes null → handler rejects | **Full (automated)** |
| **C3-plumbing** | `session/write-sentinel` + `session/read-sentinel` round-trip in-session; a write-free SW wake reads ABSENT (auto-write removed) | **Plumbing only (automated)** |
| **C5a** | `chrome.storage.local.setAccessLevel` exists and `setAccessLevel('TRUSTED_CONTEXTS')` succeeds on the harness Chrome | **Full (automated)** |
| **C5b** | Declared CS `local.get(key)` / `get(null)` / `set` all blocked post-restriction (`lastError: "Access to storage is not allowed from this context."`); CS sees no sentinel | **Full (automated)** |
| **C5c** | Popup (trusted context) STILL reads `local-position-sentinel` after the restriction | **Full (automated)** |
| **C6a** | Negative control — the check-6 DOM-channel probe is blocked while the SW is ALIVE (proves the channel isn't silently failing; confirms the sentinel exists) | **Full (automated)** |
| **C6b** | The `setAccessLevel('TRUSTED_CONTEXTS')` restriction PERSISTS while the SW is STOPPED — an already-alive CS still cannot read/enumerate/write `local` during eviction (SW-stop driven via CDP `ServiceWorker.stopAllWorkers`; worker-target-gone asserted as a false-pass guard) | **Full (automated)** |
| Check 2 (activeTab-**injected** CS variant) | `scripting.executeScript`-injected CS gets `sender.url` on the gesture path | **Manual** |
| **Check 3** | `chrome.storage.session` cleared by a REAL browser restart (explicit Write → Cmd+Q → Read; non-restore startup) | **Manual** |

## Why check 3 stays manual

`chrome.storage.session` is an in-memory area held in the **browser process** and
cleared when that process shuts down. The claim under test is precisely "a real
browser restart clears it." Playwright's `context.close()` + relaunch on a persistent
context is **not a reliable proxy** for an OS-level Chrome quit: the persistent-context
teardown does not exercise Chrome's session-restore / process-lifecycle path the same
way a user `Cmd+Q` + relaunch does, and asserting absence after a Playwright teardown
could record a PASS for the wrong reason (or a flaky FAIL). Because this rejection is
**load-bearing** — it is the single fact justifying the entire IDB direction over the
cheaper `session` + `setAccessLevel` change — a fabricated or proxy PASS here is the
exact expensive-rollback risk the empirical-precondition section exists to prevent. So
check 3 is a structured manual callout, left UNVERIFIED until a human runs the real
quit+relaunch. The automated suite covers the SW-side plumbing only:
`C3-plumbing` proves the `session/write-sentinel` / `session/read-sentinel` handlers
work in-session and that a write-free SW wake reads ABSENT (so opening the popup or SW
DevTools no longer masks the verdict). It never claims the restart result.

**Methodology fix.** The sentinel used to be written at SW top-level on every wake. Any
extension context (SW DevTools or popup) wakes the SW and would re-stamp the sentinel,
so after a restart the relaunched SW repopulated it before it could be observed cleared
— "cleared on shutdown" was indistinguishable from "survived." The write now happens
only on the explicit `session/write-sentinel` trigger, and reading never writes;
`setAccessLevel('TRUSTED_CONTEXTS')` is still exercised on every wake (it's the config
the rejection rests on) without writing. Also note the **cold-vs-restore** distinction:
*Continue where you left off* restore-on-startup preserves the session (and often the SW
itself) across a relaunch, so survival there is expected and not decisive — the test
must run with restore OFF (Open the New Tab page) for a relaunch to be a true cold
session boundary.

## Check 5 — `local` + `setAccessLevel` isolation (backend-pivot gate)

### The question this decides

The spec selected **extension-origin IndexedDB** so reading-positions are unreadable by
content scripts. A simpler candidate may dominate it:
**`chrome.storage.local` + `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`**.
`local` is durable unconditionally (unlike `session`, which check 3 rejects for not
surviving restart), and `setAccessLevel('TRUSTED_CONTEXTS')` is documented to hide the
`local` area from content scripts — so it would be durable AND CS-isolated with **no
data migration** (positions already live in `local`). Before rewriting the spec around
it, the isolation claim must be **empirically confirmed** — the same reproducer-gate
discipline the spec applies to IDB.

> **Decision:** if `local` + `setAccessLevel('TRUSTED_CONTEXTS')` blocks the CS from
> reading positions, the spec's backend selection pivots from extension-origin IDB to
> `local` + `setAccessLevel`. If it does NOT block the CS, the IDB direction stands.

### Automated result · status: **AUTOMATED (C5a/C5b/C5c)**

Run on **Chrome for Testing 148.0.7778.96** (UA `Chrome/148.0.0.0`), Playwright 1.60.0,
macOS arm64.

- **C5a — `setAccessLevel` on `local` is supported and succeeds.**
  `typeof chrome.storage.local.setAccessLevel === 'function'` → `true`; the
  `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` call resolved with **no throw and
  no `chrome.runtime.lastError`**. `local.setAccessLevel` is real on this Chrome.
- **C5b — the declared content script is BLOCKED.** **VERDICT: PASS — the CS cannot read
  positions.** After the SW restriction, the CS's `chrome.storage.local.get('local-position-sentinel')`,
  its `get(null)` enumeration, **and** its `chrome.storage.local.set(...)` write all failed
  identically. The exact CS-observed failure mode (verbatim from the run):

  ```
  chrome.runtime.lastError.message === "Access to storage is not allowed from this context."
  ```

  Mode detail: this is **NOT a synchronous throw and NOT a promise rejection** — the
  `get`/`set` callback fires normally, but `chrome.runtime.lastError` is populated and the
  returned value object is empty (no sentinel). A CS that ignores `lastError` would see an
  empty result `{}`, never the data. **Write is blocked too** — `set` produced the same
  `lastError`, so a restricted CS loses both read and write on `local`.
- **C5c — the popup (trusted context) is UNAFFECTED.** **PASS** — the popup's
  `check5/read-sentinel` RPC still returns `local-position-sentinel`
  (`source: 'sw-local-sentinel'`), confirming `TRUSTED_CONTEXTS` includes the popup + SW.

### Min-version finding (`local.setAccessLevel`)

- **Confirmed working on Chrome 148** (the harness Chrome) — `setAccessLevel` exists on
  `local` and the `'TRUSTED_CONTEXTS'` restriction takes effect (C5a + C5b).
- **Documented floor:** `chrome.storage.session.setAccessLevel` shipped in **Chrome 102**;
  `setAccessLevel` was extended to the `local` (and `sync`) areas **≈Chrome 119** per the
  storage-API release notes (the Chrome docs say `local` is "by default exposed to content
  scripts, but this behavior can be changed by calling `chrome.storage.local.setAccessLevel()`").
  The Chrome docs page does not carry a per-area version badge, so treat **Chrome 119 as the
  floor for `local.setAccessLevel` pending a confirming run on a 119-range build** — the
  harness only proves the floor is **≤ 148**. If the spec pivots to this backend, set
  `min_chrome_version` to the confirmed `local.setAccessLevel` floor (119, or higher if a
  119-range run shows otherwise) — a bump from the IDB direction's lower floor.

### What feeds the spec

If the backend pivots to `local` + `setAccessLevel`:

- Drop the IDB adapter + the `speedreader-positions` DB; positions stay in `chrome.storage.local`.
- **No migration** (data already in `local`).
- The CS-side contract changes: a restricted CS gets `lastError` (not a thrown error) —
  any CS-side read path must check `chrome.runtime.lastError`, and the spec should state the
  CS cannot read OR write positions directly (RPC-to-SW only).
- Bump `min_chrome_version` per the finding above.

### Why this gate is automatable (unlike check 3)

C5 is **structural** — `setAccessLevel` takes effect at SW boot and the declared content
script's blocked read is deterministic, no user gesture or process restart involved. So
it's automatable like C1 (origin isolation), not manual like check 3 (which needs a real
OS-level Chrome quit+relaunch). The CS runs in the isolated world, so its probe results
are relayed to the SW and parked in `chrome.storage.session` (a trusted area, distinct
from the restricted `local`) for Playwright to read — the same SW-stash-then-read trick
C2a uses for the sender-probe.

## Check 6 — does the `setAccessLevel` restriction persist while the SW is stopped?

### The question this decides

Check 5 proved `setAccessLevel('TRUSTED_CONTEXTS')` blocks a content script from reading
`chrome.storage.local` **while the SW is alive**. Check 6 answers the security-load-bearing
follow-up: **does that restriction survive the SW being idle-evicted/stopped?** A content
script injected during a prior activation outlives the SW in its tab's renderer. If the
restriction were scoped to the SW's lifetime, an already-alive CS could call
`chrome.storage.local.get(null)` and enumerate the user's cross-origin reading history during
the (usually long) evicted window. If `local` + `setAccessLevel` is to be the spec's backend,
this window must NOT exist.

> **Decision:** if the restriction persists with the SW stopped, `local` + `setAccessLevel`
> survives the SW lifecycle as a CS-isolation backend. If it lapses, there is an
> eviction-window leak and the candidate is unsafe for cross-origin position isolation.

### Automated result · status: **AUTOMATED (C6a/C6b)** · **VERDICT: PASS — restriction PERSISTS**

Run on **Chrome for Testing 148** (UA `Chrome/148.0.0.0`), Playwright 1.60.0, macOS arm64.

- **C6a — negative control (SW ALIVE).** The check-6 DOM-channel probe is blocked while the
  SW is alive — re-confirming check 5 through the *same* DOM channel C6b uses, so a C6b
  "blocked" result can't be the DOM channel silently failing. The test also confirms the
  `local-position-sentinel` actually exists via a trusted read, so "CS sees nothing" isn't
  because there was nothing to see. Observed CS outcome (keyed get, `get(null)`, `set`):
  `{"outcome":"lastError","lastError":"Access to storage is not allowed from this context."}`.
- **C6b — restriction PERSISTS while the SW is STOPPED.** **VERDICT: PASS.** With the SW
  confirmed stopped, the already-alive CS's `get('local-position-sentinel')`, its `get(null)`
  enumeration, **and** its `set(...)` write all STILL fail identically, and the sentinel is
  never returned. The exact CS-observed failure mode (verbatim from the run, SW stopped):

  ```
  chrome.runtime.lastError.message === "Access to storage is not allowed from this context."
  ```

  `sawSentinelKeyed: false`, `sawSentinelEnum: false`. **There is no eviction-window leak on
  Chrome 148.**

### How check 6 is built (and why it's automatable)

The three constraints that shape the implementation:

1. **No SW relay.** When the probe runs the SW is stopped, so the `check5/cs-result` RPC
   path is dead — and worse, any `chrome.runtime.sendMessage` would WAKE the SW and void the
   "SW stopped" precondition. So the CS surfaces its outcome through the **page DOM** (a
   hidden `<div id="check6-result" data-status data-outcome>`), which `page.evaluate` in the
   main world can read (the CS isolated world and the page main world share the DOM). The
   probe touches only `chrome.storage.local` — never `chrome.runtime`.
2. **On-demand trigger.** The CS registers `window.addEventListener('check6-probe', …)` at
   injection and signals readiness via `data-status="ready"`. Playwright fires the probe
   *after* stopping the SW via `page.evaluate(() => window.dispatchEvent(new CustomEvent('check6-probe')))`
   (DOM events reach both the isolated-world and main-world `window` listeners), then waits
   for `data-status="done"` and reads `data-outcome`.
3. **Deterministic SW stop + liveness guard.** The SW is stopped via the browser-level CDP
   **`ServiceWorker.stopAllWorkers`** (anchored on a `context.newCDPSession(page)` —
   Playwright 1.60 does not accept a Worker for `newCDPSession`). Liveness is checked via CDP
   **`Target.getTargets`**: a `service_worker` target is listed iff the worker is running.
   `context.serviceWorkers()` is NOT used for liveness — it keeps a **stale** Worker handle
   after the worker stops (verified empirically), which would mask a stopped worker. C6b
   asserts the worker target is GONE before firing the probe, and re-asserts it stayed gone
   AFTER — a probe that "passes" only because the SW was secretly still alive would be a
   false pass, so this liveness assertion is part of the test, not a convenience.

No manual fallback was needed — the CDP `ServiceWorker.stopAllWorkers` + `Target.getTargets`
path stops the worker and confirms it stopped fully within Playwright.

### What feeds the spec

If the backend pivots to `local` + `setAccessLevel`:

- **Confirmed:** the restriction holds across SW idle/eviction on Chrome 148 — no
  eviction-window enumeration leak. The CS-cannot-read-positions guarantee the spec rests on
  is not limited to the SW-alive window.
- Re-run on a newer Chrome (or the confirmed `local.setAccessLevel` floor build) to keep the
  assumption fresh if Chrome's restriction-scoping behavior changes.

## Why the activeTab-injected CS variant of check 2 stays manual

Check 2's load-bearing claim — `sender.url` is populated for an extension-internal CS
message without `tabs` — holds for **any** content script, and a **declared**
`content_scripts` entry exercises it with no gesture (C2a/C2b, automated). The spec's
phrasing "injected via `activeTab`" additionally implies the `scripting.executeScript`
injection path, whose grant requires a real user gesture dispatched by the browser
process. Playwright's `serviceWorker.evaluate()` lacks gesture provenance (the same
browser-process invariant that makes the sibling D10 reproducer's T4 manual). The
declared-CS path proves the `sender.url` property the security invariant rests on;
the gesture-injected variant is a once-per-Chrome-major-version manual smoke and does
not change the check-2 verdict.

## Why this experiment lives in-repo

Per spec §Empirical Precondition, the result must be cited in the spec before merge.
An in-repo reproducer (rather than an external gist or "I tried it once") survives:

- Future Chrome behavior changes (re-run on a newer Chrome to confirm the assumption).
- Maintainer turnover (the next person to touch #196 doesn't re-derive the question).
- Memory rot (stored platform-behavior claims decay; reproducers don't).

## When to delete this directory

Once the spec is `Status: Accepted` (checks 1 + 2 recorded PASS, check 3 manual PASS
recorded) AND the position-store spec is implemented in `src/chrome/`, this experiment
can be deleted — its job is done. Until then, keep it. A future Chrome breakage on IDB
origin isolation, `sender.url` population, or `session` restart semantics should
re-open this directory, not start over.
