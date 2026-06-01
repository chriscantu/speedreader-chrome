# Changelog

All notable changes to **SpeedReader for Chrome** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every PR that lands a user-visible change MUST add an entry under
`[Unreleased]`. Internal refactors, doc-only edits, and CI plumbing are
exempt. At release time, `[Unreleased]` is promoted to a dated version
heading and a fresh `[Unreleased]` block is opened above it.

## [Unreleased]

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.2.0] - 2026-05-31

First Chrome Web Store submission build (unlisted testing track). Phase-1
parity with the Safari reference plus Hi-Fi overlay polish landed in M2.

### Added

- `CHANGELOG.md` seeded with keep-a-changelog scaffolding (#42).
- `PRIVACY.md` documenting Chrome Web Store privacy claims (no data
  egress, no analytics, no network, no account, no tracking) — required
  for the initial store submission (#44).
- Punctuation-aware RSVP pacing (Safari parity) — words ending in `.!?`
  pause 1.5× the base delay, `,;:` pause 1.2×, gated via the existing
  `punctuationPacing` settings flag (#15).
- Overlay close (Esc + ✕) preserves reading position in memory for the
  session — reopening on the same document and scope resumes where the
  user left off. `chrome.storage` persistence remains deferred (#25).
- Overlay now consumes the `--surface` and `--accent-soft` theme slots
  written by the applier — `.modal` background tracks `--surface`, and
  transport buttons render a tinted `--accent-soft` background on hover
  (#150).
- Context preview on pause — when the reader is paused, the overlay
  shows the surrounding sentence (previous + current + up to 3 next
  words) with the current word bolded so the user can re-orient before
  resuming. Hides on resume / done (#20).
- Popup gains a "Read selection" affordance — when the active tab has a
  non-empty selection, the popup offers a fallback path that reads just
  the selection instead of the auto-extracted article. Useful on SPAs,
  paywalls, and pages where extraction misses the user's intended text.
  Keyboard-shortcut variant deferred (#18).

### Changed

### Deprecated

### Removed

### Fixed

### Security

[Unreleased]: https://github.com/chriscantu/speedreader-chrome/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/chriscantu/speedreader-chrome/compare/v0.1.0...v0.2.0
