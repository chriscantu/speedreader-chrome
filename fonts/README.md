# Bundled fonts

Fonts shipped with the extension as web-accessible resources. The content
script references these via `chrome.runtime.getURL('fonts/...')` from
injected overlay `@font-face` rules.

## Required asset

- `OpenDyslexic-Regular.woff2` — **NOT YET COMMITTED** (see "Sourcing gap"
  below).

## Sourcing gap (blocking)

This subagent did not have web access to fetch the binary. The actual
`.woff2` MUST be placed at `fonts/OpenDyslexic-Regular.woff2` before the
overlay can render it. Until then, the WAR plumbing is wired but
`chrome.runtime.getURL('fonts/OpenDyslexic-Regular.woff2')` resolves to a
404.

Acceptable sources (Apache-2.0 OFL-style license, verify the LICENSE in
the download):

- Upstream repo: <https://github.com/antijingoist/opendyslexic>
- Project site: <https://opendyslexic.org/>

Prefer the `.woff2` build (smaller, MV3-friendly). If only `.otf` /
`.ttf` are available, run them through a converter (e.g.
[`woff2_compress`](https://github.com/google/woff2)) before committing.

## License

OpenDyslexic is distributed under the SIL Open Font License 1.1.
Commit the upstream `OFL.txt` (or equivalent `LICENSE`) alongside the
font binary when it lands. Do not strip license text.

## Adding more fonts (#28)

Issue #28 bundles the other four reading-comfort fonts. Drop their
`.woff2` files in this directory and they pick up the existing
`web_accessible_resources` glob (`fonts/*`) automatically — no manifest
change needed. Update the consumer (`src/core/overlay/`) to reference
them per #27's font-picker wiring.
