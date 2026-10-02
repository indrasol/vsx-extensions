import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnalysisCache } from '../../../src/analysis/cache.js';
import { GitError } from '../../../src/analysis/gitProcess.js';
import type { CommitRecord, FileStat, Hotspot } from '../../../src/analysis/model.js';
import { type PipelineDeps, runAnalysis, settingsKey } from '../../../src/analysis/pipeline.js';
import { fakeGit, formatLog, shuffled } from './helpers.js';

const GOLDEN = join(__dirname, '../../fixtures/golden');
const load = (name: string): unknown => JSON.parse(readFileSync(join(GOLDEN, name), 'utf8'));

const commits = load('commits.json') as CommitRecord[];
const stats = load('stats.json') as FileStat[];
const expectedTop = load('top.json') as unknown[];

/** Fixed clock: every golden timestamp is `NOW − age_days × 86 400`. */
const NOW = 1_790_000_000;
const HEAD = 'c'.repeat(40);
/** `rank: 'all'`: the golden ranking predates code-only ranking and must not change under it. */
const SETTINGS = {
  exclude: [],
  maxFiles: 20_000,
  fixKeywords: '\\b(fix|bug|hotfix|regress|revert)\\b',
  rank: 'all' as const,
};

/** The parts of a hotspot that top.json spells out. */
function project(top: readonly Hotspot[]): unknown[] {
  return top.map((h) => ({
    rank: h.rank,
    path: h.file.path,
    score: h.file.score,
    commits: h.file.commits,
    authors: h.file.authors,
    relChurn: h.file.relChurn,
    frequency: h.file.frequency,
    fixRatio: h.file.fixRatio,
    owners: h.file.owners,
    band: h.file.band,
    reasons: h.reasons.map((r) => `${r.text} (${r.detail})`),
    trend: h.trend,
  }));
}

function goldenDeps(
  storageDir: string,
  input: { commits: CommitRecord[]; stats: FileStat[] },
  head = HEAD,
): { deps: PipelineDeps; calls: string[][] } {
  const git = fakeGit([
    ['rev-parse --show-toplevel', '/work/golden\n'],
    ['rev-parse --verify --quiet HEAD', `${head}\n`],
    ['rev-parse --is-shallow-repository', 'false\n'],
    ['log', formatLog(input.commits)],
    ['ls-files', Buffer.from(input.stats.map((s) => `${s.path}\0`).join(''))],
    // No commit before the window start → every trend is "unknown".
    ['rev-list', ''],
  ]);
  const byPath = new Map(input.stats.map((s) => [s.path, s]));
  return {
    calls: git.calls,
    deps: {
      gitPath: '/usr/bin/git',
      hooksDir: '/hooks',
      storageDir,
      cwd: '/work/golden',
      settings: SETTINGS,
      logger: { info: () => undefined, warn: () => undefined },
      run: git.run,
      measure: (_root, paths) =>
        Promise.resolve(
          paths.map(
            (p) =>
              byPath.get(p) ?? {
                path: p,
                bytes: 0,
                loc: 0,
                maxDepth: 0,
                meanDepth: 0,
                complexity: 0,
                skipped: 'unreadable' as const,
              },
          ),
        ),
      readHead: () => Promise.resolve(undefined),
      now: () => NOW * 1000,
    },
  };
}

describe('runAnalysis on the golden fixture', () => {
  let storage: string;

  beforeEach(() => {
    storage = mkdtempSync(join(tmpdir(), 'cm-golden-'));
  });

  afterEach(() => {
    rmSync(storage, { recursive: true, force: true });
  });

  /*
   * Why this ranking is obviously right (the scoring model; README: How scoring works):
   * five eligible files are strictly ordered invoice > tax > routes > table > theme on the three
   * heavy components (relative churn, recency-weighted frequency, complexity: weights 0.30 + 0.25
   * + 0.25 = 0.80), and in exactly the reverse order on author spread and fix ratio (0.10 + 0.10).
   * With n = 5 the percentiles are 1, .75, .5, .25, 0, so the scores are
   *   invoice 100·(0.8·1   + 0.2·0)   = 80    tax   100·(0.8·.75 + 0.2·.25) = 65
   *   routes  100·(0.8·.5  + 0.2·.5)  = 50    table 100·(0.8·.25 + 0.2·.75) = 35
   *   theme   100·(0.8·0   + 0.2·1)   = 20
   * The other three files never rank: docs/setup.md has one commit (< 2), src/config.ts has 12
   * LOC (< 20), media/logo.png is binary. tax.ts inherits the commit made on its old name
   * (src/legacy/tax_old.ts). invoice.ts churned 700 lines on 100 LOC, capped at 5×. The 120-day-
   * old "fix" commit is outside the window, so invoice's fix ratio stays 0; the merge adds nothing.
   */
  it('matches top.json', async () => {
    const { deps } = goldenDeps(storage, { commits, stats });
    const { result, cached } = await runAnalysis(deps, { window: 90 });
    expect(cached).toBe(false);
    // UPDATE_GOLDEN=1 rewrites top.json from this run (then review the diff).
    if (process.env.UPDATE_GOLDEN === '1') {
      writeFileSync(join(GOLDEN, 'top.json'), `${JSON.stringify(project(result.top), null, 2)}\n`);
    }
    expect(project(result.top)).toEqual(expectedTop);
    expect(result.commitCount).toBe(29); // 30 minus the one before the window
    expect(result.files).toHaveLength(8);
    expect(
      result.files
        .filter((f) => f.eligible)
        .map((f) => f.path)
        .sort(),
    ).toEqual([
      'src/api/routes.ts',
      'src/billing/invoice.ts',
      'src/billing/tax.ts',
      'src/ui/table.tsx',
      'src/ui/theme.ts',
    ]);
    expect(result.top.every((h) => h.reasons.length >= 2)).toBe(true);
    expect(result).toMatchObject({
      version: 4,
      repoRoot: '/work/golden',
      head: HEAD,
      window: 90,
      shallow: false,
      capped: false,
    });
    expect(Object.keys(result.timings).sort()).toEqual([
      'commits',
      'files',
      'score',
      'total',
      'trend',
    ]);
  });

  it('ranks the same five code files with rank: code; the docs file is marked docs', async () => {
    const { deps } = goldenDeps(storage, { commits, stats });
    const { result } = await runAnalysis(
      { ...deps, settings: { ...SETTINGS, rank: 'code' } },
      { window: 90 },
    );
    expect(project(result.top)).toEqual(expectedTop);
    expect(result.files.find((f) => f.path === 'docs/setup.md')?.why).toBe('docs');
    expect(result.files.find((f) => f.path === 'media/logo.png')?.why).toBe('excluded');
  });

  it('is deterministic: two runs with shuffled commits and files give the same ranking', async () => {
    const runs = await Promise.all(
      [11, 29].map(async (seed) => {
        const dir = mkdtempSync(join(tmpdir(), 'cm-golden-shuffle-'));
        try {
          const { deps } = goldenDeps(dir, {
            commits: shuffled(commits, seed),
            stats: shuffled(stats, seed + 1),
          });
          return (await runAnalysis(deps, { window: 90 })).result;
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
    );
    expect(project(runs[0]?.top ?? [])).toEqual(expectedTop);
    expect(project(runs[1]?.top ?? [])).toEqual(expectedTop);
  });

  it('serves the second run from the cache in < 200 ms, and misses when HEAD changes', async () => {
    await runAnalysis(goldenDeps(storage, { commits, stats }).deps, { window: 90 });

    const again = goldenDeps(storage, { commits, stats });
    const start = performance.now();
    const hit = await runAnalysis(again.deps, { window: 90 });
    const ms = performance.now() - start;
    console.log(
      `      cached re-run: ${ms.toFixed(1)} ms (timings.cache ${String(hit.result.timings.cache)} ms)`,
    );
    expect(hit.cached).toBe(true);
    expect(ms).toBeLessThan(200);
    expect(hit.result.timings.cache).toBeTypeOf('number');
    expect(again.calls.some((c) => c[0] === 'log')).toBe(false); // no history read

    const moved = goldenDeps(storage, { commits, stats }, 'd'.repeat(40));
    expect((await runAnalysis(moved.deps, { window: 90 })).cached).toBe(false);
    expect(moved.calls.some((c) => c[0] === 'log')).toBe(true);
  });

  it('hits the cache from .git on disk without starting git at all', async () => {
    await runAnalysis(goldenDeps(storage, { commits, stats }).deps, { window: 90 });
    const { deps, calls } = goldenDeps(storage, { commits, stats });
    let resolved = false;
    const hit = await runAnalysis(
      {
        ...deps,
        gitPath: () => {
          resolved = true;
          return Promise.resolve({ gitPath: '/usr/bin/git', version: '2.50.1' });
        },
        readHead: () => Promise.resolve({ repoRoot: '/work/golden', head: HEAD }),
      },
      { window: 90 },
    );
    expect(hit.cached).toBe(true);
    expect(calls).toEqual([]);
    expect(resolved).toBe(false);
  });

  it('ignores the cache when forced, when settings change, or for another window', async () => {
    await runAnalysis(goldenDeps(storage, { commits, stats }).deps, { window: 90 });
    const base = goldenDeps(storage, { commits, stats }).deps;
    expect((await runAnalysis(base, { window: 90, force: true })).cached).toBe(false);
    const otherSettings = { ...base, settings: { ...SETTINGS, exclude: ['docs/**'] } };
    expect(settingsKey(otherSettings.settings)).not.toBe(settingsKey(SETTINGS));
    // The rank setting is part of the key; unset means code.
    expect(settingsKey({ ...SETTINGS, rank: 'code' })).not.toBe(settingsKey(SETTINGS));
    expect(settingsKey({ exclude: [], maxFiles: 20_000, fixKeywords: SETTINGS.fixKeywords })).toBe(
      settingsKey({ ...SETTINGS, rank: 'code' }),
    );
    expect((await runAnalysis(otherSettings, { window: 90 })).cached).toBe(false);
    expect((await runAnalysis(base, { window: 30 })).cached).toBe(false);
  });

  it('resolves a lazy git path, reports progress, and survives a failed cache write', async () => {
    const { deps } = goldenDeps(storage, { commits, stats });
    const warnings: string[] = [];
    const progress: string[] = [];
    const { result } = await runAnalysis(
      {
        ...deps,
        // A file where the cache folder should be: the write fails, the build does not.
        storageDir: join(GOLDEN, 'top.json'),
        gitPath: () => Promise.resolve({ gitPath: '/usr/bin/git', version: '2.50.1' }),
        logger: { info: () => undefined, warn: (m) => warnings.push(m) },
      },
      { window: 90, onProgress: (m) => progress.push(m) },
    );
    expect(result.top).toHaveLength(5);
    expect(warnings).toEqual([expect.stringContaining('Could not write the analysis cache')]);
    expect(progress[0]).toBe('Reading repository…');
    expect(progress).toContain('Measuring 8 files…');
  });

  it('passes typed git errors through', async () => {
    const { deps } = goldenDeps(storage, { commits, stats });
    await expect(
      runAnalysis(
        { ...deps, run: () => Promise.reject(new GitError('not-a-repository', 'not a repo')) },
        { window: 90 },
      ),
    ).rejects.toMatchObject({ kind: 'not-a-repository' });
  });

  it('writes a cache file keyed by root and window', async () => {
    await runAnalysis(goldenDeps(storage, { commits, stats }).deps, { window: 90 });
    const cached = await new AnalysisCache(storage).read('/work/golden', 90, HEAD);
    expect(cached?.top).toHaveLength(5);
  });
});
