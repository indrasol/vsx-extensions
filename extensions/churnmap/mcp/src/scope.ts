/**
 * What the server may see. Agents do not always start an MCP server in the project: Cursor can
 * start it in a folder above it, and discovery from there would list every project on the disk.
 * So the scope is explicit: the workspace folders `--workspace` names (Connect to AI agent writes
 * one per folder), else `--repo`'s folder, else the working directory, and that only when it is
 * inside a git repository. With none of these every tool refuses. Discovery walks down from the
 * scope roots and never above them.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { normalizeRoot } from '../../src/analysis/cache.js';
import { normalizePath } from '../../src/analysis/gitLog.js';
import { readRepoHead } from '../../src/analysis/repoHead.js';

/** Every tool's answer when the server cannot tell which workspace it serves. */
export const NO_WORKSPACE =
  'Churnmap MCP has no workspace configured; reconnect via Churnmap: Connect to AI agent';

export interface Scope {
  /** Absolute folders, symlinks resolved, forward slashes. */
  roots: string[];
  /** Where the roots came from: `--workspace`, `--repo`, or the working directory. */
  source: 'workspace' | 'repo' | 'cwd';
}

/** A path in the spelling repository roots have (`readRepoHead`): real, forward slashes. */
export async function realRoot(dir: string): Promise<string> {
  const resolved = path.resolve(dir);
  return normalizePath(await fs.realpath(resolved).catch(() => resolved));
}

/** `child` is `parent` or below it (no `..` tricks: both are absolute and normalised). */
export function isInside(child: string, parent: string): boolean {
  const c = normalizeRoot(child);
  const p = normalizeRoot(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** The scope, or undefined when there is none (every tool then answers `NO_WORKSPACE`). */
export async function resolveScope(
  opts: { workspaces?: readonly string[] | undefined; repo?: string | undefined; cwd: string },
  readHead: typeof readRepoHead = readRepoHead,
): Promise<Scope | undefined> {
  if (opts.workspaces !== undefined && opts.workspaces.length > 0) {
    const roots: string[] = [];
    for (const w of opts.workspaces) {
      const root = await realRoot(w);
      if (!roots.some((r) => normalizeRoot(r) === normalizeRoot(root))) roots.push(root);
    }
    return { roots, source: 'workspace' };
  }
  // An explicit --repo is a narrower pin than any folder, so it stands in for the workspace.
  if (opts.repo !== undefined) return { roots: [await realRoot(opts.repo)], source: 'repo' };
  // Without either, the working directory only when it is inside a git repository (`.git` here or
  // in a parent): a folder above several projects is exactly the case this guards against.
  if ((await readHead(opts.cwd)) === undefined) return undefined;
  return { roots: [await realRoot(opts.cwd)], source: 'cwd' };
}

/** "Scope: Acme workspace, 5 repositories" (one line, at the top of every answer). */
export function scopeLine(scope: Scope, repositories: number): string {
  const names = scope.roots.map((r) => path.posix.basename(r) || r).join(' + ');
  const kind =
    scope.source === 'workspace' ? 'workspace' : scope.source === 'repo' ? 'repository' : 'folder';
  return `Scope: ${names} ${kind}, ${String(repositories)} ${repositories === 1 ? 'repository' : 'repositories'}`;
}

/** The refusal for a repository outside the scope, naming the folders that are allowed. */
export function outsideScope(requested: string, scope: Scope): string {
  return `Refused "${requested}": outside the workspace Churnmap is connected to. Allowed: ${scope.roots.join(', ')}.`;
}
