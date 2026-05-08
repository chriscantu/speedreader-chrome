# `src/core/` — Platform-agnostic engine

This directory holds the portable parts of SpeedReader that are intended to be shared between the Chrome MV3 extension and a future Safari Web Extension port.

## Boundary contract

Code under `src/core/` MUST NOT import or reference any of the following:

- `chrome.*` APIs (e.g. `chrome.storage`, `chrome.runtime`, `chrome.tabs`)
- `browser.*` APIs (Safari/Firefox WebExtensions namespace)
- Anything from `src/chrome/` (one-way dependency: `src/chrome/` may depend on `src/core/`, never the reverse)
- Node-only globals (`process`, `Buffer`, `fs`, etc.)

Standard browser DOM and Web APIs (`document`, `window`, `Intl`, `URL`, `fetch`) are allowed — both Chrome and Safari content scripts run in a DOM context.

## What lives here (planned)

- RSVP engine — word chunking, pacing, focus-point computation
- Article extraction — Readability-style content extraction
- Settings schema and validation — Zod or hand-rolled types
- Overlay UI — shadow-DOM-isolated reader overlay components

## What does NOT live here

Anything that needs the extension messaging bus, storage, tab management, manifest, or browser-action surface. That belongs in `src/chrome/` (and, eventually, `src/safari/`).

## Why this split

Feature parity with the Safari reference (`chriscantu/speed-reader`) is the MVP bar. Once the Chrome MVP ships, the engine, extraction, and overlay are intended to be lifted into a shared package and consumed by both ports. Keeping `src/core/` clean of platform APIs from day one is what makes that lift cheap.
