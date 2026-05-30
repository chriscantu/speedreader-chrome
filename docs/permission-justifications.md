# SpeedReader — Permission Justifications

> **Purpose:** This document justifies every permission, host permission, web
> accessible resource, and command requested by the SpeedReader Chrome
> extension. It is the in-repo source of truth for the Chrome Web Store
> listing's permission-justification section (issue #44 = store-listing copy;
> issue #45 = this in-repo doc) and is linked from the manifest, `PRIVACY.md`,
> and `STRUCTURE.md`.
>
> **Authoritative against:** [`src/chrome/manifest.ts`](../src/chrome/manifest.ts).
> If this doc and the manifest disagree, the manifest is ground truth — open
> a PR to reconcile.

---

## Permissions

The manifest declares exactly four entries in `permissions`:
`storage`, `activeTab`, `scripting`, `contextMenus`.

### `storage`

**What it does:** Allows the extension to read and write user preferences
via `chrome.storage.sync`.

**Why SpeedReader needs it:** SpeedReader is an accessibility tool that must
persist user settings (reading speed in WPM, font choice including
OpenDyslexic, theme, font size, etc.) across browser sessions. The `sync`
partition ensures settings travel with the user across devices signed into
the same Chrome profile.

**Specific feature(s) requiring it:**

- Settings persistence — [`src/chrome/settings/storage.ts`](../src/chrome/settings/storage.ts)
- Overlay reading speed / font size / theme application — [`src/core/overlay/overlay.ts`](../src/core/overlay/overlay.ts), [`src/core/theme/applier.ts`](../src/core/theme/applier.ts)

**Narrower alternative considered:** `storage.local` would avoid cross-device
sync. Rejected because accessibility settings (especially WPM and font choice)
are user-identity-level preferences that should follow the user to any device
they sign into — re-tuning RSVP speed on each device is a meaningful friction
cost for the neurodivergent audience this extension targets.

**User impact if denied:** Users would lose all customizations after each
browser restart — speed, font, theme, and reading position would reset to
defaults every time.

---

### `activeTab`

**What it does:** Grants the extension temporary access to the currently
active tab when the user explicitly triggers it (clicking the toolbar popup,
firing the keyboard shortcut, or clicking the context-menu entry).
`activeTab` access is gesture-scoped: it lasts for the duration of the user
gesture and ends when the tab is navigated or closed.

**Why SpeedReader needs it:** The extension activates only on user action.
`activeTab` is the minimal-privilege model: SpeedReader can read the page
and inject its overlay **only** when the user asks it to, not on every page
load. This pairs with the lazy-injection architecture documented in
[`docs/superpowers/decisions/2026-05-08-lazy-injection-manifest.md`](superpowers/decisions/2026-05-08-lazy-injection-manifest.md)
and removes the need for broad `<all_urls>` host permissions in production.

**Specific feature(s) requiring it:**

- Popup activation — [`src/chrome/popup/activate.ts`](../src/chrome/popup/activate.ts)
- Keyboard-shortcut activation — [`src/chrome/background/commands/factory.ts`](../src/chrome/background/commands/factory.ts)
- Context-menu activation — [`src/chrome/background/context-menu/listener.ts`](../src/chrome/background/context-menu/listener.ts)
- Activation dispatch (common path) — [`src/chrome/background/activation/dispatch.ts`](../src/chrome/background/activation/dispatch.ts)

**Narrower alternative considered:** None — `activeTab` IS the narrow
alternative to broad host permissions. The only way to grant less access
than `activeTab` is to ship without the ability to read the active page,
which would mean shipping without the core RSVP feature.

**User impact if denied:** The extension cannot activate on the user's
current page at all, rendering it unusable.

---

### `scripting`

**What it does:** Allows the service worker to programmatically inject
content scripts into tabs via `chrome.scripting.executeScript`.

**Why SpeedReader needs it:** The manifest declares **no `content_scripts`
entry** — the content script is injected on demand by the service worker
after the user activates SpeedReader. The `scripting` permission is the
API surface that enables this lazy-injection model, which avoids per-tab
CPU cost on the (overwhelming) majority of pages where the user never
invokes SpeedReader.

**Specific feature(s) requiring it:**

- Lazy content-script injection — [`src/chrome/background/activation/dispatch.ts`](../src/chrome/background/activation/dispatch.ts) (`chrome.scripting.executeScript` call)

**Narrower alternative considered:** Eager injection via a `content_scripts`
manifest entry would remove the need for `scripting`. Rejected because
eager injection costs CPU and memory on every page navigation, even on
pages the user will never read — an unacceptable cost for an accessibility
tool that targets neurodivergent users who may already be on
performance-constrained devices.

**User impact if denied:** SpeedReader cannot inject its RSVP overlay into
pages, making the extension non-functional.

---

### `contextMenus`

**What it does:** Allows the extension to register entries in the browser's
right-click context menu.

**Why SpeedReader needs it:** Adds a "SpeedReader" entry to the right-click
menu when the user has selected text on a page, giving the user a
selection-scoped activation surface (read just the highlighted passage).
The menu is scoped to `contexts: ['selection']` and HTTP/HTTPS-only
`documentUrlPatterns` so it never appears on internal pages or without an
active selection.

**Specific feature(s) requiring it:**

- Menu registration — [`src/chrome/background/context-menu/register.ts`](../src/chrome/background/context-menu/register.ts), [`src/chrome/background/context-menu/install.ts`](../src/chrome/background/context-menu/install.ts)
- Click handler — [`src/chrome/background/context-menu/listener.ts`](../src/chrome/background/context-menu/listener.ts)

**Narrower alternative considered:** Drop the right-click activation
surface and rely on popup + keyboard shortcut only. Rejected because the
right-click surface is the discovery path for users who haven't yet
learned the keyboard shortcut and don't want to leave the page to click
the toolbar icon — it materially lowers the discoverability cost of the
extension for first-time users.

**User impact if denied:** Users can still activate SpeedReader via the
popup or keyboard shortcut, but the right-click activation surface is
unavailable.

---

## Host Permissions

### Production: **none**

The manifest declares **no `host_permissions`** in production builds. The
lazy-injection model (popup-open / shortcut / context-menu →
`chrome.scripting.executeScript` against the active tab) runs entirely
under the gesture-scoped `activeTab` permission, so no broad host
permission is required for the extension to function on arbitrary pages.

See the architectural decision record:
[`docs/superpowers/decisions/2026-05-08-lazy-injection-manifest.md`](superpowers/decisions/2026-05-08-lazy-injection-manifest.md).

This is the most-privilege-conscious arrangement a general-purpose reading
extension can ship: no passive host access at all, every page-read is
gesture-gated.

### Test-only: `<all_urls>` (E2E build, never shipped)

The Playwright E2E build (`npm run build:e2e-ext`, emits to `dist-e2e-ext/`)
adds `host_permissions: ['<all_urls>']`. This build is gated by the
`SPEEDREADER_E2E=1` environment variable in
[`vite.e2e-ext.config.ts`](../vite.e2e-ext.config.ts) and is **never
distributed to users** — it exists only because `activeTab` requires
gesture-provenance which the Chrome DevTools Protocol cannot dispatch,
so end-to-end test runs need the broader host permission to drive the
activation chain headlessly.

The shipped CWS package is built from `npm run build`, which produces
`dist/` without the `host_permissions` entry.

---

## Web Accessible Resources

### `fonts/*` (matched against `<all_urls>`)

**What it does:** Makes font files bundled inside the extension reachable
from web pages via `chrome.runtime.getURL()`, so the injected overlay's CSS
can reference them with `@font-face { src: url(chrome-extension://…) }`.

**Why SpeedReader needs it:** The RSVP overlay renders text in fonts chosen
by the user, including OpenDyslexic. Bundling the fonts keeps the
extension's "no external network calls" guarantee (no CDN fetch) and
means the fonts work offline.

**Specific feature(s) requiring it:**

- OpenDyslexic toggle and overlay font rendering — [`src/chrome/content/index.ts`](../src/chrome/content/index.ts), [`src/core/overlay/overlay.ts`](../src/core/overlay/overlay.ts)

**Why `matches: ['<all_urls>']` on the WAR entry:** The activation model
allows the overlay to run on any page the user invokes it on (under
`activeTab`), so the font asset URL must be reachable from any origin.
Tightening the WAR `matches` list to specific origins would require
enumerating every page the overlay can ever run on — which is exactly
what the lazy-injection model intentionally avoids. The `<all_urls>` in
the WAR entry is NOT a host permission; it scopes which web origins can
load the bundled font files via `chrome-extension://` URLs.

---

## Commands (Keyboard Shortcuts)

The `commands` manifest field does **not** require a corresponding entry in
`permissions` — it is an implicit API. It is documented here for store-listing
review completeness.

### `_toggle_reader`

**Default binding:**

- Windows / Linux / ChromeOS: `Ctrl+Shift+Y`
- macOS: `MacCtrl+Shift+Y` (literal `Control`, NOT `Cmd` — `Cmd+Shift+Y` is
  reserved by Chrome on Mac for History; `Cmd+Shift+R` collides with
  hard-reload)

**What it does:** Registers a global keyboard shortcut that activates
SpeedReader on the current tab.

**Why SpeedReader needs it:** Keyboard-driven activation is a first-class
accessibility affordance for users who cannot or prefer not to reach for
the mouse to click the toolbar icon. The user can remap the shortcut from
Chrome's `chrome://extensions/shortcuts` page.

**Specific feature(s) requiring it:**

- Command-handler factory — [`src/chrome/background/commands/factory.ts`](../src/chrome/background/commands/factory.ts)
- Activation dispatch entry point — [`src/chrome/background/activation/dispatch.ts`](../src/chrome/background/activation/dispatch.ts)

---

## externally_connectable: intentionally omitted

The manifest does NOT declare `externally_connectable`. Manifest V3's
default is closed (no web origin can reach the service worker's
`onMessage` / `onConnect`). This is documented inline in
[`src/chrome/manifest.ts`](../src/chrome/manifest.ts) so future PRs cannot
silently open the surface.

See [`docs/superpowers/decisions/2026-05-22-sw-lifecycle-activation.md`](superpowers/decisions/2026-05-22-sw-lifecycle-activation.md)
§5.

---

## Summary Table

| Entry            | Manifest field             | Type      | Justification                                                      |
| ---------------- | -------------------------- | --------- | ------------------------------------------------------------------ |
| `storage`        | `permissions`              | API perm  | Persist WPM / font / theme via `chrome.storage.sync`               |
| `activeTab`      | `permissions`              | API perm  | Gesture-scoped access to the active tab; replaces broad host perms |
| `scripting`      | `permissions`              | API perm  | Lazy content-script injection from the SW                          |
| `contextMenus`   | `permissions`              | API perm  | Right-click "SpeedReader" entry on text selection                  |
| _(none)_         | `host_permissions`         | Host perm | Production: omitted by design (lazy-injection under `activeTab`)   |
| `<all_urls>`     | `host_permissions`         | Host perm | **E2E build only**, gated by `SPEEDREADER_E2E=1`; never shipped    |
| `fonts/*`        | `web_accessible_resources` | WAR       | Offline font rendering (OpenDyslexic etc.) in the injected overlay |
| `_toggle_reader` | `commands`                 | Command   | Global keyboard shortcut to activate the reader                    |
