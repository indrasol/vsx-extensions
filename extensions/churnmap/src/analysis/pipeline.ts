import { createHash } from 'node:crypto';
import { withBands } from './bands.js';
import { AnalysisCache } from './cache.js';
import type { RankMode } from './classify.js';
import { listTrackedFiles, type MeasureContext, measureFiles, selectFiles } from './files.js';
import { getGitInfo, readCommits } from './gitLog.js';
import { runGit as defaultRunGit, type RunGit } from './gitProcess.js';
import {
  ANALYSIS_VERSION,
  type AnalysisLogger,
  type AnalysisResult,
  DEFAULT_MAX_BYTES,
  DEFAULT_MIN_LOC,
  type FileStat,
  type TreeOptions,
  type Window,
} from './model.js';
import type { MeasurePool } from './pool.js';
import { readRepoHead } from './repoHead.js';
import { aggregate, compileFixKeywords, rank, scoreFiles } from './score.js';
import { recentSubjects, subjectPaths } from './subjects.js';
import { computeTrends } from './trend.js';

/** Bumped when scoring changes meaning, so older cached results stop matching. */
export const SCORING_VERSION = 1;

export interface AnalysisSettings {
  exclude: string[];
  maxFiles: number;
  fixKeywords: string;
  maxBytes?: number;
  minLoc?: number;
  /** `churnmap.rank`; `code` (the default) ranks source code only. */
  rank?: RankMode;
}

export interface PipelineDeps {
  /** The git executable, or a lazy resolver so a cache hit never starts git. */
  gitPath: string | (() => Promise<{ gitPath: string; version: string }>);
  hooksDir: string;
  /** The extension's global storage folder; the cache lives in `<storageDir>/cache`. */
  storageDir: string;
  /** The workspace folder being analysed (any folder inside the repository). */
  cwd: string;
  settings: AnalysisSettings;
  logger: AnalysisLogger;
  /** Injected in tests; defaults to the real ones. */
  run?: RunGit;
  pool?: MeasurePool | undefined;
  measure?: (
    repoRoot: string,
    paths: readonly string[],
    opts: Pick<TreeOptions, 'maxBytes'>,
    ctx: MeasureContext,
  ) => Promise<FileStat[]>;
  readHead?: typeof readRepoHead;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

export interface RunOptions {
  window: Window;
  /** Skip the cache read (the result is still written). */
  force?: boolean;
  signal?: AbortSignal | undefined;
  onProgress?: ((message: string) => void) | undefined;
}

export interface PipelineResult {
  result: AnalysisResult;
  cached: boolean;
}

/** A short fingerprint of everything besides HEAD and window that changes the result. */
export function settingsKey(settings: AnalysisSettings): string {
  const normal = {
    v: SCORING_VERSION,
    exclude: [...settings.exclude].sort(),
    maxFiles: settings.maxFiles,
    fixKeywords: settings.fixKeywords,
    maxBytes: settings.maxBytes ?? DEFAULT_MAX_BYTES,
    minLoc: settings.minLoc ?? DEFAULT_MIN_LOC,
    rank: settings.rank ?? 'code',
  };
  return createHash('sha1').update(JSON.stringify(normal)).digest('hex').slice(0, 16);
}

/**
 * Build the analysis for one window: a cache hit returns at once; otherwise commits
 * → files → score → trend → cache.
 */
export async function runAnalysis(deps: PipelineDeps, opts: RunOptions): Promise<PipelineResult> {
  const start = performance.now();
  const now = deps.now ?? Date.now;
  const run = deps.run ?? defaultRunGit;
  const { window, signal, onProgress } = opts;
  const key = settingsKey(deps.settings);
  const cache = new AnalysisCache(deps.storageDir);
  const elapsed = (from: number): number => Math.round(performance.now() - from);

  const fromCache = (hit: AnalysisResult): PipelineResult => ({
    result: {
      ...hit,
      rank: deps.settings.rank ?? 'code',
      timings: { ...hit.timings, cache: elapsed(start) },
    },
    cached: true,
  });

  // 1. Cache, keyed by root + HEAD read from .git without starting git.
  if (!opts.force) {
    const disk = await (deps.readHead ?? readRepoHead)(deps.cwd);
    if (disk) {
      const hit = await cache.read(disk.repoRoot, window, disk.head, key);
      if (hit) return fromCache(hit);
    }
  }

  // 2. Git: root, HEAD, shallow. A cache hit here still skips the analysis.
  onProgress?.('Reading repository…');
  const git =
    typeof deps.gitPath === 'string'
      ? { gitPath: deps.gitPath, version: '' }
      : await deps.gitPath();
  const info = await getGitInfo(git.gitPath, deps.cwd, deps.hooksDir, {
    version: git.version,
    run,
    signal,
  });
  if (!opts.force) {
    const hit = await cache.read(info.repoRoot, window, info.head, key);
    if (hit) return fromCache(hit);
  }

  const timings: Record<string, number> = {};
  const nowSeconds = Math.floor(now() / 1000);
  const windowStart = nowSeconds - window * 86_400;

  // 3. Commits in the window.
  let t = performance.now();
  onProgress?.(`Reading ${String(window)} days of history…`);
  const commits = await readCommits(
    git.gitPath,
    info.repoRoot,
    deps.hooksDir,
    { window, since: new Date(windowStart * 1000), signal },
    run,
  );
  timings.commits = elapsed(t);

  // 4. Files in the current tree.
  t = performance.now();
  const tree: TreeOptions = {
    exclude: deps.settings.exclude,
    maxFiles: deps.settings.maxFiles,
    maxBytes: deps.settings.maxBytes ?? DEFAULT_MAX_BYTES,
    minLoc: deps.settings.minLoc ?? DEFAULT_MIN_LOC,
  };
  const tracked = await listTrackedFiles(git.gitPath, info.repoRoot, deps.hooksDir, signal, run);
  const selection = selectFiles(tracked, tree);
  onProgress?.(`Measuring ${String(selection.selected.length)} files…`);
  const stats = await (deps.measure ?? measureFiles)(info.repoRoot, selection.selected, tree, {
    pool: deps.pool,
    signal,
    logger: deps.logger,
  });
  timings.files = elapsed(t);

  // 5. Score and rank.
  t = performance.now();
  const fixKeywords = compileFixKeywords(deps.settings.fixKeywords, deps.logger);
  const files = withBands(
    scoreFiles(
      aggregate(commits, stats, {
        windowStart,
        now: nowSeconds,
        fixKeywords,
        minLoc: tree.minLoc,
        rank: deps.settings.rank ?? 'code',
      }),
    ),
  );
  const ranked = rank(files, window);
  timings.score = elapsed(t);

  // 6. Complexity trend for the top 20.
  t = performance.now();
  onProgress?.('Comparing with the window start…');
  const top = await computeTrends(ranked, {
    gitPath: git.gitPath,
    repoRoot: info.repoRoot,
    hooksDir: deps.hooksDir,
    windowStart,
    shallow: info.shallow,
    signal,
    run,
    maxBytes: tree.maxBytes,
  });
  timings.trend = elapsed(t);
  timings.total = elapsed(start);

  const result: AnalysisResult = {
    version: ANALYSIS_VERSION,
    repoRoot: info.repoRoot,
    head: info.head,
    window,
    generatedAt: new Date(now()).toISOString(),
    shallow: info.shallow,
    commitCount: commits.length,
    files,
    top,
    excludedCount: selection.excludedCount,
    capped: selection.capped,
    settingsKey: key,
    timings,
    subjects: recentSubjects(commits, subjectPaths(files)),
    rank: deps.settings.rank ?? 'code',
  };

  // 7. Cache. A failed write costs the next re-open a rebuild, nothing more.
  try {
    await cache.write(result);
  } catch (err) {
    deps.logger.warn(
      `Could not write the analysis cache: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { result, cached: false };
}
