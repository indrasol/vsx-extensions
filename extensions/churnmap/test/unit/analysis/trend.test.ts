import { describe, expect, it } from 'vitest';
import { GitError } from '../../../src/analysis/gitProcess.js';
import type { Hotspot } from '../../../src/analysis/model.js';
import { classifyTrend, computeTrends, isSafeRepoPath } from '../../../src/analysis/trend.js';
import { fakeGit } from './helpers.js';

const BASE = 'b'.repeat(40);

function hotspot(path: string, complexity: number): Hotspot {
  return {
    rank: 1,
    trend: 'unknown',
    reasons: [],
    file: {
      path,
      loc: 50,
      commits: 3,
      churn: 10,
      relChurn: 0.2,
      frequency: 1,
      complexity,
      maxDepth: 2,
      authors: 1,
      fixRatio: 0,
      percentiles: { relChurn: 1, frequency: 1, complexity: 1, authors: 1, fixRatio: 1 },
      score: 100,
      eligible: true,
      owners: [],
      weekly: [],
    },
  };
}

const OPTS = {
  gitPath: '/git',
  repoRoot: '/repo',
  hooksDir: '/hooks',
  windowStart: 1_780_000_000,
  shallow: false,
};

describe('classifyTrend', () => {
  it('uses a ±10 % band', () => {
    expect(classifyTrend(1, 1.11)).toBe('rising');
    // Exactly ±10 % is flat (10 → 11 and 10 → 9 are exact in binary floating point).
    expect(classifyTrend(10, 11)).toBe('flat');
    expect(classifyTrend(10, 9)).toBe('flat');
    expect(classifyTrend(1, 0.89)).toBe('falling');
    expect(classifyTrend(0, 0)).toBe('flat');
    expect(classifyTrend(0, 0.5)).toBe('rising');
  });
});

describe('isSafeRepoPath', () => {
  it('accepts repository-relative paths only', () => {
    expect(isSafeRepoPath('src/a b/ñ.ts')).toBe(true);
    for (const bad of ['', '/etc/passwd', '-x', 'a/../b', 'a\nb', 'a\0b'])
      expect(isSafeRepoPath(bad)).toBe(false);
  });
});

describe('computeTrends', () => {
  it('compares complexity at the window start with now, using -- after every object', async () => {
    const git = fakeGit([
      ['rev-list', `${BASE}\n`],
      ['cat-file -s', '40\n'],
      // Then: depths 0 1 → max 1, mean 0.5 → 0.8
      ['show', 'a\n  b\n'],
    ]);
    const out = await computeTrends(
      [hotspot('up.ts', 2), hotspot('same.ts', 0.85), hotspot('down.ts', 0.5)],
      {
        ...OPTS,
        run: git.run,
      },
    );
    expect(out.map((h) => h.trend)).toEqual(['rising', 'flat', 'falling']);
    expect(git.calls[0]).toEqual([
      'rev-list',
      '-1',
      `--before=${new Date(OPTS.windowStart * 1000).toISOString()}`,
      'HEAD',
      '--',
    ]);
    expect(git.calls[1]).toEqual(['cat-file', '-s', `${BASE}:up.ts`, '--']);
    expect(git.calls[2]).toEqual([
      'show',
      '--no-textconv',
      '--no-ext-diff',
      '--no-color',
      `${BASE}:up.ts`,
      '--',
    ]);
    expect(git.calls).toHaveLength(1 + 3 * 2);
  });

  it('is unknown for everything when history does not reach the window start', async () => {
    const git = fakeGit([['rev-list', '']]);
    const out = await computeTrends([hotspot('a.ts', 1)], { ...OPTS, shallow: true, run: git.run });
    expect(out.map((h) => h.trend)).toEqual(['unknown']);
    expect(git.calls).toHaveLength(1);
  });

  it('is unknown for a file missing at the base, too large, or with an unsafe path', async () => {
    const git = fakeGit([
      ['rev-list', BASE],
      ['cat-file -s ' + BASE + ':new.ts', new GitError('failed', 'missing')],
      ['cat-file -s ' + BASE + ':big.ts', String(2 * 1024 * 1024)],
    ]);
    const out = await computeTrends(
      [hotspot('new.ts', 1), hotspot('big.ts', 1), hotspot('-bad', 1)],
      {
        ...OPTS,
        run: git.run,
      },
    );
    expect(out.map((h) => h.trend)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(git.calls.some((c) => c[0] === 'show')).toBe(false);
  });

  it('does nothing for no hotspots, and rethrows when aborted', async () => {
    const git = fakeGit([]);
    expect(await computeTrends([], { ...OPTS, run: git.run })).toEqual([]);
    expect(git.calls).toHaveLength(0);

    const controller = new AbortController();
    const aborting = fakeGit([
      ['rev-list', BASE],
      [
        'cat-file',
        () => {
          controller.abort();
          return new GitError('aborted', 'cancelled');
        },
      ],
    ]);
    await expect(
      computeTrends([hotspot('a.ts', 1)], {
        ...OPTS,
        run: aborting.run,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});
