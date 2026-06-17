#!/usr/bin/env bash
#
# swarm-worktrees.sh — isolated git worktrees for parallel builder dispatch (#117).
#
# Workaround for the broken Agent `isolation: "worktree"` mechanism (the
# harness `WorktreeCreate` hook fails to reroot a subagent's Bash CWD, so
# parallel builders share one working tree and one builder's `git checkout`
# clobbers a sibling's uncommitted work). The coordinator calls this tool to
# pre-create ONE worktree per builder under `.worktrees/<task>/<branch>`, so
# each builder has an isolated checkout that no sibling can switch out from
# under it.
#
#   add <task> <branch>...   Create a worktree per branch under
#                            .worktrees/<task>/<branch>. New branches are cut
#                            from HEAD (sync `main` before dispatch if you need
#                            a fresher base); existing branches are attached
#                            as-is. Prints one created path per line (consumed
#                            by the coordinator to `cd` each builder into its
#                            own checkout).
#   list <task>              List the registered worktrees for <task>.
#   cleanup <task>           Remove every worktree under .worktrees/<task> and
#                            prune. Does NOT delete the branches (they may hold
#                            unmerged work / open PRs); only the checkouts and
#                            disk are reclaimed.
#
# Run from anywhere inside the repo. Exits 0 on success; non-zero with a
# diagnostic on any failure. POSIX-bash compatible (dev macOS, Ubuntu CI).
#
# `.worktrees/` is gitignored, so the linked checkouts never show as untracked
# in the main tree. See CLAUDE.md swarm config + issue #117.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
WT_DIR=".worktrees"

usage() {
  echo "usage: swarm-worktrees.sh <add|list|cleanup> <task> [branch...]" >&2
  exit 2
}

cmd="${1:-}"
[ -n "$cmd" ] || usage
shift
task="${1:-}"
[ -n "$task" ] || usage
shift || true

# CONTAINMENT (security): `task` is a single path segment under .worktrees/. It
# flows into `git worktree add` paths and `rm -rf` (cleanup), so a `/` or `..`
# would let those escape the .worktrees/ subtree and delete/clobber arbitrary
# dirs (e.g. `cleanup ..` → rm -rf the repo root). Restrict to a flat slug.
case "$task" in
  . | ..)
    echo "swarm-worktrees: invalid task name: '$task'" >&2
    exit 2
    ;;
  *[!A-Za-z0-9._-]*)
    echo "swarm-worktrees: task must be a flat slug [A-Za-z0-9._-] (no '/' or '..'): '$task'" >&2
    exit 2
    ;;
esac

base_path="$ROOT/$WT_DIR/$task"

case "$cmd" in
  add)
    [ "$#" -ge 1 ] || {
      echo "swarm-worktrees: 'add' needs at least one branch" >&2
      exit 2
    }
    # Validate EVERY branch up front (security: a `..`-bearing ref would escape
    # the task subtree; also makes the loop fail before creating partial state).
    for br in "$@"; do
      if ! git check-ref-format "refs/heads/$br"; then
        echo "swarm-worktrees: invalid branch name: '$br'" >&2
        exit 2
      fi
    done
    for br in "$@"; do
      path="$base_path/$br"
      if [ -e "$path" ]; then
        echo "swarm-worktrees: path already exists: $path" >&2
        exit 1
      fi
      if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$br"; then
        # Branch exists — attach it (cannot be checked out in another worktree).
        git -C "$ROOT" worktree add "$path" "$br" >&2
      else
        # New branch cut from HEAD.
        git -C "$ROOT" worktree add "$path" -b "$br" HEAD >&2
      fi
      echo "$path"
    done
    ;;

  list)
    # Porcelain path lines that live under this task's subtree.
    git -C "$ROOT" worktree list --porcelain \
      | awk '/^worktree /{print $2}' \
      | grep -F "/$WT_DIR/$task/" || true
    ;;

  cleanup)
    # Remove each registered worktree under the task subtree (handles nested
    # branch names like feature/x), then reclaim disk and prune stale refs.
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      git -C "$ROOT" worktree remove --force "$path" 2>/dev/null || true
    done < <(
      git -C "$ROOT" worktree list --porcelain \
        | awk '/^worktree /{print $2}' \
        | grep -F "/$WT_DIR/$task/" || true
    )
    rm -rf "$base_path"
    git -C "$ROOT" worktree prune
    ;;

  *)
    usage
    ;;
esac
