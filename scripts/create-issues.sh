#!/usr/bin/env bash
# Create issues in chriscantu/speedreader-chrome from scripts/issues.tsv.
# Adds each issue to the "SpeedReader Chrome" Projects v2 board at creation time
# (replaces the auto-add workflow, which requires UI configuration).

set -euo pipefail

REPO="chriscantu/speedreader-chrome"
PROJECT="SpeedReader Chrome"
TSV="$(dirname "$0")/issues.tsv"

if [[ ! -f "$TSV" ]]; then
  echo "Missing $TSV" >&2
  exit 1
fi

count=0
while IFS=$'\t' read -r milestone labels title body; do
  # Skip blank lines.
  [[ -z "$milestone" ]] && continue

  count=$((count + 1))
  echo "[$count] Creating: $title"

  gh issue create \
    --repo "$REPO" \
    --title "$title" \
    --body "$body" \
    --label "$labels" \
    --milestone "$milestone" \
    --project "$PROJECT" > /dev/null
done < "$TSV"

echo "Done. Created $count issues."
