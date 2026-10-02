import { describe, expect, it } from 'vitest';
import type { CommitRecord, FileScore, FileStat } from '../../../src/analysis/model.js';
import {
  aggregate,
  compileFixKeywords,
  DEFAULT_FIX_KEYWORDS,
  percentileRanks,
  rank,
  reasons,
  scoreFiles,
  weekCount,
  weekIndex,
  WEIGHTS,
  whyNotRanked,
} from '../../../src/analysis/score.js';

const NOW = 1_790_000_000;
const DAY = 86_400;
const OPTS = {
  windowStart: NOW - 90 * DAY,
  now: NOW,
  fixKeywords: compileFixKeywords(DEFAULT_FIX_KEYWORDS),
};

function stat(path: string, loc = 100, extra: Partial<FileStat> = {}): FileStat {
  return { path, bytes: loc * 30, loc, maxDepth: 2, meanDepth: 1, complexity: 1.6, ...extra };
}

let seq = 0;
function commit(
  daysAgo: number,
  files: CommitRecord['files'],
  extra: Partial<CommitRecord> = {},
): CommitRecord {
  seq += 1;
  return {
    sha: seq.toString(16).padStart(40, '0'),
    authorName: 'Ann',
    authorEmail: 'ann@example.com',
    timestamp: NOW - daysAgo * DAY,
    subject: 'change',
    files,
    ...extra,
  };
}

const change = (
  path: string,
  added = 1,
  deleted = 0,
  renamedFrom?: string,
): CommitRecord['files'][number] =>
  renamedFrom === undefined
    ? { path, added, deleted, binary: false }
    : { path, added, deleted, binary: false, renamedFrom };

describe('scoring constants', () => {
  it('weights are 0.30 / 0.25 / 0.25 / 0.10 / 0.10 and sum to 1', () => {
    // specs/churnmap.md §9 table (lines 166–170).
    expect(WEIGHTS).toEqual({
      relChurn: 0.3,
      frequency: 0.25,
      complexity: 0.25,
      authors: 0.1,
      fixRatio: 0.1,
    });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('percentileRanks', () => {
  it('is rank / (n − 1)', () => {
    expect(percentileRanks([10, 30, 20])).toEqual([0, 1, 0.5]);
  });

  it('averages ties', () => {
    // sorted 1,2,2,3 → ranks 0, 1.5, 1.5, 3 → /3
    expect(percentileRanks([2, 1, 3, 2])).toEqual([0.5, 0, 1, 0.5]);
  });

  it('gives a single file 1.0 and nothing for none', () => {
    expect(percentileRanks([7])).toEqual([1]);
    expect(percentileRanks([])).toEqual([]);
  });
});

describe('weekly commits', () => {
  it('has 5, 13 and 53 weeks for the 30, 90 and 365 day windows', () => {
    expect(weekCount(NOW - 30 * DAY, NOW)).toBe(5);
    expect(weekCount(NOW - 90 * DAY, NOW)).toBe(13);
    expect(weekCount(NOW - 365 * DAY, NOW)).toBe(53);
    expect(weekCount(NOW, NOW)).toBe(1);
  });

  it('buckets at the window edges: the start is week 0, now (or a skewed later clock) the last', () => {
    const start = NOW - 90 * DAY;
    expect(weekIndex(start, start, 13)).toBe(0);
    expect(weekIndex(start + 7 * DAY - 1, start, 13)).toBe(0);
    expect(weekIndex(start + 7 * DAY, start, 13)).toBe(1);
    expect(weekIndex(NOW, start, 13)).toBe(12);
    expect(weekIndex(NOW + 10 * DAY, start, 13)).toBe(12);
    expect(weekIndex(start - 1, start, 13)).toBe(0);
    // 28 days is exactly 4 weeks: "now" still lands in the last one.
    expect(weekIndex(NOW, NOW - 28 * DAY, weekCount(NOW - 28 * DAY, NOW))).toBe(3);
  });

  it('counts each commit once per file, oldest week first, summing to the commit count', () => {
    const files = aggregate(
      [
        commit(90, [change('a.ts')]), // exactly at the window start
        commit(89, [change('a.ts'), change('a.ts', 3)]), // twice in one commit: one commit
        commit(40, [change('a.ts')]),
        commit(0, [change('a.ts'), change('b.ts')]), // exactly now
        commit(91, [change('a.ts')]), // outside the window
      ],
      [stat('a.ts'), stat('b.ts'), stat('c.ts')],
      OPTS,
    );
    const [a, b, c] = files;
    expect(a?.weekly).toHaveLength(13);
    expect(a?.weekly[0]).toBe(2);
    expect(a?.weekly[7]).toBe(1);
    expect(a?.weekly[12]).toBe(1);
    expect(a?.weekly.reduce((x, y) => x + y, 0)).toBe(a?.commits);
    expect(b?.weekly).toEqual([...new Array<number>(12).fill(0), 1]);
    expect(c?.weekly).toEqual([]);
  });

  it('follows renames into the current path', () => {
    const files = aggregate(
      [commit(80, [change('old.ts')]), commit(10, [change('new.ts', 1, 0, 'old.ts')])],
      [stat('new.ts')],
      OPTS,
    );
    expect(files[0]?.weekly.reduce((x, y) => x + y, 0)).toBe(2);
  });
});

describe('why a file is not ranked', () => {
  it('excluded, then small, then too few commits', () => {
    expect(whyNotRanked(stat('a', 100, { skipped: 'binary' }), 9, 20)).toBe('excluded');
    expect(whyNotRanked(stat('a', 10), 9, 20)).toBe('small');
    expect(whyNotRanked(stat('a', 100), 1, 20)).toBe('few-commits');
    expect(whyNotRanked(stat('a', 100), 2, 20)).toBeUndefined();
  });

  it('is set on ineligible files only', () => {
    const files = aggregate(
      [commit(3, [change('a.ts'), change('b.ts')]), commit(2, [change('a.ts')])],
      [stat('a.ts'), stat('b.ts'), stat('tiny.ts', 5)],
      OPTS,
    );
    expect(files.map((f) => f.why)).toEqual([undefined, 'few-commits', 'small']);
    expect(files.map((f) => f.eligible)).toEqual([true, false, false]);
  });
});

describe('rank: code (the default in the pipeline)', () => {
  it('not measured first, then the kind, then small, then too few commits', () => {
    const md = stat('NOTES.md', 100);
    expect(whyNotRanked(stat('a.png', 100, { skipped: 'binary' }), 9, 20, 'code')).toBe('excluded');
    expect(whyNotRanked(md, 1, 20, 'code')).toBe('docs');
    expect(whyNotRanked(stat('tiny.md', 5), 9, 20, 'code')).toBe('docs');
    expect(whyNotRanked(stat('package.json'), 9, 20, 'code')).toBe('data');
    expect(whyNotRanked(stat('Dockerfile'), 9, 20, 'code')).toBe('config');
    expect(whyNotRanked(stat('dist/app.js'), 9, 20, 'code')).toBe('generated');
    expect(whyNotRanked(stat('src/tiny.ts', 5), 9, 20, 'code')).toBe('small');
    expect(whyNotRanked(stat('src/a.ts'), 1, 20, 'code')).toBe('few-commits');
    expect(whyNotRanked(stat('src/a.ts'), 2, 20, 'code')).toBeUndefined();
    // rank: all (and the pure default) keeps the earlier behaviour.
    expect(whyNotRanked(md, 9, 20, 'all')).toBeUndefined();
    expect(whyNotRanked(md, 9, 20)).toBeUndefined();
  });

  // A notes file edited in every commit, with far more churn than any code file.
  const history = [
    commit(60, [change('NOTES.md', 400, 200), change('src/api/handler.ts', 30, 5)]),
    commit(40, [change('NOTES.md', 300, 250), change('src/core/engine.ts', 20, 10)]),
    commit(30, [change('NOTES.md', 250, 100), change('src/api/handler.ts', 40, 10)]),
    commit(20, [change('NOTES.md', 280, 200), change('src/core/engine.ts', 50, 20)]),
    commit(10, [change('NOTES.md', 320, 300), change('src/util/format.ts', 10, 2)]),
    commit(5, [change('NOTES.md', 200, 150), change('src/core/engine.ts', 35, 15)]),
    commit(1, [change('NOTES.md', 180, 120), change('src/util/format.ts', 8, 1)]),
  ];
  const tree = [
    stat('NOTES.md', 120, { maxDepth: 3, complexity: 2 }),
    stat('src/api/handler.ts', 90),
    stat('src/core/engine.ts', 110, { maxDepth: 4, complexity: 3.2 }),
    stat('src/util/format.ts', 60),
  ];

  it('never ranks the .md with the most churn; a code file is #1', () => {
    const files = scoreFiles(aggregate(history, tree, { ...OPTS, rank: 'code' }));
    const notes = files.find((f) => f.path === 'NOTES.md');
    expect(notes?.churn).toBe(Math.max(...files.map((f) => f.churn)));
    expect(notes?.eligible).toBe(false);
    expect(notes?.why).toBe('docs');
    expect(notes?.score).toBe(0);
    const top = rank(files, 90);
    expect(top.map((h) => h.file.path)).toEqual([
      'src/core/engine.ts',
      'src/api/handler.ts',
      'src/util/format.ts',
    ]);
    // Percentiles are among code files only: the #1 code file tops every component it leads.
    expect(top[0]?.file.percentiles.frequency).toBe(1);
  });

  it('with rank: all the same history ranks the notes file #1 (the old behaviour)', () => {
    const files = scoreFiles(aggregate(history, tree, { ...OPTS, rank: 'all' }));
    expect(rank(files, 90)[0]?.file.path).toBe('NOTES.md');
  });
});

describe('aggregate', () => {
  it('computes commits, churn, relative churn (capped at 5), recency, authors and fix ratio', () => {
    const files = aggregate(
      [
        commit(0, [change('a.ts', 300, 200)], { subject: 'fix: crash' }),
        commit(45, [change('a.ts', 10, 0)], { authorName: 'Bo', authorEmail: 'BO@example.com' }),
        commit(45, [change('a.ts', 0, 5)], { authorName: 'Bo', authorEmail: 'bo@example.com' }),
      ],
      [stat('a.ts', 100)],
      OPTS,
    );
    const a = files[0];
    expect(a).toMatchObject({ commits: 3, churn: 515, relChurn: 5, authors: 2, eligible: true });
    // e^0 + 2·e^(−1)
    expect(a?.frequency).toBeCloseTo(1 + 2 * Math.exp(-1), 10);
    expect(a?.fixRatio).toBeCloseTo(1 / 3, 10);
    expect(a?.owners).toEqual(['Bo', 'Ann']);
  });

  it('ignores commits before the window start and files no longer in the tree', () => {
    const files = aggregate(
      [
        commit(100, [change('a.ts', 50, 0)]),
        commit(1, [change('gone.ts', 5, 0), change('a.ts', 1, 0)]),
      ],
      [stat('a.ts')],
      OPTS,
    );
    expect(files.map((f) => [f.path, f.commits, f.churn])).toEqual([['a.ts', 1, 1]]);
  });

  it('folds renamed history into the current path, through a chain of renames', () => {
    const files = aggregate(
      [
        commit(1, [change('c.ts', 1, 0, 'b.ts')]),
        commit(2, [change('b.ts', 2, 0)]),
        commit(3, [change('b.ts', 3, 0, 'a.ts')]),
        commit(4, [change('a.ts', 4, 0)]),
      ],
      [stat('c.ts')],
      OPTS,
    );
    expect(files[0]).toMatchObject({ path: 'c.ts', commits: 4, churn: 10 });
  });

  it('does not fold into a new file that reuses an old name after the rename', () => {
    const files = aggregate(
      [
        commit(1, [change('old.ts', 7, 0)]), // a new file named old.ts, after the rename
        commit(2, [change('new.ts', 0, 0, 'old.ts')]),
        commit(3, [change('old.ts', 5, 0)]),
      ],
      [stat('old.ts'), stat('new.ts')],
      OPTS,
    );
    expect(files.map((f) => [f.path, f.commits, f.churn])).toEqual([
      ['old.ts', 1, 7],
      ['new.ts', 2, 5],
    ]);
  });

  it('marks eligibility: ≥ 2 commits, ≥ 20 LOC, not skipped', () => {
    const twice = (p: string): CommitRecord[] => [commit(1, [change(p)]), commit(2, [change(p)])];
    const files = aggregate(
      [
        ...twice('ok.ts'),
        ...twice('small.ts'),
        ...twice('bin.png'),
        commit(1, [change('cold.ts')]),
      ],
      [
        stat('ok.ts', 20),
        stat('small.ts', 19),
        stat('bin.png', 0, { skipped: 'binary' }),
        stat('cold.ts', 100),
      ],
      OPTS,
    );
    expect(files.map((f) => f.eligible)).toEqual([true, false, false, false]);
  });

  it('counts a file once per commit and falls back to the name when there is no email', () => {
    const files = aggregate(
      [commit(1, [change('a.ts', 1, 0), change('a.ts', 2, 0)], { authorEmail: '' })],
      [stat('a.ts')],
      OPTS,
    );
    expect(files[0]).toMatchObject({ commits: 1, churn: 3, authors: 1 });
  });
});

describe('compileFixKeywords', () => {
  it('is case-insensitive and word-bounded by default', () => {
    const re = compileFixKeywords(undefined);
    expect(re.test('FIX: crash')).toBe(true);
    expect(re.test('Revert "x"')).toBe(true);
    expect(re.test('prefix the ids')).toBe(false);
  });

  it('falls back to the default and logs for an invalid pattern', () => {
    const warnings: string[] = [];
    const re = compileFixKeywords('(unclosed', {
      info: () => undefined,
      warn: (m) => warnings.push(m),
    });
    expect(re.source).toBe(DEFAULT_FIX_KEYWORDS);
    expect(warnings).toHaveLength(1);
  });

  it('uses a custom pattern', () => {
    expect(compileFixKeywords('JIRA-\\d+').test('jira-12 things')).toBe(true);
    expect(compileFixKeywords('   ').source).toBe(DEFAULT_FIX_KEYWORDS);
  });
});

function scored(overrides: Partial<FileScore> & { path: string }): FileScore {
  return {
    loc: 100,
    commits: 5,
    churn: 0,
    relChurn: 0,
    frequency: 0,
    complexity: 0,
    maxDepth: 0,
    authors: 1,
    fixRatio: 0,
    percentiles: { relChurn: 0, frequency: 0, complexity: 0, authors: 0, fixRatio: 0 },
    score: 0,
    eligible: true,
    owners: [],
    weekly: [],
    ...overrides,
  };
}

describe('scoreFiles', () => {
  it('ranks among eligible files only and scales the weighted sum to 0–100', () => {
    const [hot, cold, off] = scoreFiles([
      scored({ path: 'hot', relChurn: 2, frequency: 3, complexity: 4, authors: 3, fixRatio: 0.5 }),
      scored({ path: 'cold', relChurn: 1, frequency: 1, complexity: 1, authors: 1, fixRatio: 0 }),
      scored({
        path: 'off',
        relChurn: 99,
        frequency: 99,
        complexity: 99,
        authors: 99,
        fixRatio: 1,
        eligible: false,
      }),
    ]);
    expect(hot?.score).toBe(100);
    expect(cold?.score).toBe(0);
    expect(off?.score).toBe(0);
    expect(off?.percentiles).toEqual({
      relChurn: 0,
      frequency: 0,
      complexity: 0,
      authors: 0,
      fixRatio: 0,
    });
  });

  it('rounds the score to one decimal', () => {
    const files = scoreFiles([
      scored({ path: 'a', relChurn: 3 }),
      scored({ path: 'b', relChurn: 2 }),
      scored({ path: 'c', relChurn: 1 }),
    ]);
    // b: relChurn percentile 0.5, other components tied at 0.5 → 100 × 0.5 = 50
    // a: 100 × (0.3·1 + 0.7·0.5) = 65
    expect(files.map((f) => f.score)).toEqual([65, 50, 35]);
  });
});

describe('reasons', () => {
  const file = scored({
    path: 'x',
    commits: 41,
    churn: 324,
    relChurn: 3.24,
    maxDepth: 9,
    authors: 6,
    fixRatio: 0.38,
    percentiles: { relChurn: 0.2, frequency: 0.98, complexity: 0.95, authors: 0.6, fixRatio: 0.1 },
  });

  it('words the top components as sentences with their numbers, a third when it is at least 0.5', () => {
    expect(reasons(file, 90).map((r) => [r.text, r.detail])).toEqual([
      ['Changed 41 times in 90 days', 'more often than 98% of files'],
      ['Deeply nested code (depth 9)', 'deeper than 95% of files'],
      ['6 people edited it', 'more than 60% of files'],
    ]);
  });

  it('keeps two when the third is below 0.5', () => {
    const two = { ...file, percentiles: { ...file.percentiles, authors: 0.49 } };
    expect(reasons(two, 30).map((r) => r.component)).toEqual(['frequency', 'complexity']);
  });

  it('words churn and fix ratio, and "more than 99%" at the very top (never "top N%")', () => {
    const f = {
      ...file,
      percentiles: { relChurn: 1, frequency: 0, complexity: 0, authors: 0, fixRatio: 0.9 },
    };
    expect(reasons(f, 365).map((r) => [r.text, r.detail])).toEqual([
      ['Rewritten about 3× in 365 days', '~320 lines added or removed vs 100 lines today'],
      ['38% of changes were bug fixes', '16 of 41 changes'],
    ]);
    const one = {
      ...f,
      authors: 1,
      percentiles: { ...f.percentiles, authors: 0.95, frequency: 1 },
    };
    expect(reasons(one, 30).map((r) => [r.text, r.detail])).toEqual([
      ['Rewritten about 3× in 30 days', '~320 lines added or removed vs 100 lines today'],
      ['Changed 41 times in 30 days', 'more often than 99% of files'],
      ['Only 1 person edited it', 'more than 95% of files'],
    ]);
  });
});

describe('rank', () => {
  it('orders by score, then commits, then path, keeps eligible files only, and caps at 20', () => {
    const files = [
      scored({ path: 'b', score: 50, commits: 3 }),
      scored({ path: 'a', score: 50, commits: 3 }),
      scored({ path: 'c', score: 50, commits: 9 }),
      scored({ path: 'd', score: 90 }),
      scored({ path: 'e', score: 99, eligible: false }),
      ...Array.from({ length: 30 }, (_, i) =>
        scored({ path: `z${String(i).padStart(2, '0')}`, score: 1 }),
      ),
    ];
    const top = rank(files, 90);
    expect(top).toHaveLength(20);
    expect(top.slice(0, 4).map((h) => [h.rank, h.file.path])).toEqual([
      [1, 'd'],
      [2, 'c'],
      [3, 'a'],
      [4, 'b'],
    ]);
    expect(top.every((h) => h.reasons.length >= 2 && h.trend === 'unknown')).toBe(true);
  });

  it('skips ignored paths so the next-best files fill the 20 slots, deterministically', () => {
    const files = Array.from({ length: 25 }, (_, i) =>
      scored({ path: `f${String(i).padStart(2, '0')}`, score: 100 - i }),
    );
    const ignored = new Set(['f00', 'f03', 'not-a-file']);
    const top = rank(files, 90, ignored);
    expect(top).toHaveLength(20);
    expect(top.map((h) => h.file.path)).not.toContain('f00');
    expect(top.map((h) => h.file.path)).not.toContain('f03');
    expect(top.slice(0, 3).map((h) => [h.rank, h.file.path])).toEqual([
      [1, 'f01'],
      [2, 'f02'],
      [3, 'f04'],
    ]);
    expect(top.at(-1)?.file.path).toBe('f21');
    expect(rank([...files].reverse(), 90, ignored)).toEqual(top);
    expect(rank(files, 90, new Set())).toEqual(rank(files, 90));
  });
});
