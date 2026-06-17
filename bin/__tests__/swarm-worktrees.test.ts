import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Tests for bin/swarm-worktrees.sh (issue #117).
 *
 * The script is the coordinator-side workaround for the broken Agent
 * `isolation: "worktree"` hook: it pre-creates one isolated git worktree per
 * builder under `.worktrees/<task>/<branch>` so parallel builders never share a
 * checkout. These tests run the script against a THROWAWAY temp git repo so no
 * worktree op touches the real working tree.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'bin', 'swarm-worktrees.sh');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function run(cwd: string, args: string[]): RunResult {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...args], {
      cwd,
      env: { ...process.env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'swarm-wt-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'README.md'), '# fixture\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '-q', '-m', 'init');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('swarm-worktrees.sh — add', () => {
  it('creates one isolated worktree per branch, each checked out on its own branch', () => {
    const res = run(repo, ['add', 'task1', 'b1', 'b2']);
    expect(res.status).toBe(0);

    const p1 = join(repo, '.worktrees/task1/b1');
    const p2 = join(repo, '.worktrees/task1/b2');
    // Prints one created path per line.
    expect(res.stdout).toContain(p1);
    expect(res.stdout).toContain(p2);
    expect(existsSync(p1)).toBe(true);
    expect(existsSync(p2)).toBe(true);

    // Each worktree is a DISTINCT checkout on its OWN branch — the isolation
    // the broken hook failed to provide.
    expect(git(p1, 'branch', '--show-current').trim()).toBe('b1');
    expect(git(p2, 'branch', '--show-current').trim()).toBe('b2');
    // Main tree is untouched (still on main).
    expect(git(repo, 'branch', '--show-current').trim()).toBe('main');
  });

  it('supports nested branch names (feature/x)', () => {
    const res = run(repo, ['add', 'task2', 'feature/x']);
    expect(res.status).toBe(0);
    const p = join(repo, '.worktrees/task2/feature/x');
    expect(existsSync(p)).toBe(true);
    expect(git(p, 'branch', '--show-current').trim()).toBe('feature/x');
  });

  it('attaches an EXISTING branch instead of failing with -b', () => {
    git(repo, 'branch', 'preexisting');
    const res = run(repo, ['add', 'task3', 'preexisting']);
    expect(res.status).toBe(0);
    expect(git(join(repo, '.worktrees/task3/preexisting'), 'branch', '--show-current').trim()).toBe(
      'preexisting',
    );
  });

  it('refuses to overwrite an existing worktree path (discriminating: non-zero exit)', () => {
    expect(run(repo, ['add', 'task4', 'dup']).status).toBe(0);
    const second = run(repo, ['add', 'task4', 'dup']);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/already exists/);
  });

  it('errors when add is given no branches', () => {
    const res = run(repo, ['add', 'task5']);
    expect(res.status).toBe(2);
  });
});

describe('swarm-worktrees.sh — list / cleanup', () => {
  it('lists the worktrees for a task', () => {
    run(repo, ['add', 'taskL', 'b1', 'b2']);
    const res = run(repo, ['list', 'taskL']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('.worktrees/taskL/b1');
    expect(res.stdout).toContain('.worktrees/taskL/b2');
  });

  it('cleanup removes every worktree for the task and reclaims the dir', () => {
    run(repo, ['add', 'taskC', 'b1', 'feature/y']);
    expect(existsSync(join(repo, '.worktrees/taskC/b1'))).toBe(true);

    const res = run(repo, ['cleanup', 'taskC']);
    expect(res.status).toBe(0);

    // Dir gone, and git no longer tracks the worktrees.
    expect(existsSync(join(repo, '.worktrees/taskC'))).toBe(false);
    const wtList = git(repo, 'worktree', 'list', '--porcelain');
    expect(wtList).not.toContain('.worktrees/taskC/');
    // Branches survive cleanup (may hold unmerged work / open PRs).
    expect(git(repo, 'branch', '--list', 'b1').trim()).toContain('b1');
  });

  it('cleanup is a safe no-op for an unknown task', () => {
    expect(run(repo, ['cleanup', 'never-existed']).status).toBe(0);
  });
});

describe('swarm-worktrees.sh — path containment (security regression for #117 review)', () => {
  it('refuses a traversing task name and performs NO rm outside .worktrees/', () => {
    // A sibling of the repo that must survive — proves cleanup cannot rm-rf out
    // of the .worktrees/ subtree via a `..` task.
    const victimName = `victim-${process.pid}`;
    const victim = join(repo, '..', victimName);
    writeFileSync(victim, 'keep');
    try {
      const res = run(repo, ['cleanup', `../${victimName}`]);
      expect(res.status).toBe(2);
      // The destructive path never ran — sibling intact.
      expect(existsSync(victim)).toBe(true);
    } finally {
      rmSync(victim, { force: true });
    }
  });

  it('refuses task = ".." (would target the repo root)', () => {
    const res = run(repo, ['cleanup', '..']);
    expect(res.status).toBe(2);
    // Repo working tree intact.
    expect(existsSync(join(repo, 'README.md'))).toBe(true);
  });

  it('refuses a task containing a slash', () => {
    expect(run(repo, ['add', 'a/b', 'br']).status).toBe(2);
  });

  it('refuses a branch name that escapes via ..', () => {
    const res = run(repo, ['add', 'tasksec', '../../evil']);
    expect(res.status).toBe(2);
    // No worktree was created (validation runs before any add).
    expect(existsSync(join(repo, '.worktrees/tasksec'))).toBe(false);
  });
});

describe('swarm-worktrees.sh — usage', () => {
  it('exits 2 with no command', () => {
    expect(run(repo, []).status).toBe(2);
  });
  it('exits 2 on an unknown command', () => {
    expect(run(repo, ['frobnicate', 'task']).status).toBe(2);
  });
});
