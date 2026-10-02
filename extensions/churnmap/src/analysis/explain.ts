/**
 * The plain-language wording of a hotspot: one sentence per score component ("Changed 41 times
 * in 90 days") with the numbers behind it, the short notes for other ranked-range files, and why a file is not ranked.
 * Pure and browser-safe (it imports only the model and the classifier), so the host and the city webview word
 * things the same way.
 */
import { kindLabel } from './classify.js';
import {
  type Component,
  DEFAULT_MIN_LOC,
  type FileScore,
  MIN_COMMITS,
  type Trend,
  type WhyCode,
  type Window,
} from './model.js';

/** Sentences per top hotspot, and the length of each (spec: ≤ 3 × 120 characters). */
export const MAX_SENTENCES = 3;
export const MAX_SENTENCE_LENGTH = 120;
/** Notes per other eligible file, and the length of each (≤ 2 × 80 characters). */
export const MAX_NOTES = 2;
export const MAX_NOTE_LENGTH = 80;
/** Only eligible files scoring at least this get notes, so the analysis message stays small. */
export const NOTE_MIN_SCORE = 30;

/** Cuts `text` to `max` characters with an ellipsis. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The share of files this one beats, as a whole percentage in 1–99. */
export function beats(percentile: number): number {
  return Math.min(99, Math.max(1, Math.round(100 * percentile)));
}

function thousands(value: number): string {
  return value.toLocaleString('en-US');
}

/** A rough count: exact under 100, else two significant figures ("~1,000" for 1,003). */
export function roughly(value: number): string {
  if (value < 100) return String(Math.round(value));
  const step = 10 ** (Math.floor(Math.log10(value)) - 1);
  const rounded = Math.round(value / step) * step;
  return rounded === value ? thousands(value) : `~${thousands(rounded)}`;
}

/** How many times the lines changed add up to the file's size: "2", "1.5", "12". */
export function rewriteFactor(churn: number, loc: number): string {
  const ratio = churn / Math.max(loc, 1);
  const rounded = ratio < 3 ? Math.round(ratio * 2) / 2 : Math.round(ratio);
  return String(rounded);
}

/**
 * One component as a plain sentence without a full stop ("Changed 29 times in 90 days"): what the
 * card, the rail, the tree, the Markdown copy, AI prompts and the MCP server all say.
 */
export function sentence(file: FileScore, component: Component, window: Window): string {
  const days = `${String(window)} days`;
  switch (component) {
    case 'frequency':
      return file.commits === 1
        ? `Changed once in ${days}`
        : `Changed ${String(file.commits)} times in ${days}`;
    case 'relChurn': {
      const ratio = file.churn / Math.max(file.loc, 1);
      return ratio < 0.95
        ? `About ${String(Math.max(1, Math.round(ratio * 100)))}% of it rewritten in ${days}`
        : `Rewritten about ${rewriteFactor(file.churn, file.loc)}× in ${days}`;
    }
    case 'complexity':
      return file.percentiles.complexity >= 0.5
        ? `Deeply nested code (depth ${String(file.maxDepth)})`
        : `Nesting depth ${String(file.maxDepth)}`;
    case 'authors':
      return file.authors === 1
        ? 'Only 1 person edited it'
        : `${String(file.authors)} people edited it`;
    case 'fixRatio':
      return `${String(Math.round(file.fixRatio * 100))}% of changes were bug fixes`;
  }
}

/**
 * The numbers behind a sentence, for the detail line: "~1,000 lines added or removed vs 525
 * lines today", "more often than 99% of files". Comparisons always read "… than X% of files".
 */
export function detail(file: FileScore, component: Component): string {
  const p = beats(file.percentiles[component]);
  switch (component) {
    case 'frequency':
      return `more often than ${String(p)}% of files`;
    case 'relChurn':
      return `${roughly(file.churn)} lines added or removed vs ${thousands(file.loc)} lines today`;
    case 'complexity':
      return `deeper than ${String(p)}% of files`;
    case 'authors':
      return `more than ${String(p)}% of files`;
    case 'fixRatio': {
      const fixes = Math.round(file.fixRatio * file.commits);
      return `${String(fixes)} of ${String(file.commits)} ${plural(file.commits, 'change', 'changes')}`;
    }
  }
}

/** The sentences for a top hotspot's reason components: at most 3, each at most 120 characters. */
export function sentences(
  file: FileScore,
  components: readonly Component[],
  window: Window,
): string[] {
  return components
    .slice(0, MAX_SENTENCES)
    .map((c) => clip(sentence(file, c, window), MAX_SENTENCE_LENGTH));
}

/** The notes for an eligible file outside the top list: at most 2, each at most 80 characters. */
export function notes(file: FileScore, components: readonly Component[], window: Window): string[] {
  return components
    .slice(0, MAX_NOTES)
    .map((c) => clip(sentence(file, c, window), MAX_NOTE_LENGTH));
}

/** The friendly line an unranked file's card shows instead of reasons. */
export function whyText(
  why: WhyCode,
  commits: number,
  window: Window,
  minLoc: number = DEFAULT_MIN_LOC,
): string {
  switch (why) {
    case 'few-commits':
      return commits === 0
        ? `Not ranked yet: no changes in ${String(window)} days (needs ${String(MIN_COMMITS)}).`
        : `Not ranked yet: only ${String(commits)} ${plural(commits, 'change', 'changes')} in ${String(window)} days (needs ${String(MIN_COMMITS)}).`;
    case 'small':
      return `Not ranked: under ${String(minLoc)} lines, too small to score.`;
    case 'excluded':
      return 'Not ranked: binary, too large or unreadable, so it was not measured.';
    case 'docs':
    case 'data':
    case 'config':
    case 'asset':
    case 'generated':
      return `Not ranked: ${kindLabel(why)} (change with churnmap.rank).`;
  }
}

/** The trend's tooltip: what it is compared with. */
export const TREND_TOOLTIP = 'compared with the start of the window';

/** The complexity trend in words and an arrow, or nothing when it is unknown. */
export function trendText(trend: Trend): string {
  switch (trend) {
    case 'rising':
      return 'Complexity rising ↑';
    case 'falling':
      return 'Complexity falling ↓';
    case 'flat':
      return 'Complexity steady';
    case 'unknown':
      return '';
  }
}

/** The facts row's people count ("People 2"), shown when authors is not already a reason. */
export function peopleFact(authors: number): string {
  return `People ${String(authors)}`;
}

/** Which component a sentence from `sentence` words (for its icon); 'info' for anything else. */
export function componentOf(text: string): Component | 'info' {
  if (/^Changed /.test(text)) return 'frequency';
  if (/^Rewritten about |^About \d+% of it rewritten/.test(text)) return 'relChurn';
  if (/^Deeply nested code |^Nesting depth /.test(text)) return 'complexity';
  if (/(people|person) edited it$/.test(text)) return 'authors';
  if (/of changes were bug fixes$/.test(text)) return 'fixRatio';
  return 'info';
}
