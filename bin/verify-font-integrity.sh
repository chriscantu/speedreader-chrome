#!/usr/bin/env bash
#
# verify-font-integrity.sh — pin check for bundled font binaries.
#
# Reads `<dir>/README.md` for lines of the form
#   <filename>  sha256:<64-hex-chars>  source:<url-or-note>
# and asserts that for every pin line:
#   1. Exactly one pin line exists per basename (no duplicate pins).
#   2. `<dir>/<basename>` exists on disk.
#   3. `shasum -a 256 <file>` matches the pinned hash exactly.
# Also asserts:
#   4. Every `*.woff2` in <dir> has a pin line (no unpinned binaries).
#   5. A license sibling (OFL.txt or LICENSE*) exists in <dir>.
#
# Defaults to checking ./fonts. Override with FONTS_DIR=/path/to/dir for
# tests / fixtures.
#
# Exits 0 on success; non-zero with a diagnostic on any mismatch.
#
# Companion guard for issue #173 (SHA-256 pin against silent supply-chain
# TOFU). Issue #189 hardens the parser (duplicate-pin assertion) and
# extends enforcement to non-woff2 pinned files (e.g., OFL.txt). Keep
# this script POSIX-bash compatible — runs on dev macOS, Ubuntu CI, and
# Chromium Linux containers.

set -euo pipefail

check_dist=0
for arg in "$@"; do
  case "${arg}" in
    --check-dist)
      check_dist=1
      ;;
    *)
      echo "verify-font-integrity: unknown argument: ${arg}" >&2
      exit 2
      ;;
  esac
done

FONTS_DIR="${FONTS_DIR:-fonts}"
DIST_FONTS_DIR="${DIST_FONTS_DIR:-dist/fonts}"
README="${FONTS_DIR}/README.md"

if [ ! -d "${FONTS_DIR}" ]; then
  echo "verify-font-integrity: directory not found: ${FONTS_DIR}" >&2
  exit 2
fi

if [ ! -f "${README}" ]; then
  echo "verify-font-integrity: README not found: ${README}" >&2
  exit 2
fi

# License sibling — one acceptable file covers the whole dir. Test
# OFL.txt as a literal, and LICENSE* via a nullglob expansion so the
# absence of either form doesn't false-positive.
license_found=0
if [ -f "${FONTS_DIR}/OFL.txt" ]; then
  license_found=1
else
  shopt -s nullglob
  license_glob=("${FONTS_DIR}"/LICENSE*)
  shopt -u nullglob
  if [ "${#license_glob[@]}" -gt 0 ]; then
    license_found=1
  fi
fi
if [ "${license_found}" -eq 0 ]; then
  echo "verify-font-integrity: no OFL.txt or LICENSE* in ${FONTS_DIR}" >&2
  exit 1
fi

status=0

# Collect all pin lines from README. Format (one per line):
#   <basename>  sha256:<hex>  source:...
# Pin parser is intentionally extension-agnostic — woff2 binaries AND
# license/text siblings (OFL.txt etc.) get enforced uniformly.
# Avoid `mapfile` (bash 4+) for macOS /usr/bin/bash 3.2 compatibility.
pin_re='^[^[:space:]]+[[:space:]]+sha256:[0-9a-f]{64}'
pin_lines=()
while IFS= read -r _line; do
  pin_lines+=("${_line}")
done < <(grep -E "${pin_re}" "${README}" || true)

# Track which basenames we've already verified (for woff2 cross-check
# below) and which we've seen at all (for duplicate detection).
verified_basenames=()
seen_basenames=()

for line in "${pin_lines[@]+"${pin_lines[@]}"}"; do
  basename="$(echo "${line}" | awk '{print $1}')"

  # Duplicate-pin guard (F1) — a future README with two pin lines for
  # the same basename (e.g., a commented-out history pin above the real
  # one) would let `grep | head -n 1` silently pick whichever came
  # first, allowing a swapped binary to pass. Assert exactly one.
  dup_count="$(printf '%s\n' "${pin_lines[@]+"${pin_lines[@]}"}" | awk -v b="${basename}" '$1 == b {n++} END {print n+0}')"
  if [ "${dup_count}" -gt 1 ]; then
    # Only emit the error once per duplicate basename.
    already_reported=0
    for sb in "${seen_basenames[@]+"${seen_basenames[@]}"}"; do
      if [ "${sb}" = "${basename}" ]; then
        already_reported=1
        break
      fi
    done
    if [ "${already_reported}" -eq 0 ]; then
      echo "verify-font-integrity: DUPLICATE PIN for ${basename} (found ${dup_count} lines in ${README}, expected 1)" >&2
      status=1
      seen_basenames+=("${basename}")
    fi
    continue
  fi
  seen_basenames+=("${basename}")

  pinned_hash="$(echo "${line}" | grep -oE 'sha256:[0-9a-f]{64}' | head -n 1 | cut -d: -f2)"
  target="${FONTS_DIR}/${basename}"

  if [ ! -f "${target}" ]; then
    echo "verify-font-integrity: pinned file missing on disk: ${target}" >&2
    status=1
    continue
  fi

  actual_hash="$(shasum -a 256 "${target}" | awk '{print $1}')"

  if [ "${actual_hash}" != "${pinned_hash}" ]; then
    echo "verify-font-integrity: HASH MISMATCH for ${basename}" >&2
    echo "  pinned: ${pinned_hash}" >&2
    echo "  actual: ${actual_hash}" >&2
    status=1
    continue
  fi

  echo "verify-font-integrity: ok  ${basename}  sha256:${actual_hash}"
  verified_basenames+=("${basename}")
done

# Enumerate woff2 files. Glob may not expand if none present — handle
# explicitly rather than letting `for` iterate the literal pattern. Any
# *.woff2 on disk MUST be pinned (catches a binary added without a
# README entry).
shopt -s nullglob
fonts=("${FONTS_DIR}"/*.woff2)
shopt -u nullglob

if [ "${#fonts[@]}" -eq 0 ]; then
  echo "verify-font-integrity: no *.woff2 files in ${FONTS_DIR}" >&2
  exit 1
fi

for font in "${fonts[@]}"; do
  basename="${font##*/}"
  was_verified=0
  for vb in "${verified_basenames[@]+"${verified_basenames[@]}"}"; do
    if [ "${vb}" = "${basename}" ]; then
      was_verified=1
      break
    fi
  done
  if [ "${was_verified}" -eq 0 ]; then
    echo "verify-font-integrity: no pinned sha256 for ${basename} in ${README}" >&2
    status=1
  fi
done

# Post-build pass: when --check-dist is set, recompute hashes for the
# emitted dist/fonts/*.woff2 and assert they match the SAME pinned
# hashes from fonts/README.md. Pre-build catches source tamper; this
# pass catches Vite/crxjs-plugin rewrites of the emitted binary.
#
# Scope: --check-dist intentionally remains *.woff2-only. License
# files (OFL.txt) are not emitted to dist/; source-side enforcement
# above is sufficient. If a future revision starts emitting non-woff2
# pinned assets to dist/, extend this loop the same way the source
# loop was extended in issue #189.
if [ "${check_dist}" -eq 1 ]; then
  if [ ! -d "${DIST_FONTS_DIR}" ]; then
    echo "verify-font-integrity: dist directory missing: ${DIST_FONTS_DIR}" >&2
    exit 1
  fi

  shopt -s nullglob
  dist_fonts=("${DIST_FONTS_DIR}"/*.woff2)
  shopt -u nullglob

  if [ "${#dist_fonts[@]}" -eq 0 ]; then
    echo "verify-font-integrity: no *.woff2 files in ${DIST_FONTS_DIR}" >&2
    exit 1
  fi

  for font in "${dist_fonts[@]}"; do
    basename="${font##*/}"

    pinned_line="$(grep -E "^${basename}[[:space:]]+sha256:[0-9a-f]{64}" "${README}" || true)"
    if [ -z "${pinned_line}" ]; then
      echo "verify-font-integrity: dist file ${basename} has no pinned sha256 in ${README}" >&2
      status=1
      continue
    fi
    pinned_hash="$(echo "${pinned_line}" | grep -oE 'sha256:[0-9a-f]{64}' | head -n 1 | cut -d: -f2)"

    actual_hash="$(shasum -a 256 "${font}" | awk '{print $1}')"

    if [ "${actual_hash}" != "${pinned_hash}" ]; then
      echo "verify-font-integrity: dist HASH MISMATCH for ${basename}" >&2
      echo "  pinned: ${pinned_hash}" >&2
      echo "  actual: ${actual_hash}" >&2
      status=1
      continue
    fi

    echo "verify-font-integrity: dist ok  ${basename}  sha256:${actual_hash}"
  done
fi

exit "${status}"
