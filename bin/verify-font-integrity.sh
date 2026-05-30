#!/usr/bin/env bash
#
# verify-font-integrity.sh — pin check for bundled font binaries.
#
# Reads `<dir>/README.md` for lines of the form
#   <filename.woff2>  sha256:<64-hex-chars>  source:<url-or-note>
# and asserts that for every `*.woff2` in <dir>:
#   1. A pinned sha256 line exists in README.md.
#   2. `shasum -a 256 <file>` matches the pinned hash exactly.
#   3. A license sibling (OFL.txt or LICENSE*) exists in <dir>.
#
# Defaults to checking ./fonts. Override with FONTS_DIR=/path/to/dir for
# tests / fixtures.
#
# Exits 0 on success; non-zero with a diagnostic on any mismatch.
#
# Companion guard for issue #173 (SHA-256 pin against silent supply-chain
# TOFU). Keep this script POSIX-bash compatible — runs on dev macOS,
# Ubuntu CI, and Chromium Linux containers.

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

# Enumerate woff2 files. Glob may not expand if none present — handle
# explicitly rather than letting `for` iterate the literal pattern.
shopt -s nullglob
fonts=("${FONTS_DIR}"/*.woff2)
shopt -u nullglob

if [ "${#fonts[@]}" -eq 0 ]; then
  echo "verify-font-integrity: no *.woff2 files in ${FONTS_DIR}" >&2
  exit 1
fi

status=0
for font in "${fonts[@]}"; do
  basename="${font##*/}"

  # Extract pinned hash from README. Format:
  #   <basename>  sha256:<hex>  source:...
  pinned_line="$(grep -E "^${basename}[[:space:]]+sha256:[0-9a-f]{64}" "${README}" || true)"
  if [ -z "${pinned_line}" ]; then
    echo "verify-font-integrity: no pinned sha256 for ${basename} in ${README}" >&2
    status=1
    continue
  fi
  pinned_hash="$(echo "${pinned_line}" | grep -oE 'sha256:[0-9a-f]{64}' | head -n 1 | cut -d: -f2)"

  actual_hash="$(shasum -a 256 "${font}" | awk '{print $1}')"

  if [ "${actual_hash}" != "${pinned_hash}" ]; then
    echo "verify-font-integrity: HASH MISMATCH for ${basename}" >&2
    echo "  pinned: ${pinned_hash}" >&2
    echo "  actual: ${actual_hash}" >&2
    status=1
    continue
  fi

  echo "verify-font-integrity: ok  ${basename}  sha256:${actual_hash}"
done

# Post-build pass: when --check-dist is set, recompute hashes for the
# emitted dist/fonts/*.woff2 and assert they match the SAME pinned
# hashes from fonts/README.md. Pre-build catches source tamper; this
# pass catches Vite/crxjs-plugin rewrites of the emitted binary.
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
