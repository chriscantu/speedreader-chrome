# Ruflo Setup

How this project is wired into the [Ruflo](https://github.com/ruvnet/ruflo)
multi-agent orchestration framework, what configuration lives where, and the
recommended local setup for the self-learning loop and adversarial review ring.

## TL;DR — first-time contributor checklist

1. Install the Ruflo marketplace + core plugins (one-time per machine):

   ```sh
   # In a Claude Code session:
   /plugin marketplace add ruvnet/ruflo
   /plugin install ruflo-core@ruflo
   /plugin install ruflo-swarm@ruflo
   /plugin install ruflo-intelligence@ruflo
   /plugin install ruflo-rag-memory@ruflo
   /plugin install ruflo-aidefence@ruflo
   /plugin install ruflo-agentdb@ruflo
   ```

2. (Optional, recommended) wire the local hooks in `.claude/settings.json` —
   see [Recommended `.claude/settings.json` hooks](#recommended-claudesettingsjson-hooks)
   below. The file is gitignored (platform-specific paths), so each contributor
   must wire it locally.

3. Verify the ring command contract before pushing changes that touch
   `.claude-plugin/commands/ring.md` or `.claude/settings.json`:

   ```sh
   bash scripts/verify-ring-config.sh
   ```

## What ships in the repo (tracked)

| Path | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Local plugin manifest — declares `skills/` and `commands/` paths so the project's own slash commands and skills load |
| `.claude-plugin/commands/ring.md` | The `/ring` adversarial review command (4 critics + arbiter, parallel fan-out, tier-by-LOC) — wired into the Ruflo intelligence loop via `hooks_intelligence_pattern-search` (pre-fan-out) and `hooks_intelligence_pattern-store` (post-arbiter), with `aidefence_scan` in the pre-flight HARD-GATE |
| `scripts/verify-ring-config.sh` | Pre-push validator for the `/ring` contract: untrusted-diff envelope, secret gate, tier gate, aidefence gate, pattern-search/store gates, settings.json hook safety, canonical subagent names |
| `CLAUDE.md` — Agent routing table | Project-specific agent dispatch table for routine work (extension-architect Queen, chrome-extension-engineer, coder, a11y-extension-designer, etc.) |

## What runs locally (gitignored)

These files are per-machine and never tracked:

| Path | Owner | What it does |
|---|---|---|
| `.claude/settings.json` | Ruflo `init` + local edits | Hook wiring (UserPromptSubmit, SessionStart, PostToolUse, etc.) — platform-specific paths to helper scripts |
| `.claude/helpers/` | Ruflo `init` | Generated helper shims for the hooks above |
| `.claude/agents/`, `.claude/commands/` | Ruflo `init` | Regenerable agent + command definitions from installed plugins |
| `.claude-flow/` | Ruflo daemon | Runtime state: `config.yaml`, `daemon-state.json`, worker metrics, swarm state, learning telemetry |
| `agentdb.rvf`, `agentdb.rvf.lock` | Ruflo AgentDB | Vector container (HNSW index, RaBitQ quantization). Regenerable cache |

## Runtime topology (`.claude-flow/config.yaml`)

The actual Ruflo daemon runs with:

- **Topology**: `hierarchical-mesh` (hybrid — hierarchical for routing, mesh for
  peer coordination)
- **Coordination**: `consensus`
- **Max agents**: `15`
- **Auto-scale**: `true`

The `CLAUDE.md` "Agent routing" table describes the **project-side dispatch
preference for extension work** (hierarchical, ~6 agents, Queen =
`extension-architect`). That table is the *recipe* for routine extension
tasks; the `config.yaml` settings are the *ceiling* the Ruflo daemon
enforces. They are not in conflict — `CLAUDE.md` is a subset profile inside
the larger envelope. If you find them genuinely diverging (e.g.,
`CLAUDE.md` requires a topology the daemon disables), reconcile by:

1. Decide whether the project intent is the subset (extension-only routine)
   or the full daemon capability.
2. Update `CLAUDE.md` to phrase the dispatch table as "for routine extension
   work" (already implied), OR update `.claude-flow/config.yaml` to the more
   restrictive profile.
3. Re-run `scripts/verify-ring-config.sh` after any change.

## Self-learning loop (Ruflo intelligence)

The `ruflo-intelligence` plugin implements a 4-step pipeline:

```
RETRIEVE → JUDGE → DISTILL → CONSOLIDATE
```

Concretely:

- **RETRIEVE** — `hooks_intelligence_pattern-search` queries prior trajectory
  outcomes when a new task starts. In `/ring`, this fires at step 2c
  (priming critics with prior convergent findings on similar diffs).
- **JUDGE** — Verdict on the trajectory (success / failure / partial)
  recorded via `hooks_post-task`.
- **DISTILL** — `hooks_intelligence_pattern-store` writes the outcome with
  quality score + tags. In `/ring`, this fires at step 6
  (`quality = convergence / critic-count`).
- **CONSOLIDATE** — Background worker (`.claude-flow/` daemon) periodically
  collapses overlapping patterns; see `consolidate` worker in
  `daemon-state.json`.

If `metrics/learning.json` shows `routing.decisions = 0` long after
`routing-outcomes.json` has populated, the daemon's consolidation worker
or telemetry bridge has stalled — restart with `npx ruflo daemon restart`.

## Adversarial review ring (`/ring`)

End-to-end flow:

1. Capture `git diff HEAD`
2. **Pre-flight HARD-GATE** (parallel):
   - Secret regex (api keys, tokens, private key blocks)
   - `aidefence_scan` on raw diff (prompt-injection + PII)
   - `hooks_intelligence_pattern-search` (prime from prior runs — informational)
3. Tier by diff size: 1 / 2 / 4 critics for <50 / 50–500 / >500 LOC
4. Parallel critic dispatch, untrusted-diff envelope
5. Arbiter synthesis (skipped <50 LOC)
6. **`hooks_intelligence_pattern-store`** — persist convergent findings
7. Present ranked list
8. User decides (fix now / defer / push)

Override on user-named cost only (e.g.,
*"aidefence false positive, fan-out anyway: <reason>"*).

## Recommended `.claude/settings.json` hooks

Since `.claude/settings.json` is gitignored, this is the **recommended
template** to wire the Ruflo intelligence loop locally. Copy what applies;
keep your existing entries.

```jsonc
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y ruflo@latest hooks session-start --quiet || true",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y ruflo@latest hooks pre-task --quiet || true",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'file=$(jq -r \".tool_input.file_path // empty\" 2>/dev/null); case \"$file\" in *.ts|*.tsx|*.mts|*.cts) ;; *) exit 0;; esac; cd \"${CLAUDE_PROJECT_DIR:-.}\" || exit 0; test -f tsconfig.json || exit 0; tsc=\"./node_modules/.bin/tsc\"; test -x \"$tsc\" || exit 0; out=$(\"$tsc\" --noEmit --incremental --tsBuildInfoFile .tsbuildinfo 2>&1 | head -15); test -z \"$out\" && exit 0; printf \"[ring/tsc] typecheck output (first 15 lines):\\n%s\\n\" \"$out\" >&2; exit 0'",
            "timeout": 30
          },
          {
            "type": "command",
            "command": "npx -y ruflo@latest hooks post-edit --quiet || true",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y ruflo@latest hooks post-task --quiet || true",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Important constraints (enforced by `scripts/verify-ring-config.sh`):

- **Do not use `npx tsc`** in PostToolUse — pin to `./node_modules/.bin/tsc`
  to prevent PATH hijack (the existing tsc hook above does this).
- **No `TaskCompleted` auto-trigger that fires `/ring`** — would auto-amplify
  any prompt-injection vector embedded in a diff the model just produced.
- `--quiet || true` on ruflo hooks: hooks must never block tool use on
  daemon-side failures.

## Recommended `.claude-flow/config.yaml` tweaks

The default `config.yaml` written by `npx ruflo init` is good. Two
project-specific tweaks worth considering:

1. **Disable the `predict` worker** if you never invoke `autopilot_predict`
   — saves daemon lifecycle slots. Add under `workers:` (if your generated
   config exposes the toggle) or simply ignore; the worker idles at zero
   cost when not invoked.

2. **`memory.persistPath: .claude-flow/data`** — already the default. Do
   **not** point this anywhere outside `.claude-flow/` since that path is
   the gitignored boundary.

## Stale plugin versions

If `~/.claude/plugins/cache/ruflo/ruflo-swarm/` shows a version older than
the other ruflo-* plugins (e.g., `0.2.0` while others are `0.3.0+`),
upgrade with:

```sh
# In a Claude Code session:
/plugin install ruflo-swarm@ruflo  # reinstall pulls latest
```

Version skew between `ruflo-swarm` and `ruflo-intelligence` can break the
swarm-side trajectory hooks the intelligence plugin expects.

## References

- Upstream Ruflo docs: <https://github.com/ruvnet/ruflo/blob/main/docs/index.md>
- `.claude-plugin/commands/ring.md` — the `/ring` command source
- `scripts/verify-ring-config.sh` — the pre-push config validator
- `CLAUDE.md` — project-side agent dispatch preferences for routine
  extension work
