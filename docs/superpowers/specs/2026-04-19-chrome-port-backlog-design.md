# SpeedReader Chrome Port — Backlog & Repo Setup Design

**Date:** 2026-04-19
**Status:** Approved
**Scope:** Initial repo scaffold, GitHub project setup, and exhaustive issue backlog for porting the SpeedReader Safari extension (`chriscantu/speed-reader`) to a Chrome (MV3) extension.

---

## Problem Statement

**User:** Neurodivergent readers (ADHD, dyslexia, processing differences) who use Chrome (desktop and Android) and are currently excluded from SpeedReader's RSVP accessibility bridge. Existing Chrome alternatives are paid, unreliable, or both.

**Problem:** SpeedReader ships only for Safari (iOS / iPadOS / macOS). Chrome users with the same reading needs cannot use it.

**Impact:** Chrome represents the majority of web users; locking a free accessibility tool to Safari bars most of the population it is built for.

**Evidence:** The Safari extension is shipped and validated (see `chriscantu/speed-reader` README). This is a delivery gap, not a validation gap.

**Constraints:**
- Chrome MV3 extension model (service worker; no persistent background pages).
- Feature parity with the Safari extension is the MVP target.
- Solo maintainer — scope must stay portable, not expanded.
- Chrome Web Store distribution (different review model than App Store).
- MIT-licensed, free, no tracking.
- Fully responsive UI — mobile, tablet, and desktop viewports.

**Known unknowns:**
- Does the Safari extraction code port cleanly, or is a fresh Readability-based extractor simpler?
- Does OpenDyslexic font loading require `web_accessible_resources` work that the Safari build bypassed?
- Settings schema: Safari uses App Groups + a companion app; Chrome is `chrome.storage.sync` only. What is the migration / versioning strategy?
- How much of the Safari test suite is portable to a Chrome/Vitest + Playwright harness?

---

## Systems Analysis Summary

**Dependencies:** Chrome MV3 platform (service worker, content script, popup, options, `chrome.commands`); `chrome.storage.sync`; Readability-style extractor; OpenDyslexic font asset; Chrome Web Store distribution. Solo ownership. Safari repo (`chriscantu/speed-reader`) as reference.

**Second-order effects:** Code-reuse pressure toward a shared core across Safari + Chrome (validated user preference; see handoff note). Doubled support surface. Responsive overlay replaces Safari's per-platform layouts. No companion app — options page is the settings home.

**Failure modes:** Extraction failure on SPAs / paywalls (mitigate with selection fallback); restricted pages like `chrome://` and the Web Store (graceful popup state); service-worker cold-start latency (keep heavy work in content script); storage quota on future bulk state (use `chrome.storage.local`); shortcut collisions with site hotkeys (scope shortcuts to focused overlay); Chrome Web Store rejection on broad host permissions (justify explicitly in store listing).

**Org impact:** Solo-owned; opt-in distribution; no infrastructure scaling cost; ongoing burden is store review + MV3 platform drift.

**Key risks:**
1. Article extraction quality across the modern web — single biggest UX determinant.
2. Responsive overlay correctness across 320 px – 4K — new territory vs. Safari.
3. Chrome Web Store review on broad host permissions — requires a clear justification doc.

---

## Approved Design

### 1. Repo and GitHub setup

- **Local path:** `/Users/cantu/repos/speedreader-chrome/` (flat, under user home).
- **GitHub repo:** `chriscantu/speedreader-chrome`, public, MIT license.
- **Default branch:** `main`. No branch protection in Phase 1 (solo dev).
- **Projects v2 board:** `SpeedReader Chrome`, connected to the repo, auto-adds new issues.
  - **M1 Board view** — kanban (`Backlog`, `Ready`, `In Progress`, `In Review`, `Done`), filtered to milestone `M1: MVP parity`.
  - **All Issues view** — table, grouped by `area:*`.
- **Milestones:**
  - `M1: MVP parity` — all `phase-1` issues; success = published to Chrome Web Store.
  - `M2: v1 remaining` — Safari's v1 tail (navigation, customization, polish), Chrome-adapted.
  - `M3: Future` — no target date; tracked-only ideas.

### 2. Initial commit contents

Commit message: `Initial commit: project scaffold and contribution docs`.

- `README.md` — Chrome-adapted from the Safari README. Keeps the tone and outline (How It Works, Features, Controls, Settings, Why This Exists). Install section covers the Chrome Web Store link (placeholder until M1 ships) and "Load unpacked" for dev.
- `LICENSE` — MIT, © Chris Cantu, 2026.
- `.gitignore` — Node baseline (`node_modules/`, `dist/`, `.env`, `.DS_Store`, `*.log`, `coverage/`, editor directories).
- `CONTRIBUTING.md` — Chrome-adapted. Dev-setup section is a `TODO(#1)` placeholder pointing at the tooling-setup issue, which lands the real instructions when executed. Covers branch naming (`feature/<short>`), commit style, PR process.
- `CLAUDE.md` — Chrome-adapted: project context, MV3 constraint, responsive constraint, no-tracking constraint, pointers to `PRINCIPLES.md` / `STRUCTURE.md` when those land.
- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/ISSUE_TEMPLATE/task.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

**Deliberately excluded from the initial commit:** `ROADMAP.md` (milestones + board replace it); `PRINCIPLES.md`, `STRUCTURE.md`, `CHANGELOG.md` (each gets its own issue).

### 3. Label taxonomy

All labels are created via `gh label create` before issues are filed.

**Area** (teal):
`area:extraction`, `area:rsvp-engine`, `area:overlay-ui`, `area:controls`, `area:settings`, `area:theming`, `area:fonts`, `area:keyboard`, `area:responsive`, `area:testing`, `area:build`, `area:docs`, `area:store-listing`.

**Scope** (purple):
`scope:parity` (mirrors Safari behavior), `scope:chrome-port` (exists only because of the port).

**Phase** (orange):
`phase-1` (included in M1), `future` (tracked only).

**Meta** (neutral / red):
`good-first-issue`, `blocked`, `needs-spec`, `bug`, `enhancement`.

### 4. Issue backlog

Every issue gets `area:*`, `scope:*`, and a phase label. `enhancement` is added to all feature work; `needs-spec` is called out where noted.

#### M1: MVP parity — `phase-1` (45 issues)

**Port bootstrap — `scope:chrome-port`**
1. Set up TypeScript + Vite build toolchain — `area:build`
2. Set up ESLint + Prettier + editorconfig — `area:build`
3. Create MV3 `manifest.json` — `area:build`
4. Scaffold service worker — `area:build`
5. Scaffold content script — `area:build`
6. Scaffold browser-action popup — `area:build`
7. Scaffold options page — `area:settings`
8. Organize `src/core` vs `src/chrome` for future shared-core extraction — `area:build`
9. Configure `web_accessible_resources` for bundled fonts — `area:fonts`
10. Create extension icon assets (16 / 48 / 128 px) — `area:build`
11. Set up GitHub Actions CI (lint, typecheck, test, build) — `area:build`

**RSVP engine — `scope:parity`**
12. Core RSVP word-display engine with timing — `area:rsvp-engine`
13. ORP (optimal recognition point) per-word highlighting — `area:rsvp-engine`
14. Punctuation pacing (micro-pauses on `. , ; : ! ?`) — `area:rsvp-engine`
15. WPM control (100–600) — `area:rsvp-engine`

**Extraction — `scope:parity`**
16. Article extraction via Readability — `area:extraction` — `needs-spec` (library vs. Safari port)
17. Text-selection fallback — `area:extraction`

**Overlay UI — `scope:parity`**
18. Overlay layout with focus-point word display — `area:overlay-ui`
19. Context preview on pause (surrounding sentence) — `area:overlay-ui`
20. Overlay chrome (close button, control bar) — `area:overlay-ui`

**Controls — `scope:parity`**
21. Play / pause (tap / click + Space) — `area:controls`
22. Previous / next sentence (buttons + ← →) — `area:controls`
23. Speed slider + ↑ ↓ adjustment — `area:controls`
24. Close (Esc + ✕) — `area:controls`

**Theming & fonts — `scope:parity`**
25. Light / dark / system theme — `area:theming`
26. OpenDyslexic font toggle — `area:fonts`
27. Font picker (5 fonts matching Safari) — `area:fonts`
28. Font-size stepper — `area:fonts`

**Settings — `scope:parity`**
29. Options page UI — `area:settings`
30. Settings persistence via `chrome.storage.sync` — `area:settings`
31. Settings schema + migration strategy — `area:settings` — `needs-spec` (versioning)

**Keyboard — `scope:parity`**
32. In-overlay keyboard shortcuts (Space / arrows / Esc) — `area:keyboard`
33. `chrome.commands` hotkey to open reader — `area:keyboard`

**Responsive — `scope:chrome-port`**
34. Responsive overlay 320 px → 4K — `area:responsive`, `area:overlay-ui` — `needs-spec` (breakpoint strategy)
35. Touch controls for phone / tablet viewports — `area:responsive`, `area:controls`

**Testing — `scope:parity` unless noted**
36. Vitest unit-test harness — `area:testing` — `scope:chrome-port`
37. Playwright E2E harness for the extension — `area:testing` — `scope:chrome-port`
38. Port applicable Safari JS unit tests — `area:testing`

**Docs — mixed scope**
39. `PRINCIPLES.md` (port + Chrome-adapt) — `area:docs` — `scope:parity`
40. `STRUCTURE.md` documenting repo layout — `area:docs` — `scope:chrome-port`
41. `CHANGELOG.md` (keep-a-changelog) — `area:docs` — `scope:chrome-port`

**Chrome Web Store — `scope:chrome-port`**
42. Store-listing assets (screenshots, description, icon) — `area:store-listing`
43. Privacy policy — `area:store-listing`
44. Permission-justification document — `area:store-listing`
45. First Chrome Web Store submission — `area:store-listing`

#### M2: v1 remaining — `future` (6 issues)

46. Progress scrubber — `area:controls` — `scope:parity`
47. Reading-position memory — `area:rsvp-engine`, `area:settings` — `scope:parity`
48. Reading history — `area:settings` — `scope:parity`
49. Background-color customization — `area:theming` — `scope:parity`
50. Chunk size (2–3-word display) — `area:rsvp-engine` — `scope:parity`
51. Overlay polish (ORP alignment, preview accuracy, stability) — `area:overlay-ui` — `scope:parity`

#### M3: Future ideas — `future` (5 issues)

52. Saved articles — `area:extraction`, `area:settings` — `scope:parity`
53. PDF / ePub import — `area:extraction` — `scope:parity`
54. Reading stats — `area:settings` — `scope:parity`
55. iframe extraction — `area:extraction` — `scope:parity`
56. i18n via `chrome.i18n` — `area:docs`, `area:settings` — `scope:chrome-port`

**Total: 56 issues.** Cross-device settings sync is implicit in #30 (`chrome.storage.sync` is device-synced by default) and is not filed as its own issue.

---

## Out of Scope for This Design

- Actual tooling decisions (TypeScript version, bundler specifics, test runner config details) — these live inside issues #1, #2, #36, #37 and are decided when those issues are picked up.
- Extracting a shared-core library today. Issue #8 only *organizes* the repo to preserve that option.
- Renaming the Safari repo to match the `speedreader-*` convention — explicitly deferred.
- Android Chrome extension delivery specifics — responsive design covers the UI question; delivery is a non-issue because Android Chrome does not host extensions (desktop + responsive design is the practical surface).

---

## Acceptance Criteria for This Workstream

- [ ] Local directory is `/Users/cantu/repos/speedreader-chrome/` and is a git repo on `main`.
- [ ] `chriscantu/speedreader-chrome` exists on GitHub (public, MIT).
- [ ] Initial commit is pushed and contains exactly the files in section 2.
- [ ] All labels from section 3 exist on the repo.
- [ ] Milestones `M1`, `M2`, `M3` exist with the descriptions from section 1.
- [ ] A `SpeedReader Chrome` Projects v2 board exists and is linked to the repo with the two views described.
- [ ] All 56 issues from section 4 are filed with correct labels and milestones.
- [ ] Issues #16, #31, #34 are labeled `needs-spec`.
