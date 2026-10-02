import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { readRepoHead } from '../../src/analysis/repoHead.js';

export type RepoResolution =
  { ok: true; repoRoot: string; head: string } | { ok: false; message: string };

/**
 * The repository a tool call is about: its `repo` argument, else `--repo`, else the server's
 * working directory (agents start MCP servers in the project). The path must exist, be a folder,
 * contain no `..` segment, and be inside a git repository whose HEAD can be read from `.git`
 * (no git process). A relative path is taken from the default folder.
 */
export async function resolveRepo(
  arg: string | undefined,
  defaults: { repo?: string | undefined; cwd: string },
  readHead: typeof readRepoHead = readRepoHead,
): Promise<RepoResolution> {
  const base = defaults.repo ?? defaults.cwd;
  const raw = arg === undefined || arg.trim() === '' ? base : arg;
  if (raw.includes('\0') || raw.split(/[\\/]/).includes('..')) {
    return { ok: false, message: `Refused "${raw}": ".." is not allowed in a repository path.` };
  }
  const dir = path.isAbsolute(raw) ? raw : path.resolve(base, raw);
  const stat = await fs.stat(dir).catch(() => undefined);
  if (!stat?.isDirectory()) {
    return { ok: false, message: `Refused "${raw}": no such folder.` };
  }
  const head = await readHead(dir);
  if (!head) {
    return {
      ok: false,
      message: `Refused "${raw}": not inside a git repository (or its HEAD could not be read).`,
    };
  }
  return { ok: true, repoRoot: head.repoRoot, head: head.head };
}

/**
 * A path from an agent as repository-relative with forward slashes: absolute paths inside the
 * repository are made relative; anything outside it, or with `..`, is undefined.
 */
export function toRepoPath(repoRoot: string, file: string): string | undefined {
  const slashes = file.replace(/\\/g, '/');
  if (path.isAbsolute(file) || /^[A-Za-z]:\//.test(slashes)) {
    const rel = path.relative(repoRoot, file).replace(/\\/g, '/');
    if (rel === '' || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) {
      return undefined;
    }
    return rel;
  }
  const rel = slashes.replace(/^\.\//, '');
  const parts = rel.split('/');
  if (rel === '' || parts.some((p) => p === '' || p === '..' || p === '.')) return undefined;
  return rel;
}
