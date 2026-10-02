import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isBinary, measureText } from './measure.js';
import type { FileStat } from './model.js';

/** A skipped file's stat: no measurements. */
export function skippedStat(
  relPath: string,
  skipped: NonNullable<FileStat['skipped']>,
  bytes = 0,
): FileStat {
  return { path: relPath, bytes, loc: 0, maxDepth: 0, meanDepth: 0, complexity: 0, skipped };
}

/** Joins a tracked path to the root, refusing anything that would leave the repository. */
export function resolveInside(repoRoot: string, relPath: string): string | undefined {
  if (relPath.length === 0 || path.isAbsolute(relPath)) return undefined;
  if (relPath.split('/').some((segment) => segment === '..')) return undefined;
  return path.join(repoRoot, relPath);
}

/**
 * Measures one tracked file. Only regular files are read (symlinks, submodules and special files
 * are "unreadable"), files over `maxBytes` are not read at all, and binaries are skipped.
 * Files below the LOC floor are still returned with real numbers; the scorer excludes them.
 */
export async function measureFile(
  repoRoot: string,
  relPath: string,
  maxBytes: number,
): Promise<FileStat> {
  const file = resolveInside(repoRoot, relPath);
  if (!file) return skippedStat(relPath, 'unreadable');
  try {
    const info = await fs.lstat(file);
    if (!info.isFile()) return skippedStat(relPath, 'unreadable');
    if (info.size > maxBytes) return skippedStat(relPath, 'too-large', info.size);
    const buf = await fs.readFile(file);
    if (isBinary(buf)) return skippedStat(relPath, 'binary', buf.length);
    return { path: relPath, bytes: buf.length, ...measureText(buf.toString('utf8')) };
  } catch {
    return skippedStat(relPath, 'unreadable');
  }
}

/** Measures paths with at most `concurrency` files open at once; results keep the input order. */
export async function measureBatch(
  repoRoot: string,
  paths: readonly string[],
  maxBytes: number,
  concurrency = 16,
): Promise<FileStat[]> {
  const results = new Array<FileStat>(paths.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < paths.length) {
      const index = next;
      next += 1;
      results[index] = await measureFile(repoRoot, paths[index] ?? '', maxBytes);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, lane));
  return results;
}
