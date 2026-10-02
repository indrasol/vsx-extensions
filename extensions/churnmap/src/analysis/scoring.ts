/**
 * "How is this scored?": the one explanation of the score, shared word for word by the city's
 * explainer sheet (opened from the card and the legend) and the README's "How scoring works"
 * section (a unit test compares them). Plain strings; browser-safe.
 */
import type { Component } from './model.js';

export const SCORING_TITLE = 'How is this scored?';

export const SCORING_INTRO =
  'Churnmap reads your git history for the chosen window (30, 90 or 365 days) and asks five ' +
  'questions about every ranked file. Each answer is compared with the other ranked files in ' +
  'this repository ("more than X% of files"), weighted, and added up to a score from 0 to 100. ' +
  'The score says how strongly a file stands out here, not how good its code is.';

export interface ScoringQuestion {
  component: Component;
  question: string;
  /** What is measured, in plain words. */
  measure: string;
  /** Weight in percent; the five add up to 100. */
  weight: number;
}

/** The five questions, in weight order (30 / 25 / 25 / 10 / 10). */
export const SCORING_QUESTIONS: readonly ScoringQuestion[] = [
  {
    component: 'relChurn',
    question: 'How much of it was rewritten?',
    measure: 'Lines added and removed in the window, compared with its size today',
    weight: 30,
  },
  {
    component: 'frequency',
    question: 'How often does it change?',
    measure: 'Commits that touched it, recent ones counting more',
    weight: 25,
  },
  {
    component: 'complexity',
    question: 'How deeply nested is its code?',
    measure: 'The depth of its indentation, in any language',
    weight: 25,
  },
  {
    component: 'authors',
    question: 'How many people edit it?',
    measure: 'Distinct authors in the window',
    weight: 10,
  },
  {
    component: 'fixRatio',
    question: 'How many changes were bug fixes?',
    measure: 'Commits whose message says fix, bug, hotfix, regress or revert',
    weight: 10,
  },
];

export const WHO_IS_RANKED_TITLE = 'Which files are ranked';
export const WHO_IS_RANKED =
  'Code files with at least 2 commits and at least 20 lines in the window. Documentation, ' +
  'data, configuration, assets and generated files are still drawn, as grey glass, but never ' +
  'ranked (set churnmap.rank to all to rank every file). History follows a file through renames.';

export const BANDS_TITLE = 'What the bands mean';
/** One line per band, hottest first, then how colour follows them. */
export const BAND_LINES: readonly string[] = [
  'Hotspot: the top 5 % of the ranked code files (at least 3, at most 20).',
  'Watch: the next 15 %.',
  'Stable: the rest.',
];
export const BANDS_NOTE =
  'Bands are relative to this repository, so the #1 file is always a Hotspot. Colour follows ' +
  'the band, and the score places a file within it.';

export const NOT_TITLE = 'What Churnmap is not';
export const NOT_LINES: readonly string[] = [
  'Not a quality grade. A hotspot is where change, size and complexity meet: where bugs and ' +
    'delays tend to cluster, and where refactoring time pays back most. A complex file nobody ' +
    'touches will, rightly, not rank.',
  'Not a blame tool. Authors are shown to find who knows a file, not who is at fault.',
  'Never a bare number. Every ranked file shows the reasons behind its score, so you can judge ' +
    'it yourself.',
];

export const EXAMPLE_TITLE = 'Worked example';

/** One component of a file, for the worked example: its sentence and percentile (0–1). */
export interface ExamplePart {
  component: Component;
  /** The plain sentence ("Changed 29 times in 90 days"). */
  text: string;
  percentile: number;
}

export interface ScoringExample {
  /** The file's name. */
  name: string;
  score: number;
  /** All five components, any order. */
  parts: readonly ExamplePart[];
}

/** Points a component adds to the score: weight × percentile, one decimal. */
export function points(weight: number, percentile: number): number {
  return Math.round(weight * percentile * 10) / 10;
}

function share(percentile: number): number {
  return Math.min(99, Math.max(1, Math.round(100 * percentile)));
}

/**
 * The worked example as lines: one per question ("Rewritten about 2× in 90 days: more than 95%
 * of files, so 28.5 of 30 points"), then the total.
 */
export function exampleLines(example: ScoringExample): { lines: string[]; total: string } {
  const lines = SCORING_QUESTIONS.map((q) => {
    const part = example.parts.find((p) => p.component === q.component);
    const p = part?.percentile ?? 0;
    const pts = points(q.weight, p);
    return `${part?.text ?? q.question}: more than ${String(share(p))}% of files, so ${pts.toFixed(1)} of ${String(q.weight)} points.`;
  });
  return {
    lines,
    total: `Together: a score of ${example.score.toFixed(1)} out of 100 for ${example.name}.`,
  };
}

/** The README's worked example: a file from the demo repository, with its real numbers. */
export const README_EXAMPLE: ScoringExample = {
  name: 'src/core/engine.js',
  score: 88.5,
  parts: [
    { component: 'relChurn', text: 'Rewritten about 2× in 90 days', percentile: 0.9 },
    { component: 'frequency', text: 'Changed 29 times in 90 days', percentile: 1 },
    { component: 'complexity', text: 'Deeply nested code (depth 8)', percentile: 0.9 },
    { component: 'authors', text: '4 people edited it', percentile: 0.7 },
    { component: 'fixRatio', text: '38% of changes were bug fixes', percentile: 0.7 },
  ],
};

/**
 * The README section's body (under "## How scoring works"): the same words as the explainer
 * sheet, with the worked example in prose.
 */
export function scoringMarkdown(example: ScoringExample = README_EXAMPLE): string {
  const { lines, total } = exampleLines(example);
  return [
    SCORING_INTRO,
    '',
    '| Question | What is measured | Weight |',
    '| --- | --- | --- |',
    ...SCORING_QUESTIONS.map((q) => `| ${q.question} | ${q.measure} | ${String(q.weight)}% |`),
    '',
    `### ${EXAMPLE_TITLE}`,
    '',
    `For \`${example.name}\`: ${lines.join(' ')} ${total}`,
    '',
    `### ${WHO_IS_RANKED_TITLE}`,
    '',
    WHO_IS_RANKED,
    '',
    `### ${BANDS_TITLE}`,
    '',
    ...BAND_LINES.map((l) => `- ${l}`),
    '',
    BANDS_NOTE,
    '',
    `### ${NOT_TITLE}`,
    '',
    ...NOT_LINES.map((l) => `- ${l}`),
  ].join('\n');
}
