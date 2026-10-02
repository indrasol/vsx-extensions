import type { Band, FileScore, Hotspot, Trend } from '../../../src/analysis/model.js';

/** A hotspot with sensible defaults; override what a test cares about. */
export function hotspot(
  rank: number,
  path: string,
  opts: {
    score?: number;
    trend?: Trend;
    owners?: string[];
    reasons?: string[];
    band?: Band;
  } = {},
): Hotspot {
  const file: FileScore = {
    path,
    loc: 1234,
    commits: 41,
    churn: 900,
    relChurn: 2.1,
    frequency: 10,
    complexity: 3,
    maxDepth: 6,
    authors: 3,
    fixRatio: 0.2,
    percentiles: { relChurn: 0.9, frequency: 0.98, complexity: 0.8, authors: 0.5, fixRatio: 0.4 },
    score: opts.score ?? 82.4,
    eligible: true,
    owners: opts.owners ?? ['alice', 'bob'],
    weekly: [],
    position: rank,
    band: opts.band ?? 'hotspot',
    heat: 95,
  };
  const texts = opts.reasons ?? ['Changed 41 times in 90 days', 'Rewritten about 2× in 90 days'];
  const details = [
    'more often than 98% of files',
    '~900 lines added or removed vs 1,234 lines today',
  ];
  return {
    rank,
    file,
    reasons: texts.map((text, i) => ({
      component: (['frequency', 'relChurn', 'complexity'] as const)[i] ?? 'authors',
      text,
      detail: details[i] ?? 'more than 90% of files',
      percentile: 0.9,
    })),
    trend: opts.trend ?? 'rising',
  };
}
