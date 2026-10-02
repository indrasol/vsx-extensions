import { compareRanked } from './bands.js';
import { classify, type RankMode } from './classify.js';
import { detail, sentence } from './explain.js';
import { compareCodeUnits } from './files.js';
import {
  type AnalysisLogger,
  type CommitRecord,
  type Component,
  COMPONENTS,
  DEFAULT_MIN_LOC,
  type FileScore,
  MIN_COMMITS,
  type FileStat,
  type Hotspot,
  type Reason,
  type WhyCode,
  type Window,
} from './model.js';
import { round3 } from './measure.js';

/** Scoring weights, in component order: 0.30 / 0.25 / 0.25 / 0.10 / 0.10. */
export const WEIGHTS: Readonly<Record<Component, number>> = {
  relChurn: 0.3,
  frequency: 0.25,
  complexity: 0.25,
  authors: 0.1,
  fixRatio: 0.1,
};
/** Relative churn is capped at 5× the file's size. */
export const RELATIVE_CHURN_CAP = 5;
/** Recency weighting: Σ e^(−age_days / 45). */
export const RECENCY_DAYS = 45;
export { MIN_COMMITS };
export const TOP_N = 20;
export const DEFAULT_FIX_KEYWORDS = '\\b(fix|bug|hotfix|regress|revert)\\b';

const DAY = 86_400;
const WEEK = 7 * DAY;

/** Weeks in a window from `windowStart` to `now` (unix seconds): 5 for 30 d, 13 for 90, 53 for 365. */
export function weekCount(windowStart: number, now: number): number {
  return Math.max(1, Math.ceil((now - windowStart) / WEEK));
}

/**
 * The week bucket of a commit at `timestamp`, 0 = the oldest week. A commit exactly at the window
 * start is in week 0; one at `now` (or later, from a skewed clock) is in the last week.
 */
export function weekIndex(timestamp: number, windowStart: number, weeks: number): number {
  return Math.min(weeks - 1, Math.max(0, Math.floor((timestamp - windowStart) / WEEK)));
}

/**
 * Why a file is not ranked: not measured, then (with `rank: 'code'`) not source code, then too
 * small, then too few commits. `rank: 'all'` is the behaviour before code-only ranking.
 */
export function whyNotRanked(
  stat: FileStat,
  commits: number,
  minLoc: number,
  rank: RankMode = 'all',
): WhyCode | undefined {
  if (stat.skipped !== undefined) return 'excluded';
  if (rank === 'code') {
    const kind = classify(stat.path);
    if (kind !== 'code') return kind;
  }
  if (stat.loc < minLoc) return 'small';
  if (commits < MIN_COMMITS) return 'few-commits';
  return undefined;
}

export interface AggregateOptions {
  /** Unix seconds; older commits are ignored. */
  windowStart: number;
  /** Unix seconds; ages are measured from here. */
  now: number;
  fixKeywords: RegExp;
  minLoc?: number;
  /** `churnmap.rank`; only `code` files are eligible with `code`. Defaults to `all`. */
  rank?: RankMode;
}

/** Compiles `churnmap.fixKeywords` case-insensitively; an invalid pattern falls back to the default. */
export function compileFixKeywords(source: string | undefined, logger?: AnalysisLogger): RegExp {
  if (source !== undefined && source.trim().length > 0) {
    try {
      return new RegExp(source, 'i');
    } catch {
      logger?.warn(`churnmap.fixKeywords is not a valid regular expression; using the default.`);
    }
  }
  return new RegExp(DEFAULT_FIX_KEYWORDS, 'i');
}

interface Tally {
  commits: number;
  churn: number;
  frequency: number;
  fixCommits: number;
  authors: Set<string>;
  commitsByName: Map<string, number>;
  weekly: number[];
}

/** Newest first, then by sha, so aggregation (and float sums) never depend on input order. */
function newestFirst(a: CommitRecord, b: CommitRecord): number {
  return b.timestamp - a.timestamp || compareCodeUnits(a.sha, b.sha);
}

/**
 * Per-file raw components over the window, for every file in the current tree (`stats`).
 * A rename folds the old path's history into the new path; changes to paths that are no longer
 * in the tree are dropped. Percentiles and scores are filled in by `score`.
 */
export function aggregate(
  commits: readonly CommitRecord[],
  stats: readonly FileStat[],
  opts: AggregateOptions,
): FileScore[] {
  const minLoc = opts.minLoc ?? DEFAULT_MIN_LOC;
  const weeks = weekCount(opts.windowStart, opts.now);
  const tallies = new Map<string, Tally>();
  const tally = (path: string): Tally => {
    let t = tallies.get(path);
    if (!t) {
      t = {
        commits: 0,
        churn: 0,
        frequency: 0,
        fixCommits: 0,
        authors: new Set(),
        commitsByName: new Map(),
        weekly: new Array<number>(weeks).fill(0),
      };
      tallies.set(path, t);
    }
    return t;
  };

  // Walking newest → oldest, `alias` maps an older name to the path it has today.
  const alias = new Map<string, string>();
  const current = (path: string): string => alias.get(path) ?? path;

  for (const commit of [...commits].sort(newestFirst)) {
    if (commit.timestamp < opts.windowStart) continue;
    const ageDays = Math.max(0, opts.now - commit.timestamp) / DAY;
    const weight = Math.exp(-ageDays / RECENCY_DAYS);
    const isFix = opts.fixKeywords.test(commit.subject);
    const week = weekIndex(commit.timestamp, opts.windowStart, weeks);
    const author = commit.authorEmail.trim().toLowerCase() || commit.authorName.trim();
    const touched = new Set<string>();

    for (const change of commit.files) {
      const target = current(change.path);
      if (change.renamedFrom !== undefined) alias.set(change.renamedFrom, target);
      const t = tally(target);
      t.churn += change.added + change.deleted;
      if (touched.has(target)) continue;
      touched.add(target);
      t.commits += 1;
      t.weekly[week] = (t.weekly[week] ?? 0) + 1;
      t.frequency += weight;
      if (isFix) t.fixCommits += 1;
      t.authors.add(author);
      t.commitsByName.set(commit.authorName, (t.commitsByName.get(commit.authorName) ?? 0) + 1);
    }
  }

  return stats.map((stat): FileScore => {
    const t = tallies.get(stat.path);
    const commitCount = t?.commits ?? 0;
    const churn = t?.churn ?? 0;
    const why = whyNotRanked(stat, commitCount, minLoc, opts.rank);
    return {
      path: stat.path,
      loc: stat.loc,
      commits: commitCount,
      churn,
      relChurn: Math.min(RELATIVE_CHURN_CAP, churn / Math.max(stat.loc, 1)),
      frequency: t?.frequency ?? 0,
      complexity: stat.complexity,
      maxDepth: stat.maxDepth,
      authors: t?.authors.size ?? 0,
      fixRatio: commitCount > 0 ? (t?.fixCommits ?? 0) / commitCount : 0,
      percentiles: zeroPercentiles(),
      score: 0,
      eligible: why === undefined,
      owners: t ? topOwners(t.commitsByName) : [],
      weekly: t && t.commits > 0 ? t.weekly : [],
      ...(why === undefined ? {} : { why }),
    };
  });
}

function zeroPercentiles(): Record<Component, number> {
  return { relChurn: 0, frequency: 0, complexity: 0, authors: 0, fixRatio: 0 };
}

function topOwners(byName: Map<string, number>): string[] {
  return [...byName.entries()]
    .sort(([a, x], [b, y]) => y - x || compareCodeUnits(a, b))
    .slice(0, 2)
    .map(([name]) => name);
}

/**
 * Percentile rank of each value among `values`: rank / (n − 1), with tied values sharing the
 * average of their ranks; a single value gets 1.0.
 */
export function percentileRanks(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [1];
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1]?.value === order[i]?.value) j += 1;
    const averageRank = (i + j) / 2;
    for (let k = i; k <= j; k++) ranks[order[k]?.index ?? 0] = averageRank / (n - 1);
    i = j + 1;
  }
  return ranks;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Fills in percentiles (among eligible files only) and the 0–100 score, and rounds the raw
 * components for storage. Non-eligible files keep percentiles 0 and score 0.
 */
export function scoreFiles(files: readonly FileScore[]): FileScore[] {
  const eligible = files.filter((f) => f.eligible);
  const ranks = new Map<Component, number[]>(
    COMPONENTS.map((c) => [c, percentileRanks(eligible.map((f) => f[c]))]),
  );
  const byPath = new Map<string, Record<Component, number>>();
  eligible.forEach((file, i) => {
    const p = zeroPercentiles();
    for (const c of COMPONENTS) p[c] = ranks.get(c)?.[i] ?? 0;
    byPath.set(file.path, p);
  });

  return files.map((file) => {
    const p = byPath.get(file.path) ?? zeroPercentiles();
    const total = COMPONENTS.reduce((sum, c) => sum + WEIGHTS[c] * p[c], 0);
    return {
      ...file,
      relChurn: round3(file.relChurn),
      frequency: round3(file.frequency),
      fixRatio: round3(file.fixRatio),
      percentiles: {
        relChurn: round4(p.relChurn),
        frequency: round4(p.frequency),
        complexity: round4(p.complexity),
        authors: round4(p.authors),
        fixRatio: round4(p.fixRatio),
      },
      score: file.eligible ? round1(100 * total) : 0,
    };
  });
}

/**
 * The 2–3 components with the highest percentile, as plain sentences with their numbers: always two, and a third when its
 * percentile is at least 0.5. Ties keep the weight order.
 */
export function reasons(file: FileScore, window: Window): Reason[] {
  const ordered = [...COMPONENTS].sort(
    (a, b) =>
      file.percentiles[b] - file.percentiles[a] || COMPONENTS.indexOf(a) - COMPONENTS.indexOf(b),
  );
  const third = ordered[2];
  const count = third !== undefined && file.percentiles[third] >= 0.5 ? 3 : 2;
  return ordered.slice(0, count).map((component) => ({
    component,
    text: sentence(file, component, window),
    detail: detail(file, component),
    percentile: file.percentiles[component],
  }));
}

/**
 * The top 20 eligible files: score desc, then commits desc, then path asc. Trend is filled later.
 * `ignored` paths are skipped, so the next-best files fill their slots.
 */
export function rank(
  files: readonly FileScore[],
  window: Window,
  ignored: ReadonlySet<string> = new Set(),
): Hotspot[] {
  return files
    .filter((f) => f.eligible && !ignored.has(f.path))
    .sort(compareRanked)
    .slice(0, TOP_N)
    .map((file, i) => ({ rank: i + 1, file, reasons: reasons(file, window), trend: 'unknown' }));
}
