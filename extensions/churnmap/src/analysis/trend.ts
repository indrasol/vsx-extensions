import { runGit as defaultRunGit, type RunGit } from './gitProcess.js';
import { measureText } from './measure.js';
import { DEFAULT_MAX_BYTES, type Hotspot, type Trend } from './model.js';

/** A change in complexity beyond ±10 % is a trend. */
export const TREND_THRESHOLD = 0.1;

export interface TrendOptions {
  gitPath: string;
  repoRoot: string;
  hooksDir: string;
  /** Unix seconds. */
  windowStart: number;
  shallow: boolean;
  signal?: AbortSignal | undefined;
  run?: RunGit;
  maxBytes?: number;
}

/** Compares complexity now and then: rising / falling beyond ±10 %, else flat. */
export function classifyTrend(then: number, now: number): Trend {
  if (then === 0) return now > 0 ? 'rising' : 'flat';
  const delta = (now - then) / then;
  if (delta > TREND_THRESHOLD) return 'rising';
  if (delta < -TREND_THRESHOLD) return 'falling';
  return 'flat';
}

/** A repository-relative path that is safe to put after `<sha>:` in a git argument. */
export function isSafeRepoPath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.startsWith('-') &&
    !/[\0\n\r]/.test(path) &&
    !path.split('/').includes('..')
  );
}

/**
 * The newest commit before the window start, or undefined when history does not reach that far
 * (a young repository, or a shallow clone cut off inside the window).
 */
export async function baseCommit(opts: TrendOptions): Promise<string | undefined> {
  const run = opts.run ?? defaultRunGit;
  const before = new Date(opts.windowStart * 1000).toISOString();
  const { stdout } = await run(
    opts.gitPath,
    ['rev-list', '-1', `--before=${before}`, 'HEAD', '--'],
    {
      cwd: opts.repoRoot,
      hooksDir: opts.hooksDir,
      signal: opts.signal,
    },
  );
  const sha = stdout.toString('utf8').trim();
  return /^[0-9a-f]{40,64}$/.test(sha) ? sha : undefined;
}

/**
 * Sets `trend` on each hotspot (top 20 only, sequential, at most 2 git calls per file). A file
 * that did not exist at the window start, or is over the size cap then, stays `unknown`.
 */
export async function computeTrends(
  hotspots: readonly Hotspot[],
  opts: TrendOptions,
): Promise<Hotspot[]> {
  const run = opts.run ?? defaultRunGit;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const unknown = hotspots.map((h): Hotspot => ({ ...h, trend: 'unknown' }));
  if (hotspots.length === 0) return unknown;

  const base = await baseCommit(opts);
  if (!base) return unknown; // includes a shallow clone whose history stops inside the window

  const git = { cwd: opts.repoRoot, hooksDir: opts.hooksDir, signal: opts.signal };
  const out: Hotspot[] = [];
  for (const hotspot of hotspots.slice(0, 20)) {
    const path = hotspot.file.path;
    let trend: Trend = 'unknown';
    if (isSafeRepoPath(path)) {
      try {
        const object = `${base}:${path}`;
        const size = Number.parseInt(
          (await run(opts.gitPath, ['cat-file', '-s', object, '--'], git)).stdout.toString('utf8'),
          10,
        );
        if (Number.isFinite(size) && size <= maxBytes) {
          const { stdout } = await run(
            opts.gitPath,
            ['show', '--no-textconv', '--no-ext-diff', '--no-color', object, '--'],
            git,
          );
          trend = classifyTrend(
            measureText(stdout.toString('utf8')).complexity,
            hotspot.file.complexity,
          );
        }
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        trend = 'unknown'; // missing at the base commit (new or renamed file)
      }
    }
    out.push({ ...hotspot, trend });
  }
  return out;
}
