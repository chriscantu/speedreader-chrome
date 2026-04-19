# SpeedReader Chrome — Backlog & Repo Setup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the local working directory, initialize git, create the `chriscantu/speedreader-chrome` GitHub repo, land the initial scaffold commit, create labels / milestones / Projects v2 board, and file all 56 issues from the approved spec.

**Architecture:** Pure setup work. No runtime code lands in this plan — tooling decisions live inside the filed issues. Issue creation is driven by a checked-in TSV data file + a bash script so the 56 issues are repeatable and auditable.

**Tech Stack:** git, `gh` CLI (including `gh project` for ProjectsV2), bash (invoked via `bash script.sh` — user's shell is fish), Markdown.

**Source spec:** [2026-04-19-chrome-port-backlog-design.md](../specs/2026-04-19-chrome-port-backlog-design.md)

---

## Preconditions

- `gh` CLI is installed and authenticated as `chriscantu` (verified).
- `gh` token currently has `repo` + `workflow` scopes; the `project` scope is added in Task 8.
- Working directory is `/Users/cantu/repos/chrome-speed-reader/` (will be renamed in Task 1).

---

## Task 1: Rename local directory and initialize git

**Files:**
- Rename: `/Users/cantu/repos/chrome-speed-reader/` → `/Users/cantu/repos/speedreader-chrome/`
- Create: `/Users/cantu/repos/speedreader-chrome/.gitignore`

- [ ] **Step 1.1: Rename the working directory**

Run (from any shell, path-absolute so no `cd` issues):

```fish
mv /Users/cantu/repos/chrome-speed-reader /Users/cantu/repos/speedreader-chrome
```

Expected: command completes silently. `ls /Users/cantu/repos/` shows `speedreader-chrome` and no longer shows `chrome-speed-reader`.

> Note: the auto-memory directory at `/Users/cantu/.claude/projects/-Users-cantu-repos-chrome-speed-reader/` is now keyed off the old path. Leave it — Claude's memory system will create a fresh keyed path on next run under the new working dir. Manual migration is optional and out of scope for this plan.

- [ ] **Step 1.2: Initialize git with `main` as the default branch**

```fish
cd /Users/cantu/repos/speedreader-chrome
git init -b main
```

Expected output contains: `Initialized empty Git repository in /Users/cantu/repos/speedreader-chrome/.git/` and `(hint: Using 'main' as the name for the initial branch)` or silent if default is already `main`.

- [ ] **Step 1.3: Create `.gitignore`**

Create `/Users/cantu/repos/speedreader-chrome/.gitignore` with exactly:

```
# Dependencies
node_modules/

# Build output
dist/
build/

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Coverage
coverage/
.nyc_output/

# OS
.DS_Store
Thumbs.db

# Editors
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea/
*.swp
*.swo
*~

# TypeScript
*.tsbuildinfo
```

- [ ] **Step 1.4: Verify**

```fish
cd /Users/cantu/repos/speedreader-chrome
git status
```

Expected: `On branch main`, lists `.gitignore`, `docs/` (from the design doc + this plan), and `excalidraw.log` as untracked.

The `excalidraw.log` file at the repo root is a stray artifact from the session that predates this plan — delete it:

```fish
rm /Users/cantu/repos/speedreader-chrome/excalidraw.log
```

---

## Task 2: Create top-level docs — LICENSE, README

**Files:**
- Create: `LICENSE`
- Create: `README.md`

- [ ] **Step 2.1: Create `LICENSE`**

Create `/Users/cantu/repos/speedreader-chrome/LICENSE` with exactly:

```
MIT License

Copyright (c) 2026 Chris Cantu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2.2: Create `README.md`**

Create `/Users/cantu/repos/speedreader-chrome/README.md` with exactly:

````markdown
# SpeedReader for Chrome

**Reading shouldn't be this hard.**

For millions of neurodivergent readers — people with ADHD, dyslexia, or other processing differences — traditional reading is exhausting. Eyes jump between lines, focus drifts mid-paragraph, and articles get abandoned halfway through.

RSVP (Rapid Serial Visual Presentation) changes that. By showing one word at a time at a controlled pace, it removes the cognitive overhead of eye tracking and line scanning. Your brain just... processes.

**SpeedReader for Chrome is a free, open-source Chrome extension that brings RSVP reading to every web page.** Fully responsive — works across desktop, tablet, and mobile viewports.

*This is the Chrome port of [chriscantu/speed-reader](https://github.com/chriscantu/speed-reader) (Safari).*

## Status

🚧 **In development.** First release targets the Chrome Web Store via the [M1 milestone](https://github.com/chriscantu/speedreader-chrome/milestone/1).

## Features (planned for M1)

- Focus-point (ORP) highlighting for each word
- Context preview when you pause
- Punctuation pacing (natural micro-pauses)
- Adjustable speed (100–600 WPM)
- OpenDyslexic font toggle and font picker
- Light, dark, and system theme
- Keyboard shortcuts (Space / arrows / Esc)
- Text-selection fallback when auto-extract fails
- Fully responsive — phone, tablet, desktop
- Runs entirely locally — no tracking, no data leaves your device

## Install (development)

Once tooling lands in [issue #1](https://github.com/chriscantu/speedreader-chrome/issues/1):

```bash
git clone https://github.com/chriscantu/speedreader-chrome.git
cd speedreader-chrome
npm install
npm run build
```

Then load the `dist/` directory as an unpacked extension at `chrome://extensions` (Developer Mode on).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

## Why this exists

The Safari version of SpeedReader was born out of personal need — as someone with ADHD and suspected dyslexia, traditional reading is genuinely tiring, and RSVP works for my brain in a way paragraphs of text don't. Chrome users deserve the same free, unlocked accessibility bridge.
````

- [ ] **Step 2.3: Verify files exist**

```fish
ls -la /Users/cantu/repos/speedreader-chrome/LICENSE /Users/cantu/repos/speedreader-chrome/README.md
```

Expected: both files listed, non-zero size.

---

## Task 3: Create `CONTRIBUTING.md` and `CLAUDE.md`

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `CLAUDE.md`

- [ ] **Step 3.1: Create `CONTRIBUTING.md`**

Create `/Users/cantu/repos/speedreader-chrome/CONTRIBUTING.md` with exactly:

````markdown
# Contributing to SpeedReader for Chrome

Thanks for your interest. This project is the Chrome port of [SpeedReader for Safari](https://github.com/chriscantu/speed-reader), built to bring RSVP reading to Chrome users — especially neurodivergent readers (ADHD, dyslexia, processing differences).

## Development setup

> **TODO(#1):** Real setup instructions land when [issue #1](https://github.com/chriscantu/speedreader-chrome/issues/1) (TypeScript + Vite toolchain) ships. Until then, the repo is docs + issue templates only.

## Branch naming

- Features: `feature/<short-description>` (e.g., `feature/rsvp-engine`)
- Bug fixes: `fix/<short-description>`
- Docs: `docs/<short-description>`

## Commits

- Imperative mood: "Add ORP highlighting" — not "Added" or "Adds".
- One logical change per commit.
- Reference issues in the body where applicable (e.g., `Closes #12`).

## Pull requests

- Open against `main`.
- Use the PR template and fill out every section.
- CI (lint, typecheck, tests, build) must pass before review.
- Keep PRs focused. If a PR grows beyond one issue's scope, split it.

## Issues

- Check open issues before filing a duplicate.
- Use the issue templates (`Bug report`, `Feature request`, `Task`).
- Tag with the appropriate `area:*` and `scope:*` labels when you can.

## Code of conduct

Be kind. This is a small project; good faith goes a long way.
````

- [ ] **Step 3.2: Create `CLAUDE.md`**

Create `/Users/cantu/repos/speedreader-chrome/CLAUDE.md` with exactly:

````markdown
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

Once scaffolded (issue #1), the layout follows:

- `src/core/` — platform-agnostic RSVP engine, extraction, settings schema, overlay UI. Kept portable for a future shared-core extraction across Safari + Chrome.
- `src/chrome/` — Chrome-specific glue: service worker, content script, popup, options page, `chrome.*` API adapters.

Until then, the repo is docs + issue templates only.

## Key references

- [`docs/superpowers/specs/2026-04-19-chrome-port-backlog-design.md`](docs/superpowers/specs/2026-04-19-chrome-port-backlog-design.md) — approved design for this initial phase.
- [`docs/superpowers/plans/2026-04-19-chrome-port-backlog.md`](docs/superpowers/plans/2026-04-19-chrome-port-backlog.md) — the setup plan.
- [`chriscantu/speed-reader`](https://github.com/chriscantu/speed-reader) — the Safari reference.

## Ways of working

- Pragmatic TDD: test-first for non-trivial logic; tests alongside for simple code.
- Before declaring work done, run the project's lint, typecheck, and tests.
- Commits are small and imperative-mood. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
````

- [ ] **Step 3.3: Verify**

```fish
ls -la /Users/cantu/repos/speedreader-chrome/CONTRIBUTING.md /Users/cantu/repos/speedreader-chrome/CLAUDE.md
```

Expected: both listed, non-zero size.

---

## Task 4: Create `.github/` issue and PR templates

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/ISSUE_TEMPLATE/task.md`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 4.1: Create the `.github/ISSUE_TEMPLATE/` directory**

```fish
mkdir -p /Users/cantu/repos/speedreader-chrome/.github/ISSUE_TEMPLATE
```

- [ ] **Step 4.2: Create `bug_report.md`**

Create `/Users/cantu/repos/speedreader-chrome/.github/ISSUE_TEMPLATE/bug_report.md` with exactly:

```markdown
---
name: Bug report
about: Something is broken
title: "[bug] "
labels: bug
---

**What happened?**
A clear, concise description.

**What did you expect?**

**Steps to reproduce**
1.
2.
3.

**Environment**
- Chrome version:
- OS:
- Viewport (if responsive-related): desktop / tablet / phone

**Page / URL where it happened**
(if applicable)

**Screenshots**
(if applicable)
```

- [ ] **Step 4.3: Create `feature_request.md`**

Create `/Users/cantu/repos/speedreader-chrome/.github/ISSUE_TEMPLATE/feature_request.md` with exactly:

```markdown
---
name: Feature request
about: Suggest an idea
title: "[feat] "
labels: enhancement
---

**What problem does this solve?**
Who has the problem? What are they doing when they hit it?

**Proposed solution**

**Alternatives considered**

**Additional context**
```

- [ ] **Step 4.4: Create `task.md`**

Create `/Users/cantu/repos/speedreader-chrome/.github/ISSUE_TEMPLATE/task.md` with exactly:

```markdown
---
name: Task
about: A chunk of work on the roadmap (internal)
title: ""
labels: enhancement
---

**Summary**
One sentence on what this does.

**Context / rationale**

**Acceptance criteria**
- [ ]
- [ ]
- [ ]

**Out of scope**

**Notes / references**
```

- [ ] **Step 4.5: Create `PULL_REQUEST_TEMPLATE.md`**

Create `/Users/cantu/repos/speedreader-chrome/.github/PULL_REQUEST_TEMPLATE.md` with exactly:

```markdown
## Summary

Closes #

## What changed

-
-

## How to test

- [ ]
- [ ]

## Screenshots / recordings
(if UI)

## Checklist
- [ ] CI passes (lint, typecheck, tests, build)
- [ ] Tests added/updated where appropriate
- [ ] Docs updated where appropriate
```

- [ ] **Step 4.6: Verify**

```fish
ls -R /Users/cantu/repos/speedreader-chrome/.github
```

Expected output contains: `ISSUE_TEMPLATE`, `PULL_REQUEST_TEMPLATE.md`, and under `ISSUE_TEMPLATE/`: `bug_report.md`, `feature_request.md`, `task.md`.

---

## Task 5: Make the initial commit

**Files:** no new files; commits everything from Tasks 1–4 plus the existing design doc and this plan.

- [ ] **Step 5.1: Stage everything**

```fish
cd /Users/cantu/repos/speedreader-chrome
git add .
```

- [ ] **Step 5.2: Review staged list**

```fish
cd /Users/cantu/repos/speedreader-chrome
git status
```

Expected staged files (order not significant):

- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/ISSUE_TEMPLATE/task.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.gitignore`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `LICENSE`
- `README.md`
- `docs/superpowers/plans/2026-04-19-chrome-port-backlog.md`
- `docs/superpowers/specs/2026-04-19-chrome-port-backlog-design.md`

If `excalidraw.log` is staged, `git rm --cached excalidraw.log` before continuing (Task 1 Step 1.4 should have removed the file already).

- [ ] **Step 5.3: Commit**

Write the commit message to a temp file (fish-safe, no heredoc):

```fish
echo "Initial commit: project scaffold and contribution docs

Lands the meta-only first commit per the approved backlog design:

- MIT LICENSE (c) 2026 Chris Cantu
- README.md (Chrome-adapted from the Safari version)
- CONTRIBUTING.md with TODO(#1) pointer for dev setup
- CLAUDE.md with MV3/responsive/no-tracking constraints
- .gitignore (Node baseline)
- Issue templates (bug report, feature request, task)
- PR template
- Approved design doc and setup plan under docs/superpowers/

All implementation decisions (tooling, MV3 scaffold, CI, etc.)
live inside their own GitHub issues." > /tmp/speedreader-initial-commit.txt

cd /Users/cantu/repos/speedreader-chrome
git commit -F /tmp/speedreader-initial-commit.txt
rm /tmp/speedreader-initial-commit.txt
```

Expected: commit succeeds with one new commit on `main`.

- [ ] **Step 5.4: Verify**

```fish
cd /Users/cantu/repos/speedreader-chrome
git log --oneline
```

Expected: one commit with subject `Initial commit: project scaffold and contribution docs`.

---

## Task 6: Create the GitHub repo and push

- [ ] **Step 6.1: Create the repo on GitHub**

```fish
cd /Users/cantu/repos/speedreader-chrome
gh repo create chriscantu/speedreader-chrome \
    --public \
    --description "Free, open-source RSVP speed reading Chrome extension. Built for neurodivergent readers. Chrome port of chriscantu/speed-reader." \
    --source=. \
    --remote=origin
```

Expected output includes `https://github.com/chriscantu/speedreader-chrome` and a line about adding `origin` as a remote.

- [ ] **Step 6.2: Push `main`**

```fish
cd /Users/cantu/repos/speedreader-chrome
git push -u origin main
```

Expected: `Branch 'main' set up to track remote branch 'main' from 'origin'.`

- [ ] **Step 6.3: Verify remote repo**

```fish
gh repo view chriscantu/speedreader-chrome --json name,url,visibility,defaultBranchRef
```

Expected JSON has `"visibility":"PUBLIC"` and `"name":"speedreader-chrome"`.

---

## Task 7: Create labels

**Files:**
- Create: `scripts/create-labels.sh`

- [ ] **Step 7.1: Create the `scripts/` directory**

```fish
mkdir -p /Users/cantu/repos/speedreader-chrome/scripts
```

- [ ] **Step 7.2: Create the label-creation script**

Create `/Users/cantu/repos/speedreader-chrome/scripts/create-labels.sh` with exactly:

```bash
#!/usr/bin/env bash
# Create labels for chriscantu/speedreader-chrome.
# Idempotent-ish: uses `gh label create --force` to overwrite existing labels.

set -euo pipefail

REPO="chriscantu/speedreader-chrome"

# Format: name|color|description
# Colors follow the section-3 convention: area=teal, scope=purple, phase=orange, meta neutral/red.
LABELS=(
  # Area (teal)
  "area:extraction|1d76db|Article text extraction, selection fallback"
  "area:rsvp-engine|1d76db|Word timing, punctuation pacing, WPM"
  "area:overlay-ui|1d76db|Reader overlay layout, ORP highlight, context preview"
  "area:controls|1d76db|Play/pause, nav, speed, close"
  "area:settings|1d76db|Options page, storage, settings schema"
  "area:theming|1d76db|Light/dark/system, background colors"
  "area:fonts|1d76db|Font picker, OpenDyslexic, font size"
  "area:keyboard|1d76db|Shortcuts, commands API"
  "area:responsive|1d76db|Viewport adaptation, touch"
  "area:testing|1d76db|Unit tests, E2E, fixtures"
  "area:build|1d76db|Tooling, bundler, TS, CI"
  "area:docs|1d76db|README, CONTRIBUTING, PRINCIPLES, STRUCTURE, CHANGELOG"
  "area:store-listing|1d76db|Chrome Web Store assets and submission"

  # Scope (purple)
  "scope:parity|5319e7|Mirrors Safari behavior"
  "scope:chrome-port|5319e7|Exists only because of the Chrome port"

  # Phase (orange)
  "phase-1|d93f0b|Included in M1 MVP parity"
  "future|d93f0b|Tracked only; not in any active milestone"

  # Meta
  "good-first-issue|7057ff|Good entry point for new contributors"
  "blocked|b60205|Blocked on another issue or external dependency"
  "needs-spec|fbca04|Has meaningful unknowns; requires a spec before implementation"
  "bug|d73a4a|Something is broken"
  "enhancement|a2eeef|New feature or improvement"
)

for entry in "${LABELS[@]}"; do
  IFS='|' read -r name color description <<< "$entry"
  echo "Creating/updating label: $name"
  gh label create "$name" \
    --repo "$REPO" \
    --color "$color" \
    --description "$description" \
    --force
done

echo "Done. Labels created/updated."
```

- [ ] **Step 7.3: Run the script**

```fish
cd /Users/cantu/repos/speedreader-chrome
bash scripts/create-labels.sh
```

Expected: 22 `Creating/updating label: …` lines followed by `Done.`. Each `gh label create` call returns silently or with a `✓` message.

- [ ] **Step 7.4: Verify**

```fish
gh label list --repo chriscantu/speedreader-chrome --limit 50
```

Expected: 22 labels listed with the names above. (Default GitHub labels may also appear; that is fine.)

---

## Task 8: Create milestones (and add the `project` scope to `gh`)

**Files:**
- Create: `scripts/create-milestones.sh`

- [ ] **Step 8.1: Add `project` scope to `gh` token**

ProjectsV2 (Task 9) needs the `project` scope. Refresh the token now so both tasks are unblocked:

```fish
gh auth refresh -s project,read:project
```

Follow the interactive prompt (one-time-code + browser). On completion:

```fish
gh auth status
```

Expected: `Token scopes:` line includes both `project` and `read:project` alongside the existing `repo`, `workflow`, `gist`, `read:org`.

- [ ] **Step 8.2: Create the milestones script**

Create `/Users/cantu/repos/speedreader-chrome/scripts/create-milestones.sh` with exactly:

```bash
#!/usr/bin/env bash
# Create milestones for chriscantu/speedreader-chrome.

set -euo pipefail

REPO="chriscantu/speedreader-chrome"

create_milestone() {
  local title="$1"
  local description="$2"
  echo "Creating milestone: $title"
  gh api --method POST "repos/${REPO}/milestones" \
    --field title="$title" \
    --field description="$description" \
    --field state="open" > /dev/null
}

create_milestone "M1: MVP parity" "Feature parity with shipped Safari v1 plus Chrome-port bootstrap. Goal: published to the Chrome Web Store."
create_milestone "M2: v1 remaining" "Safari's v1 tail — navigation (scrubber, position, history), customization (bg colors, chunk size), polish (ORP alignment, preview accuracy, stability). Chrome-adapted."
create_milestone "M3: Future" "Exploratory backlog. Saved articles, PDF/ePub, reading stats, iframe extraction, i18n. No target date."

echo "Done. Milestones created."
```

- [ ] **Step 8.3: Run the script**

```fish
cd /Users/cantu/repos/speedreader-chrome
bash scripts/create-milestones.sh
```

Expected output: three `Creating milestone: …` lines, then `Done.`.

- [ ] **Step 8.4: Verify**

```fish
gh api repos/chriscantu/speedreader-chrome/milestones --jq '.[] | {number, title}'
```

Expected: three objects with titles `M1: MVP parity`, `M2: v1 remaining`, `M3: Future` and numbers 1, 2, 3.

- [ ] **Step 8.5: Record milestone numbers**

Capture the milestone numbers for use in Task 10:

```fish
gh api repos/chriscantu/speedreader-chrome/milestones \
  --jq '.[] | "\(.title)\t\(.number)"' \
  > /Users/cantu/repos/speedreader-chrome/scripts/.milestone-numbers.tsv

cat /Users/cantu/repos/speedreader-chrome/scripts/.milestone-numbers.tsv
```

Expected: three lines mapping title → number. Task 10 references this file.

> This file is kept local to `scripts/` and is **not** committed (added to `.gitignore` in Step 10.5).

---

## Task 9: Create the Projects v2 board and link it to the repo

- [ ] **Step 9.1: Create the board**

```fish
gh project create --owner chriscantu --title "SpeedReader Chrome"
```

Expected: output includes a URL like `https://github.com/users/chriscantu/projects/N`. **Record `N`** (the project number) — you need it in the next steps.

- [ ] **Step 9.2: Capture the project number**

```fish
gh project list --owner chriscantu --format json \
  | jq -r '.projects[] | select(.title=="SpeedReader Chrome") | .number' \
  > /tmp/speedreader-project-number.txt
cat /tmp/speedreader-project-number.txt
```

Expected: a single positive integer (e.g. `7`). Use `$(cat /tmp/speedreader-project-number.txt)` as `PROJECT_NUMBER` below.

- [ ] **Step 9.3: Link the board to the repo**

```fish
set PROJECT_NUMBER (cat /tmp/speedreader-project-number.txt)
gh project link "$PROJECT_NUMBER" --owner chriscantu --repo chriscantu/speedreader-chrome
```

Expected: silent success. (`gh project link` prints the project URL on success.)

- [ ] **Step 9.4: Enable auto-add of new repo issues (manual, in UI)**

ProjectsV2 workflows are managed only via the UI as of `gh` CLI 2.x. In a browser:

1. Open `https://github.com/users/chriscantu/projects/$PROJECT_NUMBER/workflows` (replace `$PROJECT_NUMBER` with the captured value).
2. Enable the **Auto-add to project** workflow.
3. Set the filter to: `repo:chriscantu/speedreader-chrome is:issue`.
4. Save.

Verification: create a temp issue (next task creates 56), and confirm it auto-appears on the board.

- [ ] **Step 9.5: Create the two views (manual, in UI)**

Also via the UI (`gh project` CLI does not support view creation):

1. **M1 Board** — Kanban layout. Group by `Status` (default). Filter: `milestone:"M1: MVP parity"`. Columns: Backlog, Ready, In Progress, In Review, Done. Save.
2. **All Issues** — Table layout. Group by label prefix `area:` (set via "Group by" dropdown). No filter. Save.

> Leave the default "View 1" or delete it — your call.

---

## Task 10: File all 56 issues

**Files:**
- Create: `scripts/issues.tsv`
- Create: `scripts/create-issues.sh`

- [ ] **Step 10.1: Create the issues TSV data file**

Create `/Users/cantu/repos/speedreader-chrome/scripts/issues.tsv` with exactly the following content. Columns are tab-separated: `milestone_title<TAB>labels<TAB>title<TAB>body`. **Tabs only, not spaces** between columns.

```tsv
M1: MVP parity	area:build,scope:chrome-port,phase-1,enhancement	Set up TypeScript + Vite build toolchain	Establish the TypeScript + Vite build toolchain for the Chrome extension. Decisions to make when picking this up: TypeScript version, module resolution, Vite plugin for MV3 (e.g. @crxjs/vite-plugin), output layout. Produces a runnable `npm run build` that emits a loadable MV3 `dist/`. Document setup in CONTRIBUTING.md (remove the TODO(#1) placeholder).
M1: MVP parity	area:build,scope:chrome-port,phase-1,enhancement	Set up ESLint + Prettier + editorconfig	Add ESLint (TypeScript rules), Prettier, and a `.editorconfig`. Wire `npm run lint` and `npm run format`. Decide on rule set (recommended: `@typescript-eslint/recommended` + `eslint-config-prettier`).
M1: MVP parity	area:build,scope:chrome-port,phase-1,enhancement	Create MV3 manifest.json	Author the `manifest.json` for Manifest V3: `manifest_version: 3`, `action`, `background.service_worker`, `content_scripts`, `options_page`, `permissions` (`storage`, `activeTab`, `scripting`), `host_permissions` (`<all_urls>`), `web_accessible_resources` (fonts — see issue #9), `commands` (hotkey — see issue #33), `icons` (16/48/128 — see issue #10). Document each permission's justification in-repo (precursor to the store-listing permission-justification doc).
M1: MVP parity	area:build,scope:chrome-port,phase-1,enhancement	Scaffold service worker	Create the MV3 service worker entry point. Responsibilities: handle `chrome.action.onClicked` (or popup-driven trigger), respond to messages from content script, register `chrome.commands` hotkey. Keep heavy work out of the worker (extraction + rendering live in the content script) — the worker only coordinates.
M1: MVP parity	area:build,scope:chrome-port,phase-1,enhancement	Scaffold content script	Create the content script entry point. Responsibilities: receive activation messages from the service worker, run extraction (issue #16), mount the overlay (issue #18), handle selection fallback (issue #17). Content script is where all DOM work happens.
M1: MVP parity	area:build,scope:chrome-port,phase-1,enhancement	Scaffold browser-action popup	Create the popup UI for the browser action. Minimal content: SpeedReader icon + title, "Start reading" button, "Open settings" link, and a graceful "Not available on this page" state for restricted pages (`chrome://`, Web Store, etc.).
M1: MVP parity	area:settings,scope:chrome-port,phase-1,enhancement	Scaffold options page	Create the options page scaffold and wire `options_page` in the manifest. Minimal render path + `chrome.storage.sync` read/write hookup. Full options UI lives in issue #29.
M1: MVP parity	area:build,scope:chrome-port,phase-1,enhancement	Organize src/core vs src/chrome for future shared-core extraction	Structure the repo so platform-agnostic code (RSVP engine, extraction logic, settings schema, overlay UI) lives in `src/core/` and Chrome-specific glue (service worker, content script, popup, options, `chrome.*` APIs) lives in `src/chrome/`. Do not extract `src/core` into its own package now — just keep the boundary clean so extraction is possible later. Document the boundary in STRUCTURE.md (issue #40).
M1: MVP parity	area:fonts,scope:chrome-port,phase-1,enhancement	Configure web_accessible_resources for bundled fonts	Bundle OpenDyslexic (and the other 4 fonts from issue #27) as extension-local assets and declare them in `manifest.json` `web_accessible_resources` so the content script can reference them from injected overlay styles. Verify font-loading works on CSP-strict pages.
M1: MVP parity	area:build,scope:chrome-port,phase-1,enhancement	Create extension icon assets (16/48/128)	Produce PNG icons at 16x16, 48x48, and 128x128. Source from the Safari extension's icon set if it ports cleanly, otherwise commission a new set. Store under `assets/icons/`. Referenced from `manifest.json` `icons` and `action.default_icon`.
M1: MVP parity	area:build,scope:chrome-port,phase-1,enhancement	Set up GitHub Actions CI	Add a workflow (`.github/workflows/ci.yml`) that runs on PRs to `main`: install, lint (issue #2), typecheck, test (issue #36), build. Matrix on Node LTS. Cache `node_modules`. Fails the PR on any red step.
M1: MVP parity	area:rsvp-engine,scope:parity,phase-1,enhancement	Core RSVP word-display engine with timing	Implement the word-by-word display engine: takes an array of words, emits them at a cadence derived from WPM (issue #15), respects pause/resume, emits current-word events for the overlay. Pure TS, no DOM — lives in `src/core/`. Test with Vitest fakes for timing.
M1: MVP parity	area:rsvp-engine,scope:parity,phase-1,enhancement	ORP (optimal recognition point) per-word highlighting	Compute the optimal recognition point for each word (the letter index that the eye anchors to — commonly floor((len-1)/2.5) or similar heuristic). Engine emits `{ word, orpIndex }` so the overlay can render the ORP character in a contrasting color. Decide on the heuristic by testing against the Safari implementation's output for a fixed corpus.
M1: MVP parity	area:rsvp-engine,scope:parity,phase-1,enhancement	Punctuation pacing	Extend the RSVP engine to add micro-pauses after words ending in `. , ; : ! ?` so content flows like speech rather than a strobe light. Configurable on/off via settings (default on). Tune pause multipliers against the Safari implementation.
M1: MVP parity	area:rsvp-engine,scope:parity,phase-1,enhancement	WPM control (100–600)	Expose WPM as a user-controllable parameter. Range 100–600, step 10, default 250. Live-update the engine cadence when the setting changes mid-playback (don't require restart).
M1: MVP parity	area:extraction,scope:parity,phase-1,enhancement,needs-spec	Article extraction via Readability	Extract the main article text from the current page. needs-spec: decide between (a) Mozilla Readability library, (b) a direct port of the Safari extractor, or (c) a hybrid. Evaluate on a fixture corpus covering blogs, news sites, SPAs, and paywalled pages. Output: normalized plain-text words for the RSVP engine. Falls back to selection-only mode (issue #17) when extraction fails.
M1: MVP parity	area:extraction,scope:parity,phase-1,enhancement	Text-selection fallback	When the user has selected text on the page, SpeedReader should read just the selection instead of running automatic extraction. This is the user-facing recovery path when auto-extraction fails on SPAs, paywalls, or odd DOM structures. Triggered from popup ("Read selection") and/or keyboard shortcut.
M1: MVP parity	area:overlay-ui,scope:parity,phase-1,enhancement	Overlay layout with focus-point word display	Render the RSVP overlay as an injected UI element: full-page-blocking modal, centered word with ORP-highlighted character, dims the underlying page. Accessible (focus trap, aria-live for current word, keyboard-friendly).
M1: MVP parity	area:overlay-ui,scope:parity,phase-1,enhancement	Context preview on pause	When paused, show the surrounding sentence (previous + current + next few words) so the user can re-orient. Show the current word within the sentence in bold. Hide on resume.
M1: MVP parity	area:overlay-ui,scope:parity,phase-1,enhancement	Overlay chrome (close button, control bar)	Render the overlay chrome: close button (top-right), control bar (bottom) with play/pause, prev/next sentence, speed slider, WPM readout. Mobile-friendly touch targets (≥44px).
M1: MVP parity	area:controls,scope:parity,phase-1,enhancement	Play / pause	Tap/click anywhere on the overlay to pause or resume. Space key also pauses/resumes. Visual state: dim the word when paused.
M1: MVP parity	area:controls,scope:parity,phase-1,enhancement	Previous / next sentence	Buttons in the control bar jump to the previous/next sentence boundary. Left/right arrow keys do the same. Sentence boundaries detected by the extractor (issue #16).
M1: MVP parity	area:controls,scope:parity,phase-1,enhancement	Speed slider + ↑ ↓ adjustment	Slider in the control bar adjusts WPM (issue #15). Up/down arrow keys increment/decrement by 10 WPM. Live-update the engine.
M1: MVP parity	area:controls,scope:parity,phase-1,enhancement	Close (Esc + ✕)	Esc key and ✕ button both close the overlay and restore the page. Preserve reading position in memory for the session (see future issue #47 for persistence).
M1: MVP parity	area:theming,scope:parity,phase-1,enhancement	Light / dark / system theme	Theme the overlay. Default: follow the system (prefers-color-scheme). User override in settings: Light, Dark, System. Live-updates when the system theme changes.
M1: MVP parity	area:fonts,scope:parity,phase-1,enhancement	OpenDyslexic font toggle	Toggle in settings: System (San Francisco/default) vs OpenDyslexic. Font bundled as a web-accessible resource (issue #9). Applies to the overlay only, not the host page.
M1: MVP parity	area:fonts,scope:parity,phase-1,enhancement	Font picker (5 fonts matching Safari)	Expand the font toggle (issue #26) into a picker with the same 5 fonts the Safari extension offers. Decide the exact font list by inspecting the Safari repo's font manifest when picking up this issue. Bundle all 5 as web-accessible resources.
M1: MVP parity	area:fonts,scope:parity,phase-1,enhancement	Font-size stepper	Stepper control in the overlay: decrease/increase font size. Range and step matches the Safari implementation. Persists to `chrome.storage.sync`.
M1: MVP parity	area:settings,scope:parity,phase-1,enhancement	Options page UI	Build the full options page UI. Sections: Speed (default WPM), Appearance (theme, font, font size), Pacing (punctuation pausing on/off), Shortcuts (reference card). Read/write `chrome.storage.sync` (issue #30). Uses the settings schema from issue #31.
M1: MVP parity	area:settings,scope:parity,phase-1,enhancement	Settings persistence via chrome.storage.sync	Persist all user settings (WPM, theme, font, font size, punctuation pausing) to `chrome.storage.sync` so they sync across the user's Chrome profile. Handle read-before-ready (debounce writes, initial-load defaults). No companion app — the options page is the settings home.
M1: MVP parity	area:settings,scope:parity,phase-1,enhancement,needs-spec	Settings schema + migration strategy	needs-spec: define the versioned settings schema used by `chrome.storage.sync`. Capture: field names, defaults, types, version field, migration function signature. Ship a v1 schema in this issue; the migration hook lands now so future changes don't break old installs.
M1: MVP parity	area:keyboard,scope:parity,phase-1,enhancement	In-overlay keyboard shortcuts	Wire keyboard shortcuts while the overlay is focused: Space (play/pause), ← → (prev/next sentence), ↑ ↓ (speed ±10 WPM), Esc (close). Shortcuts are scoped to the overlay's focus trap — they never fire when overlay is closed or unfocused, preventing collisions with page hotkeys (e.g., YouTube Space, Docs arrows).
M1: MVP parity	area:keyboard,scope:parity,phase-1,enhancement	chrome.commands hotkey to open reader	Register a `commands` entry in `manifest.json` so users can open SpeedReader via a keyboard shortcut (e.g., Alt+S) configurable at `chrome://extensions/shortcuts`. Default suggested key: Alt+S (Mac: Alt+S). Document in README + options page.
M1: MVP parity	area:responsive,area:overlay-ui,scope:chrome-port,phase-1,enhancement,needs-spec	Responsive overlay 320 px → 4K	needs-spec: define breakpoint strategy and overlay layout rules for 320 px phones through 4K monitors. Decide: single fluid layout vs. a small number of named breakpoints, how control bar adapts to narrow widths, how the word-area scales (vw units vs. clamp()), how large-screen behavior avoids an over-large word.
M1: MVP parity	area:responsive,area:controls,scope:chrome-port,phase-1,enhancement	Touch controls for phone / tablet viewports	When the overlay is rendered on touch-primary viewports (no pointer:fine media query), enlarge tap targets, switch to tap-to-pause (no keyboard shortcuts expected), and ensure the control bar stays thumb-reachable. Depends on issue #34's breakpoint decisions.
M1: MVP parity	area:testing,scope:chrome-port,phase-1,enhancement	Vitest unit-test harness	Set up Vitest for unit-testing `src/core/` (RSVP engine, extraction, settings schema, ORP computation). Wire `npm test`. Exclude `src/chrome/` from unit tests — those require an extension runtime (issue #37).
M1: MVP parity	area:testing,scope:chrome-port,phase-1,enhancement	Playwright E2E harness for the extension	Set up Playwright with the `--load-extension` flag to drive a real Chromium instance with SpeedReader loaded. Wire `npm run test:e2e`. Cover: popup opens, extraction runs on a fixture page, overlay renders, play/pause works. Runs in CI (headless).
M1: MVP parity	area:testing,scope:parity,phase-1,enhancement	Port applicable Safari JS unit tests	Review the Safari repo's JS test suite. Port tests that cover logic we're reusing (ORP computation, punctuation pacing, extraction heuristics, settings migrations). Skip Safari-specific tests (Swift tests, Safari regression harness). Target: shared-core tests run unchanged on both platforms in the future.
M1: MVP parity	area:docs,scope:parity,phase-1,enhancement	PRINCIPLES.md (port + Chrome-adapt)	Port the Safari repo's `PRINCIPLES.md` to this repo. Adapt any Safari/Apple-specific wording. Keep the core principles (accessibility-first, no tracking, simple UX, keyboard-accessible, respect system settings) intact.
M1: MVP parity	area:docs,scope:chrome-port,phase-1,enhancement	STRUCTURE.md documenting repo layout	Document the repo structure: `src/core` vs `src/chrome` boundary, assets, tests, scripts, docs. Updated whenever structure changes. Linked from CLAUDE.md.
M1: MVP parity	area:docs,scope:chrome-port,phase-1,enhancement	CHANGELOG.md (keep-a-changelog)	Add a `CHANGELOG.md` following keep-a-changelog.com format. Seed with the `[Unreleased]` section. Every PR updates it; every release promotes `[Unreleased]` to a dated version.
M1: MVP parity	area:store-listing,scope:chrome-port,phase-1,enhancement	Store listing assets (screenshots, description, icon)	Produce Chrome Web Store listing assets: 3–5 screenshots at 1280×800 or 640×400, a short description (≤132 chars), a detailed description (Markdown-ish), promotional tile (440×280), store icon (128×128). Reuse Safari screenshots where they translate; take fresh Chrome screenshots across viewports (desktop, tablet, mobile).
M1: MVP parity	area:store-listing,scope:chrome-port,phase-1,enhancement	Privacy policy	Write a privacy policy (the Chrome Web Store requires one when broad host permissions are requested). Accurate claims: no data leaves the device, no analytics, no network calls, no account. Host as `PRIVACY.md` in-repo and as a static GitHub Pages URL referenced by the store listing.
M1: MVP parity	area:store-listing,scope:chrome-port,phase-1,enhancement	Permission-justification document	Write the in-repo justification document (linked from the store listing) explaining every permission and host permission requested: `<all_urls>` (article extraction on any page), `activeTab`, `storage`, `scripting`, `commands`. Each entry names the feature that needs it.
M1: MVP parity	area:store-listing,scope:chrome-port,phase-1,enhancement	First Chrome Web Store submission	Submit the first release to the Chrome Web Store. Checklist: build a signed zip of `dist/`, complete the developer account (one-time $5 fee), upload, fill in listing fields (issue #42), attach privacy policy (issue #43) and permission justification (issue #44), submit for review, respond to any reviewer feedback.
M2: v1 remaining	area:controls,scope:parity,future,enhancement	Progress scrubber	Add a progress scrubber/timeline to the overlay showing reading position within the article. Draggable to jump. Appears on hover/tap; auto-hides during active reading.
M2: v1 remaining	area:rsvp-engine,area:settings,scope:parity,future,enhancement	Reading-position memory	Persist reading position per-URL so closing and reopening SpeedReader resumes where the user left off. Bound by storage quota — use `chrome.storage.local` with an LRU cap. User-facing: "resume" vs "start over" prompt on reopen.
M2: v1 remaining	area:settings,scope:parity,future,enhancement	Reading history	Keep a list of recently-read articles with timestamps and resume state. Accessible from the popup. Respect privacy: opt-in, clearable.
M2: v1 remaining	area:theming,scope:parity,future,enhancement	Background-color customization	Add a custom background-color picker for the overlay (accessible via options page). Common presets (black, cream, sepia, etc.) plus a color input. Complements the existing light/dark/system theme.
M2: v1 remaining	area:rsvp-engine,scope:parity,future,enhancement	Chunk size (2–3 word display)	Allow displaying 2 or 3 words at once instead of one. Options-page setting. Reuses ORP logic per-word. Useful for faster readers who want more context at a glance.
M2: v1 remaining	area:overlay-ui,scope:parity,future,enhancement	Overlay polish (ORP alignment, preview accuracy, stability)	Cross-cutting polish work from Safari's `v1:polish`: tighten ORP horizontal alignment (all words render with the ORP character in the same column), verify context-preview shows the exact sentence the current word is in, fix any overlay flicker/stability bugs surfaced in testing.
M3: Future	area:extraction,area:settings,scope:parity,future,enhancement	Saved articles	Let users save articles for later reading (offline queue). Storage: `chrome.storage.local`. Access via popup or options page.
M3: Future	area:extraction,scope:parity,future,enhancement	PDF / ePub import	Support reading PDFs and ePubs through SpeedReader. PDF: integrate with Chrome's PDF viewer or accept file drops. ePub: parse client-side (e.g., epub.js).
M3: Future	area:settings,scope:parity,future,enhancement	Reading stats	Track and display reading stats (words read, time spent, average WPM, streaks). Local-only — no telemetry. Opt-in.
M3: Future	area:extraction,scope:parity,future,enhancement	iframe extraction	Handle articles embedded in iframes (Medium embeds, Substack embeds, etc.). Requires same-origin or postMessage coordination with the iframe's parent document.
M3: Future	area:docs,area:settings,scope:chrome-port,future,enhancement	i18n via chrome.i18n	Internationalize the extension UI (popup, options page, overlay labels) via `chrome.i18n` and `_locales/`. Seed English; accept community translations.
```

Verification: the file should be 56 data rows. Confirm with:

```fish
wc -l /Users/cantu/repos/speedreader-chrome/scripts/issues.tsv
```

Expected: `56 /Users/cantu/repos/speedreader-chrome/scripts/issues.tsv`.

- [ ] **Step 10.2: Create the issue-creation script**

Create `/Users/cantu/repos/speedreader-chrome/scripts/create-issues.sh` with exactly:

```bash
#!/usr/bin/env bash
# Create issues in chriscantu/speedreader-chrome from scripts/issues.tsv.
# Reads milestone numbers from scripts/.milestone-numbers.tsv.

set -euo pipefail

REPO="chriscantu/speedreader-chrome"
TSV="$(dirname "$0")/issues.tsv"
MILESTONES_TSV="$(dirname "$0")/.milestone-numbers.tsv"

if [[ ! -f "$TSV" ]]; then
  echo "Missing $TSV" >&2
  exit 1
fi
if [[ ! -f "$MILESTONES_TSV" ]]; then
  echo "Missing $MILESTONES_TSV — run create-milestones.sh first (Task 8 Step 8.5)" >&2
  exit 1
fi

# Build a title → number map for milestones.
declare -A MILESTONE_NUM
while IFS=$'\t' read -r m_title m_number; do
  MILESTONE_NUM["$m_title"]="$m_number"
done < "$MILESTONES_TSV"

count=0
while IFS=$'\t' read -r milestone labels title body; do
  # Skip blank lines.
  [[ -z "$milestone" ]] && continue

  m_number="${MILESTONE_NUM[$milestone]:-}"
  if [[ -z "$m_number" ]]; then
    echo "No milestone number for '$milestone' — did you run Task 8 Step 8.5?" >&2
    exit 1
  fi

  count=$((count + 1))
  echo "[$count] Creating: $title"

  gh issue create \
    --repo "$REPO" \
    --title "$title" \
    --body "$body" \
    --label "$labels" \
    --milestone "$milestone" > /dev/null
done < "$TSV"

echo "Done. Created $count issues."
```

- [ ] **Step 10.3: Dry-run sanity check (create one issue, verify, proceed)**

Before running the full script, spot-check with a single issue to confirm labels + milestone wire up correctly:

```fish
cd /Users/cantu/repos/speedreader-chrome
gh issue create \
    --repo chriscantu/speedreader-chrome \
    --title "_sanity_check_ delete me" \
    --body "Temporary verification issue — delete after confirming labels and milestone wire up." \
    --label "area:build,scope:chrome-port,phase-1,enhancement" \
    --milestone "M1: MVP parity"
```

Expected: `gh` returns the URL of the new issue. Open it in the browser; confirm all 4 labels present and milestone `M1: MVP parity` shown.

If it looks right, close and delete it:

```fish
gh issue close _sanity_check_ --repo chriscantu/speedreader-chrome || true
# then use the UI or the `gh` API to fully delete it, or leave it closed if you prefer
```

(Deleting issues requires the UI — closing is sufficient to keep the backlog tidy.)

- [ ] **Step 10.4: Run the issue-creation script**

```fish
cd /Users/cantu/repos/speedreader-chrome
bash scripts/create-issues.sh
```

Expected: 56 lines of `[N] Creating: <title>`, then `Done. Created 56 issues.`. Runtime: ~2–3 minutes (rate-limited by gh API).

- [ ] **Step 10.5: Add milestone-numbers file to `.gitignore`**

The local milestone-number cache shouldn't be committed. Append to `.gitignore`:

```fish
echo "
# Local state for issue-creation scripts
scripts/.milestone-numbers.tsv" >> /Users/cantu/repos/speedreader-chrome/.gitignore
```

- [ ] **Step 10.6: Commit the scripts**

```fish
cd /Users/cantu/repos/speedreader-chrome
git add scripts/create-labels.sh scripts/create-milestones.sh scripts/create-issues.sh scripts/issues.tsv .gitignore
```

Write the commit message:

```fish
echo "Add label, milestone, and issue-creation scripts

Repeatable scripts (+ TSV data file) used to bootstrap the
repo's 22 labels, 3 milestones, and 56 issues per the approved
backlog design. Idempotent for labels; milestones and issues
assume a clean slate." > /tmp/speedreader-scripts-commit.txt

cd /Users/cantu/repos/speedreader-chrome
git commit -F /tmp/speedreader-scripts-commit.txt
rm /tmp/speedreader-scripts-commit.txt

git push origin main
```

Expected: commit lands, push succeeds.

---

## Task 11: Verify the full setup against the spec acceptance criteria

- [ ] **Step 11.1: Verify repo state**

```fish
cd /Users/cantu/repos/speedreader-chrome
git status
git log --oneline
```

Expected: clean working tree; two commits (initial + scripts).

- [ ] **Step 11.2: Verify GitHub repo state**

```fish
gh repo view chriscantu/speedreader-chrome --json visibility,defaultBranchRef
```

Expected: `"visibility":"PUBLIC"`, `defaultBranchRef.name == "main"`.

- [ ] **Step 11.3: Verify labels (22 total)**

```fish
gh label list --repo chriscantu/speedreader-chrome --limit 50 | wc -l
```

Expected: ≥22 (may be higher if GitHub default labels were left in place).

- [ ] **Step 11.4: Verify milestones (3 total)**

```fish
gh api repos/chriscantu/speedreader-chrome/milestones --jq 'length'
```

Expected: `3`.

- [ ] **Step 11.5: Verify issue count per milestone**

```fish
gh issue list --repo chriscantu/speedreader-chrome --milestone "M1: MVP parity" --state all --limit 100 | wc -l
gh issue list --repo chriscantu/speedreader-chrome --milestone "M2: v1 remaining" --state all --limit 100 | wc -l
gh issue list --repo chriscantu/speedreader-chrome --milestone "M3: Future" --state all --limit 100 | wc -l
```

Expected: `45`, `6`, `5` respectively. Total = 56.

- [ ] **Step 11.6: Verify `needs-spec` flag applied correctly**

```fish
gh issue list --repo chriscantu/speedreader-chrome --label "needs-spec" --state all --limit 100
```

Expected: exactly 3 issues — the Readability extraction issue, the settings schema issue, the responsive overlay issue.

- [ ] **Step 11.7: Verify Projects v2 board has all 56 issues**

Open `https://github.com/users/chriscantu/projects/<number>` in a browser (from Task 9 Step 9.2). Confirm 56 items on the board.

If fewer than 56 appear, the auto-add workflow (Task 9 Step 9.4) wasn't enabled before issue creation. Bulk-add via:

```fish
set PROJECT_NUMBER (cat /tmp/speedreader-project-number.txt)
for issue_number in (gh issue list --repo chriscantu/speedreader-chrome --state all --limit 100 --json number --jq '.[].number')
    gh project item-add "$PROJECT_NUMBER" --owner chriscantu --url "https://github.com/chriscantu/speedreader-chrome/issues/$issue_number"
end
```

- [ ] **Step 11.8: Final acceptance check**

Walk the acceptance criteria from the spec:

- [ ] Local directory is `/Users/cantu/repos/speedreader-chrome/` and is a git repo on `main`.
- [ ] `chriscantu/speedreader-chrome` exists on GitHub, public, MIT.
- [ ] Initial commit is pushed and contains exactly the files from section 2 of the spec.
- [ ] All 22 labels from section 3 of the spec exist.
- [ ] Milestones `M1`, `M2`, `M3` exist with the correct descriptions.
- [ ] `SpeedReader Chrome` Projects v2 board exists, linked to repo, with M1 Board + All Issues views.
- [ ] All 56 issues from section 4 of the spec are filed with correct labels and milestones.
- [ ] Issues #16, #31, #34 carry `needs-spec`.

If any acceptance item fails, do not claim the workstream complete — open a follow-up.

---

## Self-review notes

- **Spec coverage:** Every acceptance criterion from the spec maps to a verify step in Task 11. Every section-4 issue maps to a row in `scripts/issues.tsv`.
- **Placeholder scan:** `TODO(#1)` in `CONTRIBUTING.md` is intentional (a forward pointer to the tooling-setup issue). No other placeholders.
- **Type consistency:** Milestone titles are used identically across label script (quoted) and issue script (lookup key). Label names are used identically across Task 7, `issues.tsv`, and Task 11 verification.
- **Known manual steps:** Projects v2 workflow enablement (9.4), view creation (9.5), and issue deletion (10.3 cleanup) require the GitHub UI — `gh` CLI does not expose them as of v2.x. Flagged inline, not hidden.
