# IDB-isolation + `sender.url` Reproducer — `experiments/idb-isolation-check/`

Empirical precondition for the SW-owned reading-position store spec
([`docs/superpowers/specs/2026-06-11-position-store-service-worker.md`](../../docs/superpowers/specs/2026-06-11-position-store-service-worker.md)
§Empirical Precondition). This reproducer **gates the merge of the spec PR (#232)**:
the spec flips `Status: Proposed` → `Accepted` only when checks 1 and 2 pass; check 3
gates the rejection of the cheaper `chrome.storage.session` + `setAccessLevel`
alternative. No implementation PR dispatches until the load-bearing checks pass.

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

  8 passed
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
