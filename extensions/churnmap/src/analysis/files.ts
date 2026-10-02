import { BUILTIN_EXCLUDES, compileGlobs } from './glob.js';
import { normalizePath } from './gitLog.js';
import { abortedError, GitError, runGit as defaultRunGit, type RunGit } from './gitProcess.js';
import { measureBatch } from './measureFile.js';
import type { AnalysisLogger, FileStat, TreeOptions } from './model.js';
import type { MeasurePool } from './pool.js';

/** Paths per worker message. */
export const BATCH_SIZE = 200;

/** Tracked files in the current tree: `git ls-files -z`, UTF-8, forward slashes, sorted. */
export async function listTrackedFiles(
  gitPath: string,
  repoRoot: string,
  hooksDir: string,
  signal?: AbortSignal,
  run: RunGit = defaultRunGit,
): Promise<string[]> {
  const { stdout } = await run(
    gitPath,
    ['ls-files', '-z', '--cached', '--exclude-standard', '--', '.'],
    { cwd: repoRoot, hooksDir, signal },
  );
  const paths: string[] = [];
  let start = 0;
  for (let i = 0; i < stdout.length; i++) {
    if (stdout[i] === 0) {
      if (i > start) paths.push(normalizePath(stdout.toString('utf8', start, i)));
      start = i + 1;
    }
  }
  if (start < stdout.length) paths.push(normalizePath(stdout.toString('utf8', start)));
  // ls-files lists each unmerged path once per stage; keep one.
  return [...new Set(paths)].sort(compareCodeUnits);
}

/** Plain code-unit order, so the order (and the `maxFiles` cut) is the same on every machine. */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface Selection {
  selected: string[];
  /** Paths removed by the built-in or user exclusions. */
  excludedCount: number;
  /** True when `maxFiles` cut the list. */
  capped: boolean;
}

/** Applies the built-in exclusions, then the user globs, then keeps the first `maxFiles`. */
export function selectFiles(
  paths: readonly string[],
  opts: Pick<TreeOptions, 'exclude' | 'maxFiles'>,
): Selection {
  const builtIn = compileGlobs(BUILTIN_EXCLUDES);
  const user = compileGlobs(opts.exclude);
  const kept = [...paths].sort(compareCodeUnits).filter((p) => !builtIn(p) && !user(p));
  const excludedCount = paths.length - kept.length;
  const max = Math.max(1, Math.floor(opts.maxFiles));
  const capped = kept.length > max;
  return { selected: capped ? kept.slice(0, max) : kept, excludedCount, capped };
}

export interface MeasureContext {
  /** Measure in workers; without one (or if it fails) files are measured in-process. */
  pool?: MeasurePool | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((measured: number, total: number) => void) | undefined;
  logger?: AnalysisLogger | undefined;
  batchSize?: number;
}

/**
 * Measures every path (size cap, binary skip, LOC and indentation complexity). Results are in
 * input order. A worker pool that is missing or fails is logged once and the remaining batches
 * are measured in-process, so a build never fails because of the pool.
 */
export async function measureFiles(
  repoRoot: string,
  paths: readonly string[],
  opts: Pick<TreeOptions, 'maxBytes'>,
  ctx: MeasureContext = {},
): Promise<FileStat[]> {
  const { pool, signal, onProgress, logger } = ctx;
  const size = Math.max(1, ctx.batchSize ?? BATCH_SIZE);
  const batches: string[][] = [];
  for (let i = 0; i < paths.length; i += size) batches.push(paths.slice(i, i + size));
  const results: (FileStat[] | undefined)[] = new Array<FileStat[] | undefined>(batches.length);
  let measured = 0;
  const report = (index: number, stats: FileStat[]): void => {
    if (results[index]) return;
    results[index] = stats;
    measured += stats.length;
    onProgress?.(measured, paths.length);
  };

  if (pool && batches.length > 0) {
    try {
      await pool.measure(repoRoot, batches, opts.maxBytes, signal, report);
    } catch (err) {
      if (err instanceof GitError && err.kind === 'aborted') throw err;
      logger?.warn(
        `Worker pool unavailable (${err instanceof Error ? err.message : String(err)}); measuring in-process.`,
      );
    }
  }

  for (const [index, batch] of batches.entries()) {
    if (results[index]) continue;
    if (signal?.aborted) throw abortedError();
    report(index, await measureBatch(repoRoot, batch, opts.maxBytes));
  }
  return results.flatMap((stats) => stats ?? []);
}
