# SpeedReader — Principles

## Mission

A free, accessible RSVP speed reader for the web. Built for neurodivergent readers (ADHD, dyslexia) who find traditional reading tiring but process sequential word presentation more easily. Simple technology should not be behind a paywall.

## Engineering Rules

- **Specification First** — All features MUST have a specification before implementation begins.
- **Test First** — All features MUST have a valid passing test before being considered complete. Run `npm test` (unit) and `npm run test:e2e` (extension E2E) to verify.
- **DRY & SOLID** — Implementation MUST follow DRY (Don't Repeat Yourself) and SOLID principles.
- **Structure Compliance** — Code MUST be organized according to the project STRUCTURE.md guide, including the `src/core` (platform-agnostic) vs `src/chrome` (platform glue) boundary that keeps a future shared-core extraction viable.
- **Platform Best Practices** — All code contributions MUST follow Chrome Extension (Manifest V3) best practices and MUST comply with STRUCTURE.md file layout and naming conventions.
- **Deviation Requires Approval** — ANY deviations from these rules MUST be validated by the user.
- **Iterative Commits** — Work MUST be done in small iterative batches and commit work as we go.
- **PR Merge Gate** — A full manual regression MUST be completed and every checklist item confirmed before a PR is merged. No checklist item may be left unchecked at merge time.

## Key Design Decisions

- **Shadow DOM for overlay** — isolates RSVP UI from arbitrary page CSS
- **Readability.js + text selection fallback** — reliable extraction with manual escape hatch
- **Focus-point (ORP) highlighting** — letter at ~30% of word length highlighted in accent color
- **Tap anywhere to pause** — large hit area for ADHD users who tap impulsively
- **Context preview on pause** — shows surrounding sentence to help re-orient after losing focus
- **Punctuation pausing** — period 1.5x delay, comma 1.2x delay for natural reading rhythm

## Code Quality

- **No magic numbers** — Hardcoded values (WPM bounds, default font size, etc.) MUST be defined as named constants in a single location (`src/core/settings-defaults.ts`). Code MUST reference these constants, never inline literals.
- **Flat control flow** — Avoid deeply nested conditionals. Extract helper functions, use early returns, or restructure with guard clauses to keep nesting at two levels or fewer.

## Conventions

- **TypeScript**: strict mode, ES2020+ target, no `any` without explicit justification
- **Git branches**: `feature/<short-description>` or `fix/<short-description>`
- **Commits**: concise subject, imperative mood
- **No direct pushes to main** without review

## Error Philosophy

No silent failures. Every error surfaces a visible message to the user (toast, alert, or inline). If something breaks, the user knows what happened and what to do.

## Accessibility First

This is an accessibility tool. Every UX decision should be evaluated through the lens of neurodivergent users:
- Large tap targets (≥44px)
- Clear visual hierarchy
- Minimal cognitive load
- Configurable presentation (speed, font, theme)
- Screen reader support for all controls (ARIA labels, live regions for current word, proper focus management)
