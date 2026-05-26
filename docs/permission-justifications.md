# SpeedReader — Permission Justifications

> **Purpose:** This document justifies every permission and host permission
> requested by the SpeedReader Chrome extension. It is the precursor to the
> Chrome Web Store listing's permission-justification section (issue #44).

---

## Non-Host Permissions

### `storage`

**What it does:** Allows the extension to read and write user preferences
(speech rate, font choice, theme, etc.) via `chrome.storage.sync`.

**Why SpeedReader needs it:** SpeedReader is an accessibility tool that must
persist user settings across browser sessions. The `sync` partition ensures
settings travel with the user across devices signed into the same Chrome
profile.

**User impact if denied:** Users would lose all customizations after each
browser restart — speed, font, theme, and reading position would reset to
defaults every time.

---

### `activeTab`

**What it does:** Grants the extension temporary access to the currently
active tab when the user explicitly triggers it (e.g., clicking the popup or
using the keyboard shortcut).

**Why SpeedReader needs it:** The extension activates on user action.
`activeTab` provides a minimal, on-demand permission model: SpeedReader can
inject its content script or read the page **only** when the user asks it to,
not on every page load.

**User impact if denied:** The extension cannot activate on the user's
current page at all, rendering it unusable.

---

### `scripting`

**What it does:** Allows the extension to dynamically execute content scripts
in tabs via `scripting.executeScript`.

**Why SpeedReader needs it:** The content script (which extracts article text
and renders the RSVP overlay) must be injected **only when the user activates
SpeedReader**, not on every page load. The `scripting` permission enables
this on-demand injection, which is required by Manifest V3's service-worker
model and aligns with Chrome's least-privilege philosophy.

**User impact if denied:** SpeedReader cannot inject its RSVP overlay into
pages, making the extension non-functional.

---

### `contextMenus`

**What it does:** Allows the extension to register entries in the browser's
right-click context menu.

**Why SpeedReader needs it:** Adds a "SpeedReader" submenu when the user
right-clicks selected text, exposing preset reading speeds and persistent
toggles (`Show context line`, `Start from word 1`). The submenu is scoped to
`contexts: ['selection']` and `documentUrlPatterns: ['http://*/*', 'https://*/*']`
so it never appears on internal pages or without an active selection.

**User impact if denied:** Users can still activate SpeedReader via the
popup or keyboard shortcut, but the right-click activation surface — which
the design pack treats as the primary discovery path for selection-scoped
reads — is unavailable.

---

## Host Permissions

### `<all_urls>`

**What it does:** Allows the content script to run on every website the user
visits.

**Why SpeedReader needs it:** SpeedReader is a **general-purpose** reading
assistant. Users should be able to activate it on _any_ article, blog post,
documentation page, or web-based document — not just a pre-approved list of
sites. The extension only activates when the user explicitly triggers it
(via popup or keyboard shortcut), so the broad host permission does not
result in passive data collection.

**Mitigations:**

- The content script runs `run_at: "document_idle"` and only extracts content
  when the user activates SpeedReader.
- No data is sent to external servers. All processing happens locally.
- Settings are stored in `chrome.storage.sync`, which Chrome syncs only to
  the user's own Google account.

**User impact if denied:** SpeedReader would only work on a curated list of
websites, excluding the vast majority of the web where users want to read
articles at controlled speeds.

---

## Web Accessible Resources

### `fonts/*`

**What it does:** Makes font files bundled in the extension available to
content scripts via `chrome.runtime.getURL()`.

**Why SpeedReader needs it:** The RSVP overlay renders text in fonts chosen
by the user (including OpenDyslexic). These fonts are bundled with the
extension to work offline and avoid external CDN dependencies.

---

## Commands (Keyboard Shortcuts)

### `_toggle_reader` → `Ctrl+Shift+Y`

**What it does:** Registers a global keyboard shortcut that launches the
SpeedReader overlay on the current page.

**Why SpeedReader needs it:** Provides quick, keyboard-driven access without
requiring the user to click the extension icon. The shortcut is configurable
through Chrome's shortcuts settings page.

---

## Summary Table

| Permission / Host    | Type       | Justification                                   |
| -------------------- | ---------- | ----------------------------------------------- |
| `storage`            | Permission | Persist user preferences across sessions        |
| `activeTab`          | Permission | On-demand access when user triggers extension   |
| `scripting`          | Permission | Dynamic content-script injection on user action |
| `contextMenus`       | Permission | Right-click "SpeedReader" submenu on selection  |
| `<all_urls>`         | Host perm. | General-purpose reading tool for any website    |
| `fonts/*` (WAR)      | WAR        | Offline font rendering for RSVP overlay         |
| `Ctrl+Shift+Y` (cmd) | Commands   | Global keyboard shortcut to activate reader     |
