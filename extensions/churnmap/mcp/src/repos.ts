/**
 * Which repositories the scope holds (`scope.ts`: the workspace folders), and which one a tool
 * call without `repo` means. The same discovery as the extension (nested repositories up to three
 * folders deep, no git process for the walk, never above a scope root) and the same umbrella rule
 * (≥ 70 % of a repository's tracked files are not code), so an agent in an umbrella folder of
 * notes never analyses the notes by accident.
 */
import * as path from 'node:path';
import { normalizeRoot } from '../../src/analysis/cache.js';
import { isMostlyNonCode } from '../../src/analysis/classify.js';
import {
  type DiscoveryFs,
  discoverRepositories,
  nodeDiscoveryFs,
} from '../../src/analysis/discover.js';
import { readRepoHead } from '../../src/analysis/repoHead.js';

export interface RepoInfo {
  /** The folder's name. */
  name: string;
  /** The repository root as git reports it (the cache key). */
  root: string;
  /** Found below a scope folder rather than being it (or holding it). */
  nested: boolean;
  /** Mostly documentation, notes or data: never picked without being asked for. */
  umbrella: boolean;
  /** The repository the Churnmap extension last analysed for this workspace. */
  lastAnalysed: boolean;
}

/** A repository in the scope, before the umbrella test. */
export interface ScopeRepo {
  name: string;
  /** The repository root as git reports it (the cache key). */
  root: string;
  nested: boolean;
  /**
   * The repository a scope folder sits inside (a workspace opened on a subfolder of a monorepo).
   * Counted only for a folder with no repository at or below it, so a folder of projects inside,
   * say, a home folder kept in git does not bring the whole home folder into scope.
   */
  enclosing: boolean;
}

export interface RepoSources {
  /** The scope folders (`resolveScope`). */
  roots: readonly string[];
  /** Folders excluded from the walk (`churnmap.exclude`). */
  exclude: readonly string[];
  /** `git ls-files` for a repository (the umbrella test). */
  trackedFiles(root: string): Promise<string[]>;
  /** The repository the extension last analysed for the scope (the cache index). */
  lastAnalysed(): Promise<string | undefined>;
  readHead?: typeof readRepoHead;
  dfs?: DiscoveryFs;
}

/** Every repository in the scope, in discovery order (no git process: directory listings only). */
export async function findRepositories(
  src: Pick<RepoSources, 'roots' | 'exclude' | 'readHead' | 'dfs'>,
): Promise<ScopeRepo[]> {
  const readHead = src.readHead ?? readRepoHead;
  const { candidates } = await discoverRepositories(src.roots, src.dfs ?? nodeDiscoveryFs, {
    exclude: src.exclude,
  });
  const repos: ScopeRepo[] = [];
  const seen = new Set<string>();
  const add = (root: string, nested: boolean, enclosing: boolean): void => {
    if (seen.has(normalizeRoot(root))) return;
    seen.add(normalizeRoot(root));
    repos.push({ name: path.basename(root), root, nested, enclosing });
  };
  for (const c of candidates) {
    const head = await readHead(c.root);
    add(head?.repoRoot ?? c.root, c.isNested, false);
  }
  for (const root of src.roots) {
    if (candidates.some((c) => c.workspaceFolder === root)) continue;
    // `.git` above the folder: read, not walked (the same lookup git does).
    const head = await readHead(root);
    if (head) add(head.repoRoot, false, true);
  }
  return repos;
}

/**
 * Every repository in the scope with its umbrella test and last-analysed mark. `found` is the
 * `findRepositories` result when the caller already has it.
 */
export async function listRepositories(
  src: RepoSources,
  found?: readonly ScopeRepo[],
): Promise<RepoInfo[]> {
  const scoped = found ?? (await findRepositories(src));
  const last = await src.lastAnalysed().catch(() => undefined);
  const lastKey = last === undefined ? undefined : normalizeRoot(last);
  const repos: RepoInfo[] = [];
  for (const r of scoped) {
    const tracked = await src.trackedFiles(r.root).catch(() => undefined);
    repos.push({
      name: r.name,
      root: r.root,
      nested: r.nested,
      // Unreadable: treated as code, so it stays pickable.
      umbrella: tracked === undefined ? false : isMostlyNonCode(tracked),
      lastAnalysed: normalizeRoot(r.root) === lastKey,
    });
  }
  return repos;
}

export type DefaultRepo =
  | { kind: 'repo'; root: string; reason: 'last-analysed' | 'only' | 'only-code' | 'folder' }
  /** Several code repositories (or only umbrellas): the agent must pass `repo`. */
  | { kind: 'ask'; repositories: RepoInfo[] };

/**
 * The repository a call without `repo` is about: the one the extension last analysed for the
 * workspace, else the only repository, else the only one that is not an umbrella, else none (the
 * agent gets the list and passes `repo`). With no repository in the scope, its first folder (the
 * caller then reports that it is not a repository).
 */
export async function defaultRepo(
  src: RepoSources,
  found?: readonly ScopeRepo[],
): Promise<DefaultRepo> {
  const last = await src.lastAnalysed().catch(() => undefined);
  if (last !== undefined) return { kind: 'repo', root: last, reason: 'last-analysed' };
  const repos = await listRepositories(src, found);
  const first = repos[0];
  if (!first) return { kind: 'repo', root: src.roots[0] ?? '', reason: 'folder' };
  if (repos.length === 1) return { kind: 'repo', root: first.root, reason: 'only' };
  const code = repos.filter((r) => !r.umbrella);
  const only = code[0];
  if (code.length === 1 && only) return { kind: 'repo', root: only.root, reason: 'only-code' };
  return { kind: 'ask', repositories: repos };
}
