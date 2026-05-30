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

# Collect pin lines from README. Format (one per line, inside a triple-
# backtick fence):
#   <basename>  sha256:<64-hex>  source:...
#
# Pin parser is intentionally extension-agnostic — woff2 binaries AND
# license/text siblings (OFL.txt etc.) get enforced uniformly.
#
# Three hardenings (issue #189 ring follow-ups):
#   SH2 — fence-aware: only lines INSIDE a triple-backtick fence are
#         considered. A pin-shaped line in a quote block or "## Example"
#         section outside the fence is ignored. Without this, an
#         informational example could shadow or duplicate a real pin.
#   TG2 — malformed-pin detection: a line that LOOKS like a pin attempt
#         (basename + `sha256` keyword) but doesn't match the strict form
#         is surfaced as an error rather than silently filtered out.
#         Catches typo'd `SHA256:`, short hashes, oversized hashes.
#   SH1 — basename validation deferred to the per-pin loop below; reject
#         anything outside `[A-Za-z0-9._-]+` to prevent path traversal
#         turning the diagnostic stream into a hash-disclosure primitive.
#
# Single-pass awk is bash-3.2 safe (no associative arrays here, no
# mapfile). The script emits one line per accepted pin and a `MALFORMED:`
# prefix per rejected pin attempt; the bash loop below treats the latter
# as a hard error.
#
# Strict pin shape: any non-whitespace basename + lowercase `sha256:` +
# exactly 64 lowercase hex. Basename character-class validation happens
# in the per-pin loop below (SH1) so that an invalid-basename pin gets
# its own diagnostic distinct from a malformed-hash pin (TG2).
#
# Loose pin-attempt shape: non-whitespace basename + any-case `sha256`
# keyword. Lines matching loose but NOT strict are surfaced as
# malformed — catches short hashes, oversized hashes, typo'd `SHA256:`.
pin_lines=()
malformed_lines=()
while IFS= read -r _line; do
  case "${_line}" in
    MALFORMED:*)
      malformed_lines+=("${_line#MALFORMED:}")
      ;;
    *)
      pin_lines+=("${_line}")
      ;;
  esac
done < <(
  awk '
    BEGIN { in_fence = 0 }
    /^[[:space:]]*```/ { in_fence = !in_fence; next }
    in_fence == 0 { next }
    # Inside fence — classify the line.
    /^[^[:space:]]+[[:space:]]+sha256:[0-9a-f]{64}([[:space:]]|$)/ {
      print $0
      next
    }
    # Loose detector: pin-shape attempt + sha256 keyword (case-insensitive)
    # that did not match strict. Surface as malformed.
    /^[^[:space:]]+[[:space:]]+[sS][hH][aA]256[:[:space:]]/ {
      print "MALFORMED:" $0
      next
    }
  ' "${README}"
)

# Surface malformed pin attempts before any per-pin processing — these
# indicate intent to pin but a syntactic break (truncated hash, typo'd
# keyword, oversized hash). A future README with a typo would otherwise
# silently drop the pin and the woff2 enumeration below would catch it
# as "no pinned sha256", but the diagnostic would be misleading.
for ml in "${malformed_lines[@]+"${malformed_lines[@]}"}"; do
  echo "verify-font-integrity: malformed pin: ${ml}" >&2
  status=1
done

# Track which basenames we've already verified (for woff2 cross-check
# below) and which we've seen at all (for duplicate detection).
verified_basenames=()
seen_basenames=()

for line in "${pin_lines[@]+"${pin_lines[@]}"}"; do
  basename="$(echo "${line}" | awk '{print $1}')"

  # Basename safety (SH1) — defense-in-depth even though the awk
  # extractor's strict regex already constrains the basename charset.
  # If a future relaxation of strict_pin_re lets through `..` or `/`,
  # this guard prevents the per-pin loop from invoking
  # `shasum -a 256 fonts/../../etc/passwd` and leaking the hash into
  # the `HASH MISMATCH actual: <hex>` diagnostic line.
  case "${basename}" in
    *[!A-Za-z0-9._-]* | '' | *..* )
      echo "verify-font-integrity: invalid pin basename: ${basename}" >&2
      status=1
      continue
      ;;
  esac

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

# Post-build pass: when --check-dist is set, recompute hashes for each
# pinned woff2 against its dist/fonts/<basename> counterpart and assert
# the hash matches. Pre-build catches source tamper; this pass catches
# Vite/crxjs-plugin rewrites of the emitted binary AND missing-emit
# (Vite-plugin failed to copy a specific font through to dist).
#
# Iterates the SAME pin_lines set the source loop walked (SH3) so the
# two paths share a single source of truth — no shell-interpolated
# regex, no lookup divergence between source and dist phases.
#
# Scope: --check-dist intentionally remains *.woff2-only. License
# files (OFL.txt) are not emitted to dist/; source-side enforcement
# above is sufficient.
if [ "${check_dist}" -eq 1 ]; then
  if [ ! -d "${DIST_FONTS_DIR}" ]; then
    echo "verify-font-integrity: dist directory missing: ${DIST_FONTS_DIR}" >&2
    exit 1
  fi

  dist_pin_count=0
  for line in "${pin_lines[@]+"${pin_lines[@]}"}"; do
    basename="$(echo "${line}" | awk '{print $1}')"

    # Restrict --check-dist to *.woff2 pins (license files don't ship
    # to dist/).
    case "${basename}" in
      *.woff2) ;;
      *) continue ;;
    esac

    # Re-apply the basename safety check from the source loop. Cheap;
    # keeps both loops symmetrically hardened against SH1.
    case "${basename}" in
      *[!A-Za-z0-9._-]* | '' | *..* )
        echo "verify-font-integrity: invalid pin basename in dist phase: ${basename}" >&2
        status=1
        continue
        ;;
    esac

    dist_pin_count=$((dist_pin_count + 1))
    pinned_hash="$(echo "${line}" | grep -oE 'sha256:[0-9a-f]{64}' | head -n 1 | cut -d: -f2)"
    dist_target="${DIST_FONTS_DIR}/${basename}"

    if [ ! -f "${dist_target}" ]; then
      echo "verify-font-integrity: dist pinned file missing on disk: ${dist_target}" >&2
      status=1
      continue
    fi

    actual_hash="$(shasum -a 256 "${dist_target}" | awk '{print $1}')"

    if [ "${actual_hash}" != "${pinned_hash}" ]; then
      echo "verify-font-integrity: dist HASH MISMATCH for ${basename}" >&2
      echo "  pinned: ${pinned_hash}" >&2
      echo "  actual: ${actual_hash}" >&2
      status=1
      continue
    fi

    echo "verify-font-integrity: dist ok  ${basename}  sha256:${actual_hash}"
  done

  # Sanity: a --check-dist invocation with no pinned woff2 in scope is
  # almost certainly a misconfiguration — surface it loudly rather than
  # silently exiting 0.
  if [ "${dist_pin_count}" -eq 0 ]; then
    echo "verify-font-integrity: no pinned *.woff2 to check against ${DIST_FONTS_DIR}" >&2
    exit 1
  fi
fi

exit "${status}"
