import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { normalizePath } from './gitLog.js';

/**
 * Reads the repository root and HEAD commit straight from the `.git` files, so a cache hit costs
 * no git process (ADR-0012: "a re-open costs no git invocation"). Only reads files; never runs
 * anything. Returns undefined whenever the layout is unusual (reftable, missing refs, odd files),
 * and the caller then asks git.
 */
export async function readRepoHead(
  startDir: string,
): Promise<{ repoRoot: string; head: string } | undefined> {
  try {
    const found = await findGitDir(startDir);
    if (!found) return undefined;
    const head = await resolveHead(found.gitDir);
    if (!head) return undefined;
    return { repoRoot: normalizePath(await fs.realpath(found.root)), head };
  } catch {
    return undefined;
  }
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

async function findGitDir(startDir: string): Promise<{ root: string; gitDir: string } | undefined> {
  let dir = path.resolve(startDir);
  for (;;) {
    const dotGit = path.join(dir, '.git');
    const info = await fs.lstat(dotGit).catch(() => undefined);
    if (info?.isDirectory()) return { root: dir, gitDir: dotGit };
    if (info?.isFile()) {
      // Worktrees and submodules: ".git" is a file containing "gitdir: <path>".
      const match = (await fs.readFile(dotGit, 'utf8')).match(/^gitdir:\s*(.+?)\s*$/m);
      if (!match?.[1]) return undefined;
      return { root: dir, gitDir: path.resolve(dir, match[1]) };
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function resolveHead(gitDir: string): Promise<string | undefined> {
  const head = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
  if (SHA.test(head)) return head;
  const ref = head.match(/^ref:\s*(refs\/\S+)$/)?.[1];
  if (!ref || ref.split('/').includes('..')) return undefined;

  const commonDir = await readCommonDir(gitDir);
  for (const dir of [gitDir, commonDir]) {
    const loose = await fs.readFile(path.join(dir, ref), 'utf8').catch(() => undefined);
    const sha = loose?.trim();
    if (sha && SHA.test(sha)) return sha;
  }
  const packed = await fs.readFile(path.join(commonDir, 'packed-refs'), 'utf8').catch(() => '');
  for (const line of packed.split('\n')) {
    const [sha, name] = line.trim().split(' ');
    if (name === ref && sha && SHA.test(sha)) return sha;
  }
  return undefined;
}

async function readCommonDir(gitDir: string): Promise<string> {
  const text = await fs.readFile(path.join(gitDir, 'commondir'), 'utf8').catch(() => undefined);
  return text ? path.resolve(gitDir, text.trim()) : gitDir;
}
