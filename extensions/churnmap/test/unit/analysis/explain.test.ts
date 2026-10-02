import { describe, expect, it } from 'vitest';
import {
  clip,
  componentOf,
  detail,
  MAX_NOTE_LENGTH,
  MAX_SENTENCE_LENGTH,
  notes,
  peopleFact,
  roughly,
  sentence,
  sentences,
  TREND_TOOLTIP,
  trendText,
  whyText,
} from '../../../src/analysis/explain.js';
import { COMPONENTS, type FileScore } from '../../../src/analysis/model.js';

const file = (over: Partial<FileScore> = {}): FileScore => ({
  path: 'src/billing/invoice.ts',
  loc: 400,
  commits: 41,
  churn: 1240,
  relChurn: 3.1,
  frequency: 12,
  complexity: 5,
  maxDepth: 9,
  authors: 6,
  fixRatio: 0.38,
  percentiles: { relChurn: 0.9, frequency: 0.98, complexity: 0.95, authors: 0.7, fixRatio: 0.6 },
  score: 91,
  eligible: true,
  owners: ['Ann'],
  weekly: [],
  ...over,
});

describe('sentence', () => {
  it('words every component in plain language', () => {
    const f = file();
    expect(sentence(f, 'frequency', 90)).toBe('Changed 41 times in 90 days');
    expect(sentence(f, 'authors', 90)).toBe('6 people edited it');
    expect(sentence(f, 'fixRatio', 90)).toBe('38% of changes were bug fixes');
    expect(sentence(f, 'complexity', 90)).toBe('Deeply nested code (depth 9)');
    expect(sentence(f, 'relChurn', 30)).toBe('Rewritten about 3× in 30 days');
  });

  it('puts the numbers in the detail line: "… than X% of files", never "top N"', () => {
    const f = file();
    expect(detail(f, 'frequency')).toBe('more often than 98% of files');
    expect(detail(f, 'complexity')).toBe('deeper than 95% of files');
    expect(detail(f, 'authors')).toBe('more than 70% of files');
    expect(detail(f, 'relChurn')).toBe('~1,200 lines added or removed vs 400 lines today');
    expect(detail(f, 'fixRatio')).toBe('16 of 41 changes');
    for (const c of COMPONENTS) expect(detail(f, c)).not.toMatch(/\btop\b/);
  });

  it('words churn as a rewrite factor, or a share below one rewrite', () => {
    expect(sentence(file({ churn: 1000, loc: 525 }), 'relChurn', 90)).toBe(
      'Rewritten about 2× in 90 days',
    );
    expect(sentence(file({ churn: 520, loc: 400 }), 'relChurn', 90)).toBe(
      'Rewritten about 1.5× in 90 days',
    );
    expect(sentence(file({ churn: 160, loc: 400 }), 'relChurn', 90)).toBe(
      'About 40% of it rewritten in 90 days',
    );
    expect(detail(file({ churn: 1003, loc: 525 }), 'relChurn')).toBe(
      '~1,000 lines added or removed vs 525 lines today',
    );
    expect(roughly(42)).toBe('42');
    expect(roughly(700)).toBe('700');
    expect(roughly(12_345)).toBe('~12,000');
  });

  it('says "Deeply nested" only when the file is deeper than most', () => {
    const shallow = file({ percentiles: { ...file().percentiles, complexity: 0.3 }, maxDepth: 2 });
    expect(sentence(shallow, 'complexity', 90)).toBe('Nesting depth 2');
  });

  it('handles singulars and extreme percentiles', () => {
    expect(sentence(file({ commits: 1 }), 'frequency', 30)).toBe('Changed once in 30 days');
    expect(sentence(file({ authors: 1 }), 'authors', 30)).toBe('Only 1 person edited it');
    const top = file({ percentiles: { ...file().percentiles, complexity: 1 } });
    expect(detail(top, 'complexity')).toBe('deeper than 99% of files');
    const bottom = file({ percentiles: { ...file().percentiles, complexity: 0 } });
    expect(detail(bottom, 'complexity')).toBe('deeper than 1% of files');
  });

  it('maps every sentence back to its component (for the icon)', () => {
    for (const c of COMPONENTS) {
      expect(componentOf(sentence(file(), c, 90))).toBe(c);
      expect(componentOf(sentence(file({ authors: 1, commits: 1 }), c, 365))).toBe(c);
    }
    expect(componentOf('something else')).toBe('info');
  });
});

describe('sentences and notes', () => {
  it('top hotspots get at most 3 sentences of at most 120 characters', () => {
    const out = sentences(file(), ['frequency', 'complexity', 'authors', 'fixRatio'], 90);
    expect(out).toEqual([
      'Changed 41 times in 90 days',
      'Deeply nested code (depth 9)',
      '6 people edited it',
    ]);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(MAX_SENTENCE_LENGTH);
  });

  it('other files get at most 2 notes of at most 80 characters', () => {
    const out = notes(file(), ['fixRatio', 'relChurn', 'authors'], 365);
    expect(out).toEqual(['38% of changes were bug fixes', 'Rewritten about 3× in 365 days']);
    for (const s of out) expect(s.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
  });

  it('clips long text with an ellipsis', () => {
    expect(clip('abcdef', 4)).toBe('abc…');
    expect(clip('abc', 4)).toBe('abc');
    expect(clip('x'.repeat(300), MAX_SENTENCE_LENGTH)).toHaveLength(MAX_SENTENCE_LENGTH);
  });
});

describe('whyText', () => {
  it('says why each kind of unranked file is not ranked', () => {
    expect(whyText('few-commits', 1, 90)).toBe(
      'Not ranked yet: only 1 change in 90 days (needs 2).',
    );
    expect(whyText('few-commits', 0, 30)).toBe('Not ranked yet: no changes in 30 days (needs 2).');
    expect(whyText('small', 0, 90)).toBe('Not ranked: under 20 lines, too small to score.');
    expect(whyText('small', 0, 90, 50)).toBe('Not ranked: under 50 lines, too small to score.');
    expect(whyText('excluded', 3, 365)).toBe(
      'Not ranked: binary, too large or unreadable, so it was not measured.',
    );
  });

  it('names the kind of a non-code file and the setting that changes it', () => {
    expect(whyText('docs', 9, 90)).toBe('Not ranked: documentation (change with churnmap.rank).');
    expect(whyText('data', 9, 90)).toBe('Not ranked: data file (change with churnmap.rank).');
    expect(whyText('config', 9, 90)).toBe('Not ranked: configuration (change with churnmap.rank).');
    expect(whyText('asset', 9, 90)).toBe(
      'Not ranked: asset or other non-code file (change with churnmap.rank).',
    );
    expect(whyText('generated', 9, 90)).toBe(
      'Not ranked: generated file (change with churnmap.rank).',
    );
  });
});

describe('trendText', () => {
  it('names complexity with an arrow, and nothing when unknown', () => {
    expect(trendText('rising')).toBe('Complexity rising ↑');
    expect(trendText('falling')).toBe('Complexity falling ↓');
    expect(trendText('flat')).toBe('Complexity steady');
    expect(trendText('unknown')).toBe('');
    expect(TREND_TOOLTIP).toBe('compared with the start of the window');
    expect(peopleFact(2)).toBe('People 2');
  });
});
