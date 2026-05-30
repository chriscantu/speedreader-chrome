import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Tests for bin/verify-font-integrity.sh (issue #173).
 *
 * The script is the runtime guard against silent supply-chain TOFU on
 * bundled font binaries — if the on-disk woff2 hash drifts from the
 * pinned sha256 in fonts/README.md, the script MUST exit non-zero.
 *
 * Tests in this file:
 *   1. Real-state happy path — script exits 0 against the worktree fonts/.
 *   2. Mutation test — fixture README with a wrong-hash line yields a
 *      non-zero exit. This is the discriminating signal: if mutation
 *      passes too, the assertion is tautological.
 *   3. Missing-license guard — fixture without OFL.txt/LICENSE fails.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'bin', 'verify-font-integrity.sh');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(
  fontsDir: string,
  opts: { args?: string[]; distDir?: string } = {},
): RunResult {
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, FONTS_DIR: fontsDir };
    if (opts.distDir !== undefined) {
      env.DIST_FONTS_DIR = opts.distDir;
    }
    const stdout = execFileSync('bash', [SCRIPT, ...(opts.args ?? [])], {
      cwd: REPO_ROOT,
      env,
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

describe('verify-font-integrity.sh', () => {
  it('exits 0 against the real worktree fonts/ directory', () => {
    const result = runScript(join(REPO_ROOT, 'fonts'));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/ok\s+OpenDyslexic-Regular\.woff2/);
  });

  it('exits non-zero when README pins a wrong sha256 (mutation test)', () => {
    // Stage a fixture dir containing the real binary + OFL.txt but a
    // README whose pinned hash is one hex character off. If the script's
    // assertion is real, this MUST fail. If it passes, the assertion is
    // tautological and the guard does nothing.
    const dir = mkdtempSync(join(tmpdir(), 'verify-font-mutation-'));
    copyFileSync(
      join(REPO_ROOT, 'fonts', 'OpenDyslexic-Regular.woff2'),
      join(dir, 'OpenDyslexic-Regular.woff2'),
    );
    copyFileSync(join(REPO_ROOT, 'fonts', 'OFL.txt'), join(dir, 'OFL.txt'));

    const realReadme = readFileSync(join(REPO_ROOT, 'fonts', 'README.md'), 'utf8');
    // Flip the first hex char of the pinned hash. `0441…` → `1441…`.
    const mutated = realReadme.replace(
      /sha256:0441bc21071e42db57c217f93fbc48d3b55a2987c02814c94dc93621c42e8695/,
      'sha256:1441bc21071e42db57c217f93fbc48d3b55a2987c02814c94dc93621c42e8695',
    );
    expect(mutated).not.toBe(realReadme); // sanity: replacement actually fired
    writeFileSync(join(dir, 'README.md'), mutated);

    const result = runScript(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/HASH MISMATCH/);
  });

  it('exits non-zero when license file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-font-nolicense-'));
    copyFileSync(
      join(REPO_ROOT, 'fonts', 'OpenDyslexic-Regular.woff2'),
      join(dir, 'OpenDyslexic-Regular.woff2'),
    );
    copyFileSync(join(REPO_ROOT, 'fonts', 'README.md'), join(dir, 'README.md'));
    // Deliberately omit OFL.txt / LICENSE.

    const result = runScript(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no OFL\.txt or LICENSE/);
  });

  it('exits non-zero when README has no pinned hash for an existing woff2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-font-nopin-'));
    copyFileSync(
      join(REPO_ROOT, 'fonts', 'OpenDyslexic-Regular.woff2'),
      join(dir, 'OpenDyslexic-Regular.woff2'),
    );
    copyFileSync(join(REPO_ROOT, 'fonts', 'OFL.txt'), join(dir, 'OFL.txt'));
    // README with no pinned-hash line for OpenDyslexic.
    writeFileSync(join(dir, 'README.md'), '# Fonts\n\nNo pins here.\n');

    const result = runScript(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no pinned sha256/);
  });

  describe('--check-dist flag', () => {
    // Pre-build catches source tamper; post-build (--check-dist) catches
    // Vite/crxjs-plugin rewrites of the emitted woff2. Same pinned hash
    // is the source of truth for both.

    it('exits 0 when dist woff2 matches pinned hash', () => {
      const fontsDir = mkdtempSync(join(tmpdir(), 'verify-font-dist-ok-fonts-'));
      const distDir = mkdtempSync(join(tmpdir(), 'verify-font-dist-ok-dist-'));
      copyFileSync(
        join(REPO_ROOT, 'fonts', 'OpenDyslexic-Regular.woff2'),
        join(fontsDir, 'OpenDyslexic-Regular.woff2'),
      );
      copyFileSync(join(REPO_ROOT, 'fonts', 'OFL.txt'), join(fontsDir, 'OFL.txt'));
      copyFileSync(join(REPO_ROOT, 'fonts', 'README.md'), join(fontsDir, 'README.md'));

      // Byte-identical copy in the simulated dist/fonts/.
      copyFileSync(
        join(REPO_ROOT, 'fonts', 'OpenDyslexic-Regular.woff2'),
        join(distDir, 'OpenDyslexic-Regular.woff2'),
      );

      const result = runScript(fontsDir, { args: ['--check-dist'], distDir });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/dist ok\s+OpenDyslexic-Regular\.woff2/);
    });

    it('exits non-zero when dist woff2 has been perturbed', () => {
      const fontsDir = mkdtempSync(join(tmpdir(), 'verify-font-dist-bad-fonts-'));
      const distDir = mkdtempSync(join(tmpdir(), 'verify-font-dist-bad-dist-'));
      copyFileSync(
        join(REPO_ROOT, 'fonts', 'OpenDyslexic-Regular.woff2'),
        join(fontsDir, 'OpenDyslexic-Regular.woff2'),
      );
      copyFileSync(join(REPO_ROOT, 'fonts', 'OFL.txt'), join(fontsDir, 'OFL.txt'));
      copyFileSync(join(REPO_ROOT, 'fonts', 'README.md'), join(fontsDir, 'README.md'));

      // Perturb the dist binary — flip a single trailing byte. Source
      // woff2 is unchanged, so a pre-build run still passes; only the
      // --check-dist pass catches the rewrite.
      const realBytes = readFileSync(join(REPO_ROOT, 'fonts', 'OpenDyslexic-Regular.woff2'));
      const perturbed = Buffer.from(realBytes);
      perturbed[perturbed.length - 1] = perturbed[perturbed.length - 1] ^ 0xff;
      writeFileSync(join(distDir, 'OpenDyslexic-Regular.woff2'), perturbed);

      const result = runScript(fontsDir, { args: ['--check-dist'], distDir });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/dist HASH MISMATCH/);
    });

    it('exits non-zero when --check-dist target dir has no woff2', () => {
      const fontsDir = mkdtempSync(join(tmpdir(), 'verify-font-dist-empty-fonts-'));
      const distDir = mkdtempSync(join(tmpdir(), 'verify-font-dist-empty-dist-'));
      copyFileSync(
        join(REPO_ROOT, 'fonts', 'OpenDyslexic-Regular.woff2'),
        join(fontsDir, 'OpenDyslexic-Regular.woff2'),
      );
      copyFileSync(join(REPO_ROOT, 'fonts', 'OFL.txt'), join(fontsDir, 'OFL.txt'));
      copyFileSync(join(REPO_ROOT, 'fonts', 'README.md'), join(fontsDir, 'README.md'));
      // distDir intentionally empty — Vite-plugin failed to emit fonts.

      const result = runScript(fontsDir, { args: ['--check-dist'], distDir });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/dist .* missing|no \*\.woff2 files in/);
    });
  });

  it('exits non-zero when fonts dir contains no woff2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-font-empty-'));
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(REPO_ROOT, 'fonts', 'OFL.txt'), join(dir, 'OFL.txt'));
    copyFileSync(join(REPO_ROOT, 'fonts', 'README.md'), join(dir, 'README.md'));

    const result = runScript(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no \*\.woff2 files/);
  });
});
