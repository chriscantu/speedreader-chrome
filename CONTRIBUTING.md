# Contributing to SpeedReader for Chrome

Thanks for your interest. This project is the Chrome port of [SpeedReader for Safari](https://github.com/chriscantu/speed-reader), built to bring RSVP reading to Chrome users — especially neurodivergent readers (ADHD, dyslexia, processing differences).

## Development setup

### Prerequisites

- **Node.js** (v18+) and **npm**, or **Bun** (v1.0+)
- [Chrome/Edge](https://www.chromium.org/chromium-projects/) for loading the extension

### Quick start

```bash
# Install dependencies
npm install          # or: bun install

# Build the extension
npm run build        # produces dist/

# Watch mode (rebuild on changes)
npm run dev
```

### Loading in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` directory

### Project structure

```
src/
  popup/        # Popup UI (HTML, CSS, TS)
  content/      # Content script (text extraction, RSVP overlay)
  icons/        # Extension icons (16, 48, 128)
dist/           # Built extension (output of `npm run build`)
scripts/        # Issue/milestone automation
```

### Available scripts

| Command          | Description                                     |
|------------------|-------------------------------------------------|
| `npm run build`  | TypeScript check + production build             |
| `npm run dev`    | Watch mode (type-check + rebuild on change)     |

### Architecture overview

This project uses **Vite** + **@crxjs/vite-plugin** to build a **Chrome Manifest V3** extension from TypeScript source code.

- **Manifest**: Generated from `src/manifest.ts` (TypeScript, not a raw JSON file)
- **Popup**: `src/popup/` — the UI shown when clicking the extension icon
- **Content script**: `src/content/` — injected into pages to provide RSVP reading
- **Build output**: `dist/` — the directory you load into Chrome as an unpacked extension

### Toolchain

- **TypeScript** — type-safe development
- **Vite** — fast bundling and dev server
- **@crxjs/vite-plugin** — bundles the extension for Chrome
- **Bun** or **npm** — package management

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