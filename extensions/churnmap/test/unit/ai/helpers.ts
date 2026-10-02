import type { AnalysisResult, FileScore } from '../../../src/analysis/model.js';
import { withBands } from '../../../src/analysis/bands.js';
import { rank } from '../../../src/analysis/score.js';

/** An eligible scored file with sensible defaults; override what a test cares about. */
export function fileScore(path: string, score: number, over: Partial<FileScore> = {}): FileScore {
  return {
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
    owners: ['Alice Example', 'Bob Example'],
    weekly: [1, 0, 3, 8],
    ...over,
  };
}

/** An analysis of `files` (banded), ranked for 90 days, every top file's trend `rising`. */
export function analysis(input: FileScore[], over: Partial<AnalysisResult> = {}): AnalysisResult {
  const files = withBands(input);
  return {
    version: 4,
    repoRoot: '/work/my-repo',
    head: 'a'.repeat(40),
    window: 90,
    generatedAt: '2026-09-30T00:00:00.000Z',
    shallow: false,
    commitCount: 50,
    files,
    top: rank(files, 90).map((h) => ({ ...h, trend: 'rising' as const })),
    excludedCount: 0,
    capped: false,
    settingsKey: 'k',
    timings: {},
    ...over,
  };
}
