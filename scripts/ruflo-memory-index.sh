#!/usr/bin/env bash
# ruflo-memory-index.sh — Index docs/superpowers/ corpus into ruflo memory
# so /spec-recall and Claude sessions can semantically search prior specs,
# plans, and decisions before drafting new ones.
#
# Idempotent via `--upsert`. Safe to re-run after any docs/superpowers/ edit.
# Tracked artifact (not gitignored) because it depends on docs/superpowers/
# layout that lives in the repo.
#
# Usage:
#   bash scripts/ruflo-memory-index.sh              # index all 3 dirs
#   bash scripts/ruflo-memory-index.sh specs        # index one subset
#   DRY_RUN=1 bash scripts/ruflo-memory-index.sh    # print actions, don't write

set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

NAMESPACE="${RUFLO_NS:-speedreader-specs}"
DOCS_ROOT="docs/superpowers"
SUBDIRS=("${@:-specs plans decisions}")

if ! command -v npx >/dev/null 2>&1; then
  echo "[memory-index] FAIL: npx not available" >&2
  exit 1
fi

if [ ! -d "$DOCS_ROOT" ]; then
  echo "[memory-index] FAIL: $DOCS_ROOT not found (run from repo root)" >&2
  exit 1
fi

indexed=0
skipped=0
failed=0

for sub in $SUBDIRS; do
  dir="$DOCS_ROOT/$sub"
  if [ ! -d "$dir" ]; then
    echo "[memory-index] WARN: $dir missing, skipping"
    continue
  fi

  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue

    basename=$(basename "$f" .md)
    key="${sub}/${basename}"

    if [ "${DRY_RUN:-0}" = "1" ]; then
      printf "[memory-index] DRY: would store -n %s -k %s (file: %s)\n" "$NAMESPACE" "$key" "$f"
      indexed=$((indexed + 1))
      continue
    fi

    # Strip frontmatter + collapse whitespace so the embedding sees content,
    # not YAML. Keep first 8 KB (ruflo memory has per-entry size limits).
    content=$(awk '
      BEGIN { in_fm = 0; fm_seen = 0 }
      /^---$/ {
        if (NR == 1) { in_fm = 1; next }
        if (in_fm) { in_fm = 0; fm_seen = 1; next }
      }
      !in_fm { print }
    ' "$f" | head -c 8192)

    if [ -z "$content" ]; then
      echo "[memory-index] SKIP: $key (empty after frontmatter strip)"
      skipped=$((skipped + 1))
      continue
    fi

    tags="$sub,speedreader,superpowers,$(date -r "$f" +%Y-%m)"

    if npx -y ruflo@latest memory store \
         -n "$NAMESPACE" \
         -k "$key" \
         --value "$content" \
         --tags "$tags" \
         --upsert \
         >/dev/null 2>&1; then
      indexed=$((indexed + 1))
      printf "[memory-index] OK: %s\n" "$key"
    else
      failed=$((failed + 1))
      printf "[memory-index] FAIL: %s (npx ruflo memory store nonzero exit)\n" "$key" >&2
    fi
  done
done

printf "[memory-index] done — indexed=%d skipped=%d failed=%d ns=%s\n" \
  "$indexed" "$skipped" "$failed" "$NAMESPACE"

[ "$failed" -eq 0 ] || exit 1
