import { describe, expect, it } from 'vitest';
import {
  BRIEF_TEMPLATES,
  briefFileFromHotspot,
  briefFileFromScore,
  briefHeader,
  buildBrief,
  promptTitle,
  codeSpan,
  GUARDRAILS,
  isBriefTemplate,
  TEMPLATES,
} from '../../../src/ai/brief.js';
import { MAX_SUBJECT_LENGTH } from '../../../src/analysis/subjects.js';
import { analysis, fileScore } from './helpers.js';

const result = analysis([
  fileScore('src/core/engine.ts', 91.3, { loc: 1234, commits: 41 }),
  fileScore('src/api/handler.ts', 70),
  fileScore('src/util/small.ts', 10),
]);
const top = result.top[0];
if (!top) throw new Error('fixture has no hotspot');
const subjects = ['fix: crash on empty input', 'Engine: caching', 'Engine: nested rules'];
const engine = briefFileFromHotspot(top, 90, subjects);

describe('buildBrief', () => {
  it.each(BRIEF_TEMPLATES)(
    '%s: title, header, data block, subjects, ask and guardrails',
    (template) => {
      const text = buildBrief({ repoName: 'my-repo', window: 90, files: [engine] }, template);
      // The first line is the untitled editor's tab title.
      expect(text.split('\n')[0]).toBe('AI prompt · engine.ts');
      expect(text.split('\n')[1]).toBe('Churnmap · my-repo · last 90 days');
      expect(text).toContain(`## ${TEMPLATES[template].title}`);
      expect(text).toContain('### `src/core/engine.ts`');
      expect(text).toContain('Rank: #1 · Score: 91.3 / 100 (Hotspot)');
      expect(text).toContain('1,234 lines · Changes: 41 in 90 days · People: 3');
      expect(text).toContain('Commits per week, oldest first: 1, 0, 3, 8');
      expect(text).toContain('- Complexity rising ↑ (compared with the start of the window)');
      for (const s of subjects) expect(text).toContain(`- ${s}`);
      // The ask comes after the data, then the guardrails end the brief.
      expect(text.indexOf(TEMPLATES[template].ask)).toBeGreaterThan(
        text.indexOf(subjects[0] ?? ''),
      );
      expect(text.trimEnd().endsWith(GUARDRAILS)).toBe(true);
    },
  );

  it('words each reason as a sentence with its numbers', () => {
    const text = buildBrief({ repoName: 'r', window: 90, files: [engine] }, 'refactor-plan');
    expect(text).toMatch(/ {2}- Changed 41 times in 90 days \(more often than 90% of files\)/);
    expect(text).not.toMatch(/\btop \d+%/);
  });

  it('guards every ask: behaviour kept, tests, small steps', () => {
    expect(TEMPLATES['refactor-plan'].ask).toContain('**without changing behaviour**');
    expect(TEMPLATES['tests-first'].ask).toMatch(/characterisation tests/);
    expect(TEMPLATES['explain-history'].ask).toMatch(/one structural change/);
    expect(TEMPLATES['review-changes'].ask).toMatch(/blast radius/);
    expect(GUARDRAILS).toBe(
      'Rules: keep behaviour, add tests first, small diffs, no unrelated changes.',
    );
  });

  it('review-changes lists every changed hotspot; other templates use the first file only', () => {
    const second = result.top[1];
    if (!second) throw new Error('fixture has no second hotspot');
    const files = [engine, briefFileFromHotspot(second, 90, [])];
    const review = buildBrief({ repoName: 'r', window: 90, files }, 'review-changes');
    expect(review).toContain('Hotspots in my changes: `src/core/engine.ts`, `src/api/handler.ts`');
    expect(review).toContain('### `src/api/handler.ts`');
    const plan = buildBrief({ repoName: 'r', window: 90, files }, 'refactor-plan');
    expect(plan).not.toContain('src/api/handler.ts');
  });

  it('never contains file contents: only the fields it is given', () => {
    const text = buildBrief({ repoName: 'r', window: 90, files: [engine] }, 'tests-first');
    // Every line is a heading, a list item, a known sentence or blank.
    for (const line of text.split('\n')) {
      expect(line).toMatch(/^(AI prompt · |Churnmap · |#|- | {2}- |Rules:|Before any change|$)/);
    }
  });

  it('keeps subjects to 10, one line, at most 100 characters each', () => {
    const long = [
      'x'.repeat(300),
      'two\nlines',
      ...Array.from({ length: 20 }, (_, i) => `s${String(i)}`),
    ];
    const file = briefFileFromHotspot(top, 90, long);
    expect(file.subjects).toHaveLength(10);
    expect(file.subjects[0]).toHaveLength(MAX_SUBJECT_LENGTH);
    expect(file.subjects[0]?.endsWith('…')).toBe(true);
    expect(file.subjects[1]).toBe('two lines');
  });

  it('says when no subjects were recorded', () => {
    const text = buildBrief(
      { repoName: 'r', window: 90, files: [briefFileFromHotspot(top, 90, [])] },
      'explain-history',
    );
    expect(text).toContain('(none recorded; rebuild to include them)');
  });

  it('describes files outside the top list: scored ones with reasons, unranked ones with why', () => {
    const scored = briefFileFromScore(fileScore('src/b.ts', 40), 90, []);
    expect(scored.rank).toBeUndefined();
    expect(scored.reasons.length).toBeGreaterThan(0);
    const docs = briefFileFromScore(
      fileScore('docs/a.md', 0, { eligible: false, why: 'docs' }),
      90,
      [],
    );
    expect(docs.reasons).toEqual([]);
    const text = buildBrief({ repoName: 'r', window: 90, files: [docs] }, 'explain-history');
    expect(text).toContain('Rank: not in the top list');
    expect(text).toContain('Not ranked: documentation');
  });
});

describe('helpers', () => {
  it('briefHeader collapses whitespace in the repository name', () => {
    expect(briefHeader('my\nrepo', 30)).toBe('Churnmap · my repo · last 30 days');
  });

  it('promptTitle names the file, or the number of changed hotspots', () => {
    expect(promptTitle([{ path: 'src/core/task_router.py' }])).toBe('AI prompt · task_router.py');
    expect(promptTitle([{ path: 'a.ts' }, { path: 'b.ts' }])).toBe(
      'AI prompt · 2 changed hotspots',
    );
  });

  it('codeSpan survives backticks', () => {
    expect(codeSpan('a.ts')).toBe('`a.ts`');
    expect(codeSpan('we`ird.ts')).toBe('``we`ird.ts``');
    expect(codeSpan('`edge')).toBe('`` `edge ``');
  });

  it('isBriefTemplate accepts the four templates only', () => {
    for (const t of BRIEF_TEMPLATES) expect(isBriefTemplate(t)).toBe(true);
    expect(isBriefTemplate('rewrite-everything')).toBe(false);
    expect(isBriefTemplate(undefined)).toBe(false);
  });
});
