#!/usr/bin/env bash
# verify-ring-config.sh — Pre-flight checks for /ring slash command + hooks
# Run before push if .claude-plugin/commands/ring.md or .claude/settings.json changed.
# Exit 0 = OK, 1 = config defect.

set -u
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

fail=0
warn() { printf "[verify-ring] WARN: %s\n" "$1" >&2; }
err()  { printf "[verify-ring] FAIL: %s\n" "$1" >&2; fail=1; }
ok()   { printf "[verify-ring] OK:   %s\n" "$1"; }

ring_md=".claude-plugin/commands/ring.md"
plugin_json=".claude-plugin/plugin.json"
settings_json=".claude/settings.json"

# 1. ring.md exists and is non-empty
if [ ! -s "$ring_md" ]; then
  err "$ring_md missing or empty"
else
  ok "$ring_md present"
fi

# 2. plugin.json declares commands path
if ! jq -e '.commands[]? | select(. == "./commands/")' "$plugin_json" >/dev/null 2>&1; then
  err "$plugin_json missing \"commands\": [\"./commands/\"] entry"
else
  ok "$plugin_json declares commands dir"
fi

# 3. Subagent type names in ring.md match canonical allow-list
#    (typo or upstream rename = silent degradation; per /ring test-gap finding #3)
canonical=(security-adversary scope-adversary perf-adversary test-gap-adversary arbiter)
declared=$(grep -oE '(subagent_type: |`)(security-adversary|scope-adversary|perf-adversary|test-gap-adversary|arbiter)' "$ring_md" 2>/dev/null \
  | sed 's/^subagent_type: //;s/`//g' | sort -u)
for name in "${canonical[@]}"; do
  if ! grep -qx "$name" <<< "$declared"; then
    err "ring.md missing canonical subagent: $name"
  fi
done
unknown=$(comm -23 <(echo "$declared") <(printf "%s\n" "${canonical[@]}" | sort -u))
if [ -n "$unknown" ]; then
  warn "ring.md references non-canonical subagent name(s): $unknown"
fi
ok "subagent names cross-checked"

# 4. ring.md contains the untrusted-content envelope mandate
if ! grep -q '<untrusted-diff>' "$ring_md"; then
  err "ring.md missing <untrusted-diff> envelope mandate (prompt-injection guard)"
else
  ok "untrusted-diff envelope mandate present"
fi

# 5. ring.md contains the secret pre-scan gate
if ! grep -q 'SECRETS\|Secret pre-scan\|HARD-GATE' "$ring_md"; then
  err "ring.md missing secret pre-scan HARD-GATE"
else
  ok "secret pre-scan gate present"
fi

# 6. ring.md contains the tier-by-size fan-out gate
if ! grep -q 'Tier the fan-out\|< 50 LOC\|50.*500 LOC' "$ring_md"; then
  err "ring.md missing diff-size tier gate"
else
  ok "diff-size tier gate present"
fi

# 6a. ring.md invokes Ruflo aidefence_scan in pre-flight
if ! grep -q 'aidefence_scan' "$ring_md"; then
  err "ring.md missing aidefence_scan pre-flight gate (prompt-injection / PII)"
else
  ok "aidefence_scan pre-flight gate present"
fi

# 6b. ring.md primes from prior runs via pattern-search
if ! grep -q 'pattern-search\|pattern_search' "$ring_md"; then
  err "ring.md missing hooks_intelligence_pattern-search priming (intelligence loop entry)"
else
  ok "pattern-search priming present"
fi

# 6c. ring.md persists arbiter findings via pattern-store
if ! grep -q 'pattern-store\|pattern_store' "$ring_md"; then
  err "ring.md missing hooks_intelligence_pattern-store post-arbiter (intelligence loop exit)"
else
  ok "pattern-store post-arbiter gate present"
fi

# 7. settings.json hook (if present) pins tsc to ./node_modules/.bin (not npx)
if [ -f "$settings_json" ]; then
  if jq -e '.hooks.PostToolUse[]?.hooks[]?.command' "$settings_json" 2>/dev/null \
       | grep -q 'npx.*tsc'; then
    err "$settings_json PostToolUse uses 'npx tsc' (path-hijack risk); pin to ./node_modules/.bin/tsc"
  elif jq -e '.hooks.PostToolUse[]?.hooks[]?.command' "$settings_json" 2>/dev/null \
       | grep -q './node_modules/.bin/tsc'; then
    ok "$settings_json PostToolUse pins tsc to ./node_modules/.bin/tsc"
  fi
  # No TaskCompleted auto-trigger (per /ring security finding #7)
  if jq -e '.hooks.TaskCompleted' "$settings_json" >/dev/null 2>&1; then
    warn "$settings_json has TaskCompleted hook — auto-amplifies prompt-injection vector if it triggers /ring"
  fi
else
  warn "$settings_json absent (hooks are local-only; OK if intentional)"
fi

# 8. No stale symlink under .claude/commands/ pointing at .claude-plugin/
if [ -L .claude/commands/ring.md ]; then
  target=$(readlink .claude/commands/ring.md)
  if [ ! -e .claude/commands/ring.md ]; then
    err ".claude/commands/ring.md is a dangling symlink → $target"
  else
    warn ".claude/commands/ring.md symlink present → $target (drop after plugin reload works)"
  fi
fi

if [ "$fail" -eq 0 ]; then
  printf "[verify-ring] all checks passed\n"
  exit 0
else
  printf "[verify-ring] %d check(s) failed\n" "$fail" >&2
  exit 1
fi
