/**
 * AI prompts: a hotspot's numbers, reasons and recent commit subjects, followed by a guarded
 * ask, as Markdown the user reads before pasting it into their own AI agent (Churnmap itself
 * answers nothing; the user's agent does). Pure (no `vscode`),
 * shared by the extension and the MCP server. A brief never contains file contents.
 */
import { TREND_TOOLTIP, trendText, whyText } from '../analysis/explain.js';
import type { FileScore, Hotspot, Trend, Window } from '../analysis/model.js';
import { reasons as scoreReasons } from '../analysis/score.js';
import { cleanSubject, RECENT_SUBJECTS } from '../analysis/subjects.js';
import { bandOfFile } from '../analysis/bands.js';
import { type Band, bandLabel } from '../city/palette.js';

export type BriefTemplate = 'refactor-plan' | 'tests-first' | 'explain-history' | 'review-changes';

export const BRIEF_TEMPLATES: readonly BriefTemplate[] = [
  'refactor-plan',
  'tests-first',
  'explain-history',
  'review-changes',
];

export function isBriefTemplate(x: unknown): x is BriefTemplate {
  return typeof x === 'string' && (BRIEF_TEMPLATES as readonly string[]).includes(x);
}

export interface TemplateSpec {
  title: string;
  /** One line for the quick pick. */
  description: string;
  ask: string;
}

export const TEMPLATES: Readonly<Record<BriefTemplate, TemplateSpec>> = {
  'refactor-plan': {
    title: 'Refactor plan',
    description: 'A step-by-step plan that keeps behaviour',
    ask:
      'Read the file. Propose a step-by-step plan to reduce nesting and split responsibilities ' +
      '**without changing behaviour**. Each step must be small enough to review in one PR. Say ' +
      'which step to do first and why.',
  },
  'tests-first': {
    title: 'Tests first',
    description: 'Characterisation tests before any change',
    ask:
      'Before any change, write characterisation tests that pin the current behaviour of the ' +
      'risky paths in this file. List the behaviours you covered and the ones you could not.',
  },
  'explain-history': {
    title: 'Explain the history',
    description: 'Why this file keeps changing',
    ask:
      'From the commit subjects and stats below, explain why this file keeps changing and what ' +
      'the recurring causes are. Suggest one structural change that would reduce the churn.',
  },
  'review-changes': {
    title: 'Review my changes',
    description: 'Extra care on the hotspots you are changing',
    ask:
      'I am changing these hotspot files. Review the diff with extra care: behaviour changes, ' +
      'missing tests, and anything that widens the blast radius. Be specific.',
  },
};

export const GUARDRAILS =
  'Rules: keep behaviour, add tests first, small diffs, no unrelated changes.';

/** Everything a brief says about one file: numbers, short sentences and commit subjects. */
export interface BriefFile {
  path: string;
  /** 1-based rank in the top list; absent when the file is not ranked there. */
  rank?: number;
  score: number;
  band: Band;
  /** Plain sentences, each with the numbers behind it when there are any. */
  reasons: { text: string; detail?: string }[];
  /** Why the file is not ranked (unranked files only). */
  why?: string;
  loc: number;
  commits: number;
  authors: number;
  owners: string[];
  trend: Trend;
  /** Commits per week across the window, oldest first. */
  weekly: number[];
  /** Newest first, at most `RECENT_SUBJECTS`, each at most 100 characters. */
  subjects: string[];
}

export interface BriefInput {
  /** The repository folder's name. */
  repoName: string;
  window: Window;
  /** One file for most templates; every changed hotspot for `review-changes`. */
  files: readonly BriefFile[];
}

/** A ranked hotspot as brief input. */
export function briefFileFromHotspot(
  hotspot: Hotspot,
  window: Window,
  subjects: readonly string[],
): BriefFile {
  const { file } = hotspot;
  return {
    ...common(file, subjects),
    rank: hotspot.rank,
    reasons: hotspot.reasons.map((r) => ({ text: r.text, detail: r.detail })),
    trend: hotspot.trend,
  };
}

/** A file outside the top list (scored or not ranked) as brief input. */
export function briefFileFromScore(
  file: FileScore,
  window: Window,
  subjects: readonly string[],
): BriefFile {
  return {
    ...common(file, subjects),
    reasons: file.eligible
      ? scoreReasons(file, window).map((r) => ({ text: r.text, detail: r.detail }))
      : [],
    ...(file.eligible || file.why === undefined
      ? {}
      : { why: whyText(file.why, file.commits, window) }),
    trend: 'unknown',
  };
}

function common(
  file: FileScore,
  subjects: readonly string[],
): Omit<BriefFile, 'reasons' | 'trend' | 'rank' | 'why'> {
  return {
    path: file.path,
    score: file.score,
    band: bandOfFile(file),
    loc: file.loc,
    commits: file.commits,
    authors: file.authors,
    owners: file.owners.slice(0, 2),
    weekly: file.weekly.map((n) => (Number.isFinite(n) ? n : 0)),
    subjects: subjects.slice(0, RECENT_SUBJECTS).map(cleanSubject),
  };
}

/** An inline code span that survives backticks in the text. */
export function codeSpan(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const fence = '`'.repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** One line of text: line breaks and runs of whitespace collapsed. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** "Complexity rising ↑ (compared with the start of the window)", or "unknown". */
function trendLine(trend: Trend): string {
  const words = trendText(trend);
  return words === '' ? 'Complexity trend unknown' : `${words} (${TREND_TOOLTIP})`;
}

function dataBlock(file: BriefFile, window: Window): string[] {
  const out = [`### ${codeSpan(file.path)}`, ''];
  const rank = file.rank === undefined ? 'not in the top list' : `#${String(file.rank)}`;
  out.push(
    `- Rank: ${rank} · Score: ${file.score.toFixed(1)} / 100 (${bandLabel(file.band)})`,
    `- Size: ${file.loc.toLocaleString('en-US')} lines · Changes: ${String(file.commits)} in ${String(window)} days · People: ${String(file.authors)}` +
      (file.owners.length > 0 ? ` (mostly ${file.owners.map(oneLine).join(', ')})` : ''),
    `- ${trendLine(file.trend)}`,
  );
  if (file.weekly.length > 0) {
    out.push(`- Commits per week, oldest first: ${file.weekly.join(', ')}`);
  }
  if (file.why !== undefined) out.push(`- ${oneLine(file.why)}`);
  if (file.reasons.length > 0) {
    out.push('- Why it ranks:');
    for (const r of file.reasons) {
      out.push(`  - ${oneLine(r.text)}${r.detail ? ` (${oneLine(r.detail)})` : ''}`);
    }
  }
  out.push('', '#### Recent commit subjects (newest first)', '');
  if (file.subjects.length === 0) out.push('- (none recorded; rebuild to include them)');
  else for (const s of file.subjects) out.push(`- ${oneLine(s)}`);
  out.push('');
  return out;
}

/**
 * The prompt's first line, which is also its editor tab's title: "AI prompt · <file name>" (or
 * "AI prompt · N changed hotspots" for a review of changes).
 */
export function promptTitle(files: readonly Pick<BriefFile, 'path'>[]): string {
  const first = files[0];
  if (files.length > 1) return `AI prompt · ${String(files.length)} changed hotspots`;
  return `AI prompt · ${oneLine(first ? (first.path.split('/').at(-1) ?? first.path) : 'hotspots')}`;
}

/** The line under the title: where the numbers come from. */
export function briefHeader(repoName: string, window: Window): string {
  return `Churnmap · ${oneLine(repoName)} · last ${String(window)} days`;
}

/**
 * The brief: header, one data block per file (numbers, reasons, commit subjects), the ask and the
 * guardrails. Paths, numbers and commit subjects only; never file contents.
 */
export function buildBrief(input: BriefInput, template: BriefTemplate): string {
  const spec = TEMPLATES[template];
  const files = template === 'review-changes' ? input.files : input.files.slice(0, 1);
  const lines = [
    promptTitle(files),
    briefHeader(input.repoName, input.window),
    '',
    `## ${spec.title}`,
    '',
  ];
  if (template === 'review-changes') {
    lines.push(
      `Hotspots in my changes: ${files.map((f) => codeSpan(f.path)).join(', ') || '(none)'}`,
      '',
    );
  }
  for (const file of files) lines.push(...dataBlock(file, input.window));
  lines.push('## Ask', '', spec.ask, '', GUARDRAILS, '');
  return lines.join('\n');
}
