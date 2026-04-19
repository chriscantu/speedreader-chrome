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
