# Bundled fonts

Fonts shipped with the extension as web-accessible resources. The content
script references these via `chrome.runtime.getURL('fonts/...')` from
injected overlay `@font-face` rules.

## Bundled asset

- `OpenDyslexic-Regular.woff2` — committed; integrity-pinned (see below).

## Pinned font integrity

Each bundled `.woff2` is hash-pinned to defeat silent supply-chain TOFU.
`bin/verify-font-integrity.sh` parses the lines below, recomputes
`shasum -a 256` against the on-disk binaries, and fails the build if any
hash drifts. Run locally via `npm run verify:fonts`.

```
OpenDyslexic-Regular.woff2  sha256:0441bc21071e42db57c217f93fbc48d3b55a2987c02814c94dc93621c42e8695  source:opendyslexic.org (downloaded 2026-05-30)
OFL.txt                     sha256:caafcccfb70fc72458fcbda812ec8f0a06cb300cbabb87eabbb30b946124394b  source:github.com/antijingoist/opendyslexic@master/OFL.txt (fetched 2026-05-30)
```

When upgrading a font: download the new binary, replace the file, run
`shasum -a 256 fonts/<file>.woff2`, paste the new hex into the line
above, and commit the README + binary in the same PR. Same pattern
applies to `OFL.txt` if upstream rev-bumps the license header.

Acceptable upstream sources for OpenDyslexic (SIL Open Font License 1.1;
verify `OFL.txt` ships with the download):

- Upstream repo: <https://github.com/antijingoist/opendyslexic>
- Project site: <https://opendyslexic.org/>

Prefer the `.woff2` build (smaller, MV3-friendly). If only `.otf` /
`.ttf` are available, run them through a converter (e.g.
[`woff2_compress`](https://github.com/google/woff2)) before committing.

## License

OpenDyslexic is distributed under the SIL Open Font License 1.1. The
committed `fonts/OFL.txt` is the upstream license file from
`github.com/antijingoist/opendyslexic@master/OFL.txt`, preserving the
required copyright notice (Abbie Gonzalez, 2019-07-29) and Reserved
Font Name `OpenDyslexic` per OFL §1. Do not strip or replace with a
generic template — the OFL.txt sha256 is pinned above for manual
verification. (Automatic enforcement of the OFL.txt hash via
`verify:fonts` is a follow-up; the woff2 pin IS enforced.)

## Issue #28 — font picker disposition (NOT bundled)

The picker (`src/core/overlay/font-ids.ts`) exposes the same 5-font set
as the Safari extension's `ReaderFont` enum (`SettingsKeys.swift`). Of
those, the Safari extension **only** bundles `OpenDyslexic-Regular.woff2`
— the other 3 (New York, Georgia, Menlo) resolve via system-installed
faces.

The Chrome port mirrors that choice. The 4 non-OpenDyslexic IDs are NOT
bundled and have no sourcing gap to close:

| Picker ID      | Family stack (`styles.ts`)                             | Disposition                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system`       | system-ui, -apple-system, Segoe UI, Roboto, sans-serif | No bundle — OS default.                                                                                                                                                                                               |
| `opendyslexic` | 'OpenDyslexic', system-ui, …                           | **Bundle** — see "Pinned font integrity" above.                                                                                                                                                                                |
| `newYork`      | 'New York', 'Iowan Old Style', Georgia, serif          | No bundle — Apple system serif; the fallback chain (Iowan → Georgia → generic serif) covers Windows / Linux / ChromeOS. Visually drifts from Safari on non-Apple platforms; that's the parity floor, not the ceiling. |
| `georgia`      | Georgia, 'Times New Roman', serif                      | No bundle — ships with Windows, macOS, iOS, Android, ChromeOS.                                                                                                                                                        |
| `menlo`        | Menlo, 'Courier New', monospace                        | No bundle — Menlo is Apple-only; Windows falls back to Courier New, Linux to the generic monospace face.                                                                                                              |

If a future revision decides to bundle web-font copies of New York /
Georgia / Menlo for cross-platform visual parity, drop them in this
directory and the existing `web_accessible_resources` glob (`fonts/*`)
picks them up. Add a pinned-integrity entry above mirroring the OpenDyslexic
shape (filename, sha256 hash, source URL).

## Adding more fonts

Drop the `.woff2` files in this directory and they pick up the existing
`web_accessible_resources` glob (`fonts/*`) automatically — no manifest
change needed. Update the consumer (`src/core/overlay/font-ids.ts`,
`src/core/overlay/styles.ts`, and the content-script `openDyslexicFontUrl`
wiring) to reference them.
