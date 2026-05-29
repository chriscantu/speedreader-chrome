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

- `CHANGELOG.md` seeded with keep-a-changelog scaffolding (#42).
- Punctuation-aware RSVP pacing (Safari parity) — words ending in `.!?`
  pause 1.5× the base delay, `,;:` pause 1.2×, gated via the existing
  `punctuationPacing` settings flag (#15).

### Changed

### Deprecated

### Removed

### Fixed

### Security

[Unreleased]: https://github.com/chriscantu/speedreader-chrome/compare/v0.1.0...HEAD
