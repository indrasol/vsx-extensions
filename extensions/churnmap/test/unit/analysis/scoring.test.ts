import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMPONENTS } from '../../../src/analysis/model.js';
import { WEIGHTS } from '../../../src/analysis/score.js';
import {
  exampleLines,
  points,
  README_EXAMPLE,
  SCORING_QUESTIONS,
  scoringMarkdown,
} from '../../../src/analysis/scoring.js';

/** Whitespace-insensitive, so Prettier's line wrapping in the README does not matter. */
function words(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\| ?-+ ?(?=\|)/g, '|---')
    .trim();
}

describe('"How is this scored?"', () => {
  it('asks the five questions with the score weights 30/25/25/10/10', () => {
    expect(SCORING_QUESTIONS.map((q) => q.component)).toEqual(COMPONENTS);
    for (const q of SCORING_QUESTIONS) expect(q.weight / 100).toBeCloseTo(WEIGHTS[q.component], 6);
    expect(SCORING_QUESTIONS.reduce((s, q) => s + q.weight, 0)).toBe(100);
  });

  it('works the example out question by question, and the points add up to the score', () => {
    const { lines, total } = exampleLines(README_EXAMPLE);
    expect(lines[0]).toBe(
      'Rewritten about 2× in 90 days: more than 90% of files, so 27.0 of 30 points.',
    );
    expect(total).toBe('Together: a score of 88.5 out of 100 for src/core/engine.js.');
    const sum = SCORING_QUESTIONS.reduce(
      (s, q) =>
        s +
        points(
          q.weight,
          README_EXAMPLE.parts.find((p) => p.component === q.component)?.percentile ?? 0,
        ),
      0,
    );
    expect(sum).toBeCloseTo(README_EXAMPLE.score, 6);
  });

  it('the README "How scoring works" section matches the explainer word for word', () => {
    const readme = readFileSync('README.md', 'utf8');
    const start = readme.indexOf('## How scoring works');
    const end = readme.indexOf('\n## ', start + 1);
    expect(start).toBeGreaterThan(0);
    const section = readme.slice(start + '## How scoring works'.length, end);
    expect(words(section)).toBe(words(scoringMarkdown()));
  });

  it('never words a percentile as "top N%"', () => {
    expect(scoringMarkdown()).not.toMatch(/\btop \d+%/);
  });
});
