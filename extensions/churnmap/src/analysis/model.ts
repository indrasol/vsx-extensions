/**
 * Shared analysis types. Pure data: no `vscode` import, no classes, so every value here can be
 * cached with `JSON.stringify` and posted to a worker or a webview unchanged.
 */

/** The history window, in days. */
export type Window = 30 | 90 | 365;

export const WINDOWS: readonly Window[] = [30, 90, 365];

export function isWindow(value: unknown): value is Window {
  return value === 30 || value === 90 || value === 365;
}

/** One file touched by a commit, from a `git log --numstat -z` row. */
export interface FileChange {
  /** Repository-relative, forward slashes. For a rename, the new path. */
  path: string;
  added: number;
  deleted: number;
  /** Numstat reports `-\t-` for binary files; added/deleted are then 0. */
  binary: boolean;
  renamedFrom?: string;
}

export interface CommitRecord {
  sha: string;
  authorName: string;
  authorEmail: string;
  /** Author time, unix seconds. */
  timestamp: number;
  subject: string;
  /** Empty for merge commits (git log shows no numstat for them by default). */
  files: FileChange[];
}

export interface GitInfo {
  /** Absolute path of the git executable that was verified. */
  gitPath: string;
  version: string;
  /** `git rev-parse --show-toplevel`. */
  repoRoot: string;
  /** `git rev-parse HEAD`, a full sha. */
  head: string;
  shallow: boolean;
}

export interface GitLogOptions {
  window: Window;
  /** Overrides the window start (tests, and the pipeline so git and the filter agree). */
  since?: Date;
  signal?: AbortSignal | undefined;
}

/** Why a tracked file has no measurements. */
export type SkipReason = 'binary' | 'too-large' | 'excluded' | 'unreadable';

/** Size and indentation complexity of one file in the current tree (README: How scoring works). */
export interface FileStat {
  path: string;
  bytes: number;
  /** Non-blank lines. */
  loc: number;
  maxDepth: number;
  meanDepth: number;
  /** 0.6 · maxDepth + 0.4 · meanDepth, rounded to 3 decimals. */
  complexity: number;
  skipped?: SkipReason;
}

export interface TreeOptions {
  /** User globs from `churnmap.exclude`; the built-in exclusions always apply as well. */
  exclude: string[];
  maxFiles: number;
  /** Files larger than this are not read (default 1 MiB). */
  maxBytes: number;
  /** Files below this LOC are measured but never eligible for ranking (default 20). */
  minLoc: number;
}

export const DEFAULT_MAX_BYTES = 1024 * 1024;
/** Files need at least this many commits in the window to rank ("cold files never rank"). */
export const MIN_COMMITS = 2;
export const DEFAULT_MIN_LOC = 20;

/** The five score components, in weight order. */
export type Component = 'relChurn' | 'frequency' | 'complexity' | 'authors' | 'fixRatio';

export const COMPONENTS: readonly Component[] = [
  'relChurn',
  'frequency',
  'complexity',
  'authors',
  'fixRatio',
];

export interface FileScore {
  path: string;
  loc: number;
  /** Commits touching the file in the window. */
  commits: number;
  /** Lines added + deleted in the window. */
  churn: number;
  /** min(5, churn / max(loc, 1)). */
  relChurn: number;
  /** Σ e^(−age_days / 45) over the commits. */
  frequency: number;
  complexity: number;
  /** Deepest indentation level; used to word the complexity reason. */
  maxDepth: number;
  /** Distinct authors in the window. */
  authors: number;
  /** Fix commits ÷ commits. */
  fixRatio: number;
  /** Percentile rank per component among eligible files, 0–1; all 0 when not eligible. */
  percentiles: Record<Component, number>;
  /** 0–100, one decimal. */
  score: number;
  eligible: boolean;
  /** Top 2 author names by commits. */
  owners: string[];
  /**
   * Commits per week across the window, oldest week first: 5 values for 30 days, 13 for 90, 53
   * for 365 (the last week may be partial). Empty when the file has no commits in the window.
   */
  weekly: number[];
  /** Why the file is not ranked; set only when `eligible` is false. */
  why?: WhyCode;
  /** Set by the store (never cached) when the user has ignored this file. */
  ignored?: true;
  /** 1-based place among the ranked files (eligible, not ignored); `bands.ts`. */
  position?: number;
  /** Relative band from `position`: Hotspot (top 5 %), Watch (next 15 %), Stable. */
  band?: Band;
  /** Colour position on the ramp, 0–100: the band's range, placed by the score within it. */
  heat?: number;
}

/** The three bands the legend, cards and agent files name (relative, see `bands.ts`). */
export type Band = 'stable' | 'watch' | 'hotspot';

/**
 * Why a file is not ranked: fewer than `MIN_COMMITS` commits in the window, under the minimum
 * LOC, not measured (binary, too large, unreadable), or, with `churnmap.rank: code`, not source
 * code (its kind: `docs`, `data`, `config`, `asset` or `generated`).
 */
export type WhyCode =
  'few-commits' | 'small' | 'excluded' | 'docs' | 'data' | 'config' | 'asset' | 'generated';

const WHY_CODES: readonly string[] = [
  'few-commits',
  'small',
  'excluded',
  'docs',
  'data',
  'config',
  'asset',
  'generated',
];

export function isWhyCode(x: unknown): x is WhyCode {
  return typeof x === 'string' && WHY_CODES.includes(x);
}

export interface Reason {
  component: Component;
  /** The plain sentence ("Changed 29 times in 90 days"). */
  text: string;
  /** The numbers behind it ("more often than 99% of files"). */
  detail: string;
  percentile: number;
}

export type Trend = 'rising' | 'flat' | 'falling' | 'unknown';

/** A hotspot the user ignored: repository-relative path, why, and until when (ms since the epoch). */
export interface IgnoredFile {
  path: string;
  /** Trimmed, at most 200 characters; may be empty. */
  reason: string;
  until: number;
}

export interface Hotspot {
  /** 1-based. */
  rank: number;
  file: FileScore;
  reasons: Reason[];
  trend: Trend;
}

/** Bumped when the cached shape changes; a cache file with another version is ignored. */
export const ANALYSIS_VERSION = 4;

export interface AnalysisResult {
  version: typeof ANALYSIS_VERSION;
  repoRoot: string;
  head: string;
  window: Window;
  /** ISO timestamp. */
  generatedAt: string;
  shallow: boolean;
  commitCount: number;
  files: FileScore[];
  top: Hotspot[];
  /** Tracked files left out by the built-in or user exclusions. */
  excludedCount: number;
  /** True when `churnmap.maxFiles` cut the file list. */
  capped: boolean;
  /** Fingerprint of the settings the result was computed with; a mismatch is a cache miss. */
  settingsKey: string;
  /** Milliseconds per pipeline step. */
  timings: Record<string, number>;
  /**
   * The last commit subjects (never bodies) per file, newest first, for the highest-scoring
   * eligible files (`analysis/subjects.ts`). Feeds the AI prompts.
   */
  subjects?: Record<string, string[]>;
  /**
   * `churnmap.rank` the result was ranked with (part of `settingsKey`, so a cache hit has the
   * same one). Missing in results cached by earlier versions; the reader fills it in.
   */
  rank?: 'code' | 'all';
}

/** The logging the analysis modules need; labs-core's Logger satisfies it. */
export interface AnalysisLogger {
  info(message: string): void;
  warn(message: string): void;
}
