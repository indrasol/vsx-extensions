import { describe, expect, it } from 'vitest';
import { MAX_NOTE_LENGTH, MAX_SENTENCE_LENGTH } from '../../../src/analysis/explain.js';
import type { AnalysisResult, FileScore } from '../../../src/analysis/model.js';
import { rank } from '../../../src/analysis/score.js';
import { layoutCity } from '../../../src/city/layout.js';
import { buildAnalysisMessage, displayRepoPath } from '../../../src/panel/analysisMessage.js';

const file = (path: string, score: number, over: Partial<FileScore> = {}): FileScore => ({
  path,
  loc: 120,
  commits: 12,
  churn: 300,
  relChurn: 2.5,
  frequency: 4,
  complexity: 3,
  maxDepth: 7,
  authors: 3,
  fixRatio: 0.25,
  percentiles: { relChurn: 0.8, frequency: 0.9, complexity: 0.7, authors: 0.4, fixRatio: 0.5 },
  score,
  eligible: true,
  owners: [],
  weekly: [1, 0, 3, 8],
  ...over,
});

function result(files: FileScore[]): AnalysisResult {
  return {
    version: 4,
    repoRoot: '/work/my-repo',
    head: 'a'.repeat(40),
    window: 90,
    generatedAt: '2026-09-30T00:00:00.000Z',
    shallow: false,
    commitCount: 50,
    files,
    top: rank(files, 90).slice(0, 2),
    excludedCount: 0,
    capped: false,
    settingsKey: 'k',
    timings: {},
  };
}

describe('buildAnalysisMessage', () => {
  const files = [
    file('src/a.ts', 95),
    file('src/b.ts', 80),
    file('src/c.ts', 45),
    file('src/d.ts', 12),
    file('src/e.ts', 0, { eligible: false, why: 'few-commits', commits: 1, weekly: [] }),
  ];
  const r = result(files);
  const message = buildAnalysisMessage(r, layoutCity(files), []);

  it('top entries carry weekly commits and plain sentences (≤ 3 × 120 characters)', () => {
    expect(message.top.map((t) => t.path)).toEqual(['src/a.ts', 'src/b.ts']);
    const first = message.top[0];
    expect(first?.weekly).toEqual([1, 0, 3, 8]);
    expect(first?.sentences.length).toBeGreaterThan(0);
    expect(first?.sentences.length).toBeLessThanOrEqual(3);
    for (const s of first?.sentences ?? []) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeLessThanOrEqual(MAX_SENTENCE_LENGTH);
    }
    expect(first?.sentences[0]).toMatch(/^Changed 12 times in 90 days$/);
    expect(first?.authors).toBe(3);
    expect(first?.trend).toBe('unknown');
  });

  it('eligible files outside the top list scoring ≥ 30 get 2 short notes; nothing else does', () => {
    expect(Object.keys(message.notes)).toEqual(['src/c.ts']);
    const notes = message.notes['src/c.ts'] ?? [];
    expect(notes).toHaveLength(2);
    for (const n of notes) expect(n.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
  });

  it('unranked files keep their why code (and commits) in the layout', () => {
    const e = message.layout.buildings.find((b) => b.path === 'src/e.ts');
    expect(e?.score).toBe(0);
    expect(message.repoName).toBe('my-repo');
    // Only numbers and short strings: the whole message is plain JSON.
    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
  });
});

describe('displayRepoPath', () => {
  it('shortens the home folder to ~ and long paths from the left', () => {
    expect(displayRepoPath('/Users/ana/code/app', '/Users/ana')).toBe('~/code/app');
    expect(displayRepoPath('/Users/anabel/app', '/Users/ana')).toBe('/Users/anabel/app');
    expect(displayRepoPath('C:\\Users\\ana\\app', 'C:\\Users\\ana')).toBe('~/app');
    const long = `/srv/${'x'.repeat(300)}/app`;
    const shown = displayRepoPath(long, '/home/ana');
    expect(shown.length).toBe(200);
    expect(shown.startsWith('…')).toBe(true);
    expect(shown.endsWith('/app')).toBe(true);
  });
});
