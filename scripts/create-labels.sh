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
