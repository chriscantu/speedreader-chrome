# D10 Reproducer — `activeTab` + `chrome.commands` + `executeScript`

Empirical precondition for the SW lifecycle + activation-trigger ADR
([`docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md`](../../docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md))
and spec
([`docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md`](../../docs/superpowers/specs/2026-05-22-sw-lifecycle-activation.md)
§Empirical Precondition, AC #12).

## Question this answers

Does `chrome.commands.onCommand` count as a user gesture for `activeTab` such
that `chrome.scripting.executeScript` succeeds on the active tab **without**
declaring `host_permissions`?

- **PASS** → Issue #34 (`chrome.commands` hotkey) can lazy-inject via the same
  permission set as the popup path. The ADR promotes to **Accepted** with the
  outcome cited.
- **FAIL** → Activation from the command source must pivot to
  `chrome.action.openPopup()` first (per the domain-survey recommendation), OR
  add `host_permissions: ['<all_urls>']` — which is an MVP-blocking parity
  regression of the lazy-injection ADR
  (`docs/superpowers/decisions/2026-05-08-lazy-injection-manifest.md`).
  The spec is amended before promotion.

## Manifest

The reproducer uses the SAME permission set the spec proposes:

```
"permissions": ["activeTab", "scripting"]
```

No `host_permissions`. No `content_scripts`. Standard MV3.

## How to run

1. **Open Chrome.** Tested floor: Chrome 116+ (matches spec
   `minimum_chrome_version`).
2. Navigate to `chrome://extensions`. Enable **Developer mode** (top-right).
3. Click **Load unpacked**. Select this directory
   (`experiments/activeTab-commands-check/`).
4. Open Chrome's service-worker DevTools for this extension:
   - On the extension card, click **Inspect views: service worker**.
   - A DevTools window opens for the background.
   - You should see: `[D10] background.js loaded — press Ctrl+Shift+Y on a non-restricted page.`
5. Open a non-restricted page. Suggested fixtures:
   - `https://example.com` — minimal page; smallest blast radius for the test.
   - `https://en.wikipedia.org/wiki/RSVP` — realistic content article.
6. **Press `Ctrl+Shift+Y`** (Mac: `MacCtrl+Shift+Y`). The OS-level "Ctrl"
   on Mac is `MacCtrl` per Chrome's commands API.
7. Watch the service-worker DevTools console.

### Hotkey collision fallback

If `Ctrl+Shift+Y` is already bound by the OS or another extension, rebind at
`chrome://extensions/shortcuts` (the default `Ctrl+Shift+Y` is just a
suggestion). The test outcome is independent of which key you bind to.

## Expected output

### PASS

```
[D10] command fired: { command: '_toggle_reader', tabId: 42, url: 'https://example.com/' }
[D10] PASS: executeScript succeeded: { href: 'https://example.com/', title: 'Example Domain', bodyTextSample: 'This domain is for use in illustrative ex' }
```

The extension's toolbar badge for the active tab reads `OK`.

### FAIL

```
[D10] command fired: { command: '_toggle_reader', tabId: 42, url: 'https://example.com/' }
[D10] FAIL: executeScript rejected: Error: Cannot access contents of url "https://example.com/". Extension manifest must request permission to access this host.
```

The extension's toolbar badge for the active tab reads `FAIL`.

Other failure shapes to watch for:

- `Error: The extensions gallery cannot be scripted.` — you triggered on
  `chrome.google.com/webstore`. Restricted page, expected; retry on
  `https://example.com`.
- `Error: Missing host permission for the tab` — same class as FAIL above.
- No console output at all on key press — hotkey did not reach the
  extension; check `chrome://extensions/shortcuts` for collisions.

## Reporting the outcome

After running, paste the **first three console lines** from the service-worker
DevTools into the ADR `§Empirical Precondition` outcome callout, plus the
Chrome version (from `chrome://version` → first line).

If PASS: ADR promotes from `Status: Proposed` → `Status: Accepted`.

If FAIL: open a follow-up issue, link from the ADR, and pivot the spec to the
`chrome.action.openPopup()` path before merging the spec PR.

## Automation scope

`tests/d10.spec.ts` is a Playwright suite that runs Chrome with the
extension loaded (via `--load-extension`) and verifies the adjacent
plumbing. It does NOT replace the manual T4 hotkey test — see
"Why T4 stays manual" below.

| Test | What it verifies | Coverage |
|------|------------------|----------|
| **T1** | Manifest declares `_toggle_reader` + `action` entry, has `activeTab` + `scripting` permissions | Full |
| **T2** | SW registers `chrome.action.onClicked` listener; `executeScript` API surface is present | Plumbing only |
| **T3** | SW boots cleanly past top-level synchronous listener registration (the load-bearing MV3 invariant) | Full |
| **T4** | The actual D10 question: `commands` invocation grants `activeTab` for `executeScript` | **Manual** |

Run the suite:

```
npm run test:d10
```

(Wraps `npx playwright test` rooted at `experiments/activeTab-commands-check/`.)

## Why T4 stays manual

`activeTab` is granted only when a real user gesture is dispatched
inside the browser process — toolbar click, hotkey press, context-menu
click. Playwright's `serviceWorker.evaluate()` runs in the SW context
but **lacks gesture provenance**. Chromium rejects `executeScript`
with `"Cannot access contents of the page. Extension manifest must
request permission to access the respective host."` when called from
an evaluate context.

This is the correct, expected Chromium behavior and does NOT disprove
D10 — it confirms that the gesture-bearing path is the load-bearing
distinction. The PASS/FAIL signal for D10 can only come from a real
keystroke into Chrome's command dispatcher.

T1–T3 give regression coverage for everything around the gesture
path: if the manifest decays, if the SW stops booting, if the action
listener disappears, automation catches it. The gesture grant itself
needs one manual smoke per Chrome major-version bump.

## Why this experiment lives in-repo

Per ADR directive D10 + spec AC #12, the test result must be cited in the
ADR. Citing a reproducer that lives in the repo (rather than an external
gist or memory of "I tried it once") survives:

- Future Chrome behavior changes (someone can re-run on a newer Chrome and
  confirm the assumption still holds).
- Maintainer turnover (the next person to touch #34 doesn't need to re-derive
  the question).
- Memory rot (stored claims about platform behavior decay; reproducers don't).

## When to delete this directory

Once `Status: Accepted` is set on the ADR AND the activation spec is
implemented in `src/chrome/`, this experiment can be deleted — its job is
done. Until then, keep it. Future Chrome breakages on this assumption
should re-open this directory, not start over.
