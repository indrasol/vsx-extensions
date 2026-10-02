/**
 * The cache index: which repository the extension last analysed for each workspace folder, in
 * `<storageDir>/cache/index.json`. The extension writes it after every build; the MCP server
 * reads it, so an agent started in an umbrella folder uses the repository the user picked in the
 * editor instead of guessing. Node only (no `vscode`), no process; a missing or corrupt index is
 * simply empty.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { CACHE_DIR, normalizeRoot } from './cache.js';

export const INDEX_FILE = 'index.json';
/** The oldest entries are dropped beyond this many workspace folders. */
export const MAX_INDEX_ENTRIES = 200;

export interface IndexEntry {
  /** The repository root as git reports it. */
  repoRoot: string;
  /** ISO time of the build. */
  at: string;
}

export interface RepoIndex {
  version: 1;
  /** Normalised workspace folder → the repository last analysed for it. */
  workspaces: Record<string, IndexEntry>;
}

export function indexFile(storageDir: string): string {
  return path.join(storageDir, CACHE_DIR, INDEX_FILE);
}

function isEntry(x: unknown): x is IndexEntry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Partial<Record<keyof IndexEntry, unknown>>;
  return typeof e.repoRoot === 'string' && typeof e.at === 'string';
}

/** The index, or an empty one when it is missing, unreadable or malformed. */
export async function readIndex(storageDir: string): Promise<RepoIndex> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(indexFile(storageDir), 'utf8'));
    const workspaces: Record<string, IndexEntry> = {};
    if (typeof parsed === 'object' && parsed !== null && 'workspaces' in parsed) {
      const raw = parsed.workspaces;
      if (typeof raw === 'object' && raw !== null) {
        for (const [key, value] of Object.entries(raw)) if (isEntry(value)) workspaces[key] = value;
      }
    }
    return { version: 1, workspaces };
  } catch {
    return { version: 1, workspaces: {} };
  }
}

/** The folder's spellings: as given and, when it differs, its real path (symlinks resolved). */
async function spellings(folder: string): Promise<string[]> {
  const keys = [normalizeRoot(folder)];
  const real = await fs.realpath(folder).catch(() => undefined);
  if (real !== undefined && !keys.includes(normalizeRoot(real))) keys.push(normalizeRoot(real));
  return keys;
}

/** Records `repoRoot` as the last repository analysed for each of `folders`. Atomic write. */
export async function recordLastRepo(
  storageDir: string,
  folders: readonly string[],
  repoRoot: string,
  now: Date = new Date(),
): Promise<void> {
  const index = await readIndex(storageDir);
  const entries = new Map(Object.entries(index.workspaces));
  for (const folder of folders) {
    for (const key of await spellings(folder)) {
      // Re-inserted, so the most recent build is last and the oldest are dropped first.
      entries.delete(key);
      entries.set(key, { repoRoot, at: now.toISOString() });
    }
  }
  index.workspaces = Object.fromEntries([...entries].slice(-MAX_INDEX_ENTRIES));
  const file = indexFile(storageDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(index), 'utf8');
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
}

/** The repository last analysed for `folder` (or the folder's real path), if any. */
export async function lastRepoFor(storageDir: string, folder: string): Promise<string | undefined> {
  const index = await readIndex(storageDir);
  for (const key of await spellings(folder)) {
    const entry = index.workspaces[key];
    if (entry) return entry.repoRoot;
  }
  return undefined;
}
