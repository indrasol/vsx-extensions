// Helpers for building throwaway git repositories in tests and fixture scripts.
// The repositories are created by this code, so running git in them is safe; the user's global and
// system git config are ignored so commit signing, hooks or templates cannot change the output.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

const ISOLATED_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};

/**
 * Runs git in `cwd` and returns stdout as a Buffer. Throws on a non-zero exit.
 * @param {string} cwd @param {string[]} args @param {Record<string, string>} [env]
 */
export function git(cwd, args, env = {}) {
  const result = spawnSync('git', args, {
    cwd,
    env: { ...process.env, ...ISOLATED_ENV, ...env },
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString('utf8')}`);
  }
  return result.stdout;
}

/** @param {string} dir */
export function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Fixture Bot']);
  git(dir, ['config', 'user.email', 'bot@example.com']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
}

/**
 * Writes files relative to `dir`. A Buffer value is written as-is.
 * @param {string} dir @param {Record<string, string | Buffer>} files
 */
export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/**
 * Stages everything and commits with fixed author/committer data, so hashes are reproducible.
 * @param {string} dir
 * @param {{ message: string, date: string, name?: string, email?: string, extra?: string[] }} c
 */
export function commitAll(dir, c) {
  git(dir, ['add', '-A']);
  const env = {
    GIT_AUTHOR_NAME: c.name ?? 'Fixture Bot',
    GIT_AUTHOR_EMAIL: c.email ?? 'bot@example.com',
    GIT_COMMITTER_NAME: c.name ?? 'Fixture Bot',
    GIT_COMMITTER_EMAIL: c.email ?? 'bot@example.com',
    GIT_AUTHOR_DATE: c.date,
    GIT_COMMITTER_DATE: c.date,
  };
  git(
    dir,
    ['commit', '-q', '--allow-empty', '--allow-empty-message', '-m', c.message, ...(c.extra ?? [])],
    env,
  );
}

/** Lines of text; `n` numbered lines at the given indentation. @param {number} n @param {string} [indent] */
export function lines(n, indent = '') {
  return Array.from({ length: n }, (_, i) => `${indent}line ${String(i + 1)}`).join('\n') + '\n';
}
