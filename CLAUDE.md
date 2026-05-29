# CLAUDE.md

Context for Claude / AI assistants working in this repo.

## Project

SpeedReader for Chrome is a Chrome (MV3) port of [chriscantu/speed-reader](https://github.com/chriscantu/speed-reader) — a free, open-source Safari extension that delivers RSVP (Rapid Serial Visual Presentation) reading for neurodivergent readers.

## Hard constraints

- **Manifest V3.** Service worker only, no persistent background pages.
- **Fully responsive.** The reader overlay must work from ~320 px phones through 4K monitors.
- **No tracking.** Everything runs locally. No analytics, no network calls beyond fetching static extension assets.
- **Feature parity with the Safari extension is the MVP bar** — see the `scope:parity` label.

## Repo orientation

The source tree is split along the platform boundary:

- `src/core/` — platform-agnostic RSVP engine, extraction, settings schema, overlay UI. Kept portable for a future shared-core extraction across Safari + Chrome. **No `chrome.*` or `browser.*` imports allowed.** See `src/core/README.md` for the full boundary contract.
- `src/chrome/` — Chrome-specific glue: service worker (`background/`), content script (`content/`), popup, options page, and `manifest.ts`. May depend on `src/core/`; the reverse is forbidden.
- `icons/` (repo root) — platform-agnostic icon assets referenced by the manifest.

For a fuller repo-layout reference (every directory and its role), see [`STRUCTURE.md`](STRUCTURE.md).

## Agent routing (for Claude / swarm dispatch)

For routine extension work, prefer hierarchical dispatch, ~6 agents, Queen: `extension-architect`. Full daemon envelope (hierarchical-mesh, max 15, consensus) lives in [`.claude-flow/config.yaml`](docs/ruflo-setup.md#runtime-topology-claude-flowconfigyaml).

| Task | Specialist |
|---|---|
| MV3 service worker, content script, popup, manifest | `chrome-extension-engineer` |
| `src/core/` portable engine (no `chrome.*`) | `coder` |
| RSVP overlay UX, neurodivergent reading, WCAG | `a11y-extension-designer` |
| Playwright extension loading, axe a11y scans | `extension-quality-engineer` |
| Cross-cutting design, Safari↔Chrome boundary | `extension-architect` |
| Final pass before merge | `reviewer` |

Spawn on-demand; do not preallocate. Reap idle agents after task completion.

## Key references

- [`docs/superpowers/specs/2026-04-19-chrome-port-backlog-design.md`](docs/superpowers/specs/2026-04-19-chrome-port-backlog-design.md) — approved design for this initial phase.
- [`docs/superpowers/plans/2026-04-19-chrome-port-backlog.md`](docs/superpowers/plans/2026-04-19-chrome-port-backlog.md) — the setup plan.
- [`chriscantu/speed-reader`](https://github.com/chriscantu/speed-reader) — the Safari reference.

## Ways of working

- Pragmatic TDD: test-first for non-trivial logic; tests alongside for simple code.
- Before declaring work done, run the project's lint, typecheck, and tests.
- Commits are small and imperative-mood. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
