# ADR: Lazy content-script injection — manifest pinned to `activeTab` + `scripting`

**Date:** 2026-05-08
**Status:** Accepted
**Issue:** [#73 — Pin extraction trigger as lazy-on-popup-open (architecture)](https://github.com/chriscantu/speedreader-chrome/issues/73)
**Related:** [#17](https://github.com/chriscantu/speedreader-chrome/issues/17), [#45](https://github.com/chriscantu/speedreader-chrome/issues/45)

## Context

The article-extraction spec (`docs/superpowers/specs/2026-05-08-article-extraction.md` §"Trigger Timing — lazy on popup-open") commits behaviorally to extraction running only on popup-open, not on page load. The MV3 manifest must enforce that contract — otherwise `content_scripts` declared with `matches: ['<all_urls>']` would inject on every navigation regardless of whether the user invoked the extension, defeating the design goal of paying zero per-tab CPU cost on uninvited tabs.

The previous manifest declared both an eager `content_scripts` entry and `host_permissions: ['<all_urls>']` — neither is needed under the lazy model.

## Decision

1. **No `content_scripts` entry in the manifest.** The content script is injected on demand by the service worker via `chrome.scripting.executeScript({ target: { tabId }, files: [...] })` when the popup posts an `extract-summary` message.
2. **Drop `host_permissions: ['<all_urls>']`.** The `activeTab` permission grants temporary host access to the active tab on user gesture (toolbar click → popup open). Per the [Chrome `chrome.scripting` docs](https://developer.chrome.com/docs/extensions/reference/api/scripting), `activeTab` is sufficient for `executeScript` against the current tab; broad host permissions are not required.
3. **Permission set:** `["storage", "activeTab", "scripting"]`.

## Consequences

- **Positive — store review.** Dropping `<all_urls>` removes the broad-host-permissions disclosure that triggers extra Chrome Web Store scrutiny. Issue #45's permission-justification document inherits a much smaller surface to defend.
- **Positive — privacy posture.** SpeedReader has access only to a tab the user explicitly activates via the popup. Background tabs are never read.
- **Trade-off — keyboard shortcut.** The `Ctrl+Shift+Y` global command (issue #34) cannot rely on `activeTab` directly; the command handler must open the popup (or programmatically request the user-gesture-bound permission via the `action.openPopup()` path) before invoking `executeScript`. Tracked under #34's implementation, not regressed here.
- **Trade-off — restricted-URL guard moves to runtime.** Without an eager `content_scripts.matches` filter, the service worker is the sole gatekeeper for `chrome://`, `chrome-extension://`, and Web Store URLs. Already in scope for the extraction spec's §Failure Modes.
- **Safari parity.** Safari's content-blocker and App Extension model is stricter than Chrome's; the lazy/`activeTab` posture aligns more closely with Safari's per-page activation, simplifying a future shared-core port.

## Alternatives rejected

- **Keep eager `content_scripts` + drop `<all_urls>` to specific origins.** Defeats the "general-purpose reading tool" stance — the extension must work on any page, so any non-`<all_urls>` matches list is wrong.
- **Keep `<all_urls>` host permission as belt-and-suspenders.** Adds nothing under the lazy injection model and pays the full Web Store review cost for no functional return.
