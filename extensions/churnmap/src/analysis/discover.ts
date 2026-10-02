import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { normalizeRoot } from './cache.js';
import { compileGlobs } from './glob.js';

/**
 * Finds the git repositories a workspace holds: every workspace folder that is a repository root,
 * plus repositories nested up to `maxDepth` folders below one (an "umbrella" folder of docs with
 * the real code in nested clones, submodules, worktrees). Reads directory listings only and never
 * runs git (ADR-0012), so it is safe before Workspace Trust; analysis still needs trust.
 */

export interface DirEntry {
  name: string;
  /** Symbolic links are `other`, so the walk never follows one. */
  kind: 'dir' | 'file' | 'other';
}

/** The one filesystem call discovery makes; injected in tests. */
export interface DiscoveryFs {
  readdir(dir: string): Promise<DirEntry[]>;
}

export interface RepoCandidate {
  /** Absolute path of the repository's working tree (the folder holding `.git`). */
  root: string;
  /** The folder's name. */
  name: string;
  /** True when found below a workspace folder rather than being one. */
  isNested: boolean;
  /** The closest enclosing candidate, for a nested one. */
  parentRoot?: string;
  /** The workspace folder it was found in. */
  workspaceFolder: string;
}

export interface DiscoverOptions {
  /** `churnmap.exclude`: folders matching these globs are not walked. */
  exclude?: readonly string[];
  maxDepth?: number;
  maxCandidates?: number;
  maxDirs?: number;
}

export const MAX_DEPTH = 3;
export const MAX_CANDIDATES = 50;
export const MAX_DIRS = 2000;

/** Folders never walked: dependencies, virtual environments, build output and git's own. */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  '.git',
]);

export interface Discovery {
  candidates: RepoCandidate[];
  /** Directories listed. */
  dirs: number;
  /** True when a cap stopped the walk early. */
  truncated: boolean;
}

interface Pending {
  dir: string;
  rel: string;
  depth: number;
  folder: string;
  parentRoot: string | undefined;
}

/** A `.git` directory, or a `.git` file (worktrees and submodules point at their git dir with one). */
function hasDotGit(entries: readonly DirEntry[]): boolean {
  return entries.some((e) => e.name === '.git' && (e.kind === 'dir' || e.kind === 'file'));
}

export async function discoverRepositories(
  folders: readonly string[],
  dfs: DiscoveryFs = nodeDiscoveryFs,
  opts: DiscoverOptions = {},
): Promise<Discovery> {
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const maxCandidates = opts.maxCandidates ?? MAX_CANDIDATES;
  const maxDirs = opts.maxDirs ?? MAX_DIRS;
  const excluded = compileGlobs(opts.exclude ?? []);
  // A folder is skipped when it, or anything inside it, matches (`**/dist/**` names the contents).
  const skip = (name: string, rel: string): boolean =>
    SKIPPED_DIRS.has(name) || excluded(rel) || excluded(`${rel}/_`);

  const candidates: RepoCandidate[] = [];
  const seen = new Set<string>();
  let dirs = 0;
  let truncated = false;

  for (const folder of folders) {
    const queue: Pending[] = [{ dir: folder, rel: '', depth: 0, folder, parentRoot: undefined }];
    while (queue.length > 0) {
      if (candidates.length >= maxCandidates || dirs >= maxDirs) {
        truncated = true;
        break;
      }
      const next = queue.shift();
      if (!next) break;
      dirs += 1;
      const entries = await dfs.readdir(next.dir).catch(() => [] as DirEntry[]);
      let parentRoot = next.parentRoot;
      if (hasDotGit(entries)) {
        const key = normalizeRoot(next.dir);
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push({
            root: next.dir,
            name: path.basename(next.dir),
            isNested: next.depth > 0,
            ...(next.parentRoot === undefined ? {} : { parentRoot: next.parentRoot }),
            workspaceFolder: next.folder,
          });
        }
        parentRoot = next.dir;
      }
      if (next.depth >= maxDepth) continue;
      const children = entries
        .filter((e) => e.kind === 'dir')
        .map((e) => e.name)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      for (const name of children) {
        const rel = next.rel === '' ? name : `${next.rel}/${name}`;
        if (skip(name, rel)) continue;
        queue.push({
          dir: path.join(next.dir, name),
          rel,
          depth: next.depth + 1,
          folder: next.folder,
          parentRoot,
        });
      }
    }
    if (truncated) break;
  }
  return { candidates, dirs, truncated };
}

/** The real filesystem: one `readdir` per folder, no stat of each entry, no process. */
export const nodeDiscoveryFs: DiscoveryFs = {
  async readdir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      kind: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
    }));
  },
};
