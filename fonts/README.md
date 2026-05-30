# Bundled fonts

Fonts shipped with the extension as web-accessible resources. The content
script references these via `chrome.runtime.getURL('fonts/...')` from
injected overlay `@font-face` rules.

## Required asset

- `OpenDyslexic-Regular.woff2` — **NOT YET COMMITTED** (see "Sourcing gap"
  below).

## Sourcing gap (blocking — OpenDyslexic only)

This subagent did not have web access to fetch the binary. The actual
`.woff2` MUST be placed at `fonts/OpenDyslexic-Regular.woff2` before the
overlay can render it. Until then, the WAR plumbing is wired but
`chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff2')` resolves to a
404. The overlay's `@font-face` rule fails silently and the
`.modal.opendyslexic` class falls back to system-ui via the family stack
in `src/core/overlay/styles.ts`.

Acceptable sources (SIL Open Font License 1.1; verify LICENSE in the
download):

- Upstream repo: <https://github.com/antijingoist/opendyslexic>
- Project site: <https://opendyslexic.org/>

Prefer the `.woff2` build (smaller, MV3-friendly). If only `.otf` /
`.ttf` are available, run them through a converter (e.g.
[`woff2_compress`](https://github.com/google/woff2)) before committing.

## License

OpenDyslexic is distributed under the SIL Open Font License 1.1.
Commit the upstream `OFL.txt` (or equivalent `LICENSE`) alongside the
font binary when it lands. Do not strip license text.

## Issue #28 — font picker disposition (NOT bundled)

The picker (`src/core/overlay/font-ids.ts`) exposes the same 5-font set
as the Safari extension's `ReaderFont` enum (`SettingsKeys.swift`). Of
those, the Safari extension **only** bundles `OpenDyslexic-Regular.woff2`
— the other 3 (New York, Georgia, Menlo) resolve via system-installed
faces.

The Chrome port mirrors that choice. The 4 non-OpenDyslexic IDs are NOT
bundled and have no sourcing gap to close:

| Picker ID | Family stack (`styles.ts`) | Disposition |
|---|---|---|
| `system` | system-ui, -apple-system, Segoe UI, Roboto, sans-serif | No bundle — OS default. |
| `opendyslexic` | 'OpenDyslexic', system-ui, … | **Bundle** — see "Sourcing gap" above. |
| `newYork` | 'New York', 'Iowan Old Style', Georgia, serif | No bundle — Apple system serif; the fallback chain (Iowan → Georgia → generic serif) covers Windows / Linux / ChromeOS. Visually drifts from Safari on non-Apple platforms; that's the parity floor, not the ceiling. |
| `georgia` | Georgia, 'Times New Roman', serif | No bundle — ships with Windows, macOS, iOS, Android, ChromeOS. |
| `menlo` | Menlo, 'Courier New', monospace | No bundle — Menlo is Apple-only; Windows falls back to Courier New, Linux to the generic monospace face. |

If a future revision decides to bundle web-font copies of New York /
Georgia / Menlo for cross-platform visual parity, drop them in this
directory and the existing `web_accessible_resources` glob (`fonts/*`)
picks them up. Add a sourcing-gap entry above mirroring the OpenDyslexic
shape (filename, expected SHA-256 once sourced, license source URL).

## Adding more fonts

Drop the `.woff2` files in this directory and they pick up the existing
`web_accessible_resources` glob (`fonts/*`) automatically — no manifest
change needed. Update the consumer (`src/core/overlay/font-ids.ts`,
`src/core/overlay/styles.ts`, and the content-script `openDyslexicFontUrl`
wiring) to reference them.
