import { describe, expect, it } from 'vitest';
import {
  copiedMessage,
  hotspotsMarkdown,
  localDate,
  tableCell,
} from '../../../src/panel/markdown.js';
import { hotspot } from './helpers.js';

describe('hotspotsMarkdown', () => {
  it('writes a header, a six-column table in rank order and the credit line', () => {
    const md = hotspotsMarkdown({
      repoName: 'shop',
      window: 90,
      date: '2026-09-30',
      top: [
        hotspot(1, 'billing/invoice.ts', { score: 91.2 }),
        hotspot(2, 'api/handler.ts', { trend: 'unknown', owners: [] }),
      ],
    });
    expect(md.split('\n')).toEqual([
      '**Churnmap hotspots** — shop · last 90 days · 2026-09-30',
      '',
      '| # | File | Score | Trend | Why | Owners |',
      '| --: | --- | --: | --- | --- | --- |',
      '| 1 | billing/invoice.ts | 91 (Hotspot) | Complexity rising ↑ | Changed 41 times in 90 days; Rewritten about 2× in 90 days | alice, bob |',
      '| 2 | api/handler.ts | 82 (Hotspot) | — | Changed 41 times in 90 days; Rewritten about 2× in 90 days |  |',
      '',
      'Made with Churnmap · Indrasol Labs',
      '',
    ]);
  });

  it('escapes pipes and flattens line breaks so a cell cannot break the table', () => {
    const md = hotspotsMarkdown({
      repoName: 'a|b',
      window: 30,
      date: '2026-01-02',
      top: [hotspot(1, 'odd|name.ts', { owners: ['x|y'], reasons: ['one\ntwo', 'back\\slash'] })],
    });
    expect(md).toContain('— a\\|b · last 30 days');
    expect(md).toContain(
      '| 1 | odd\\|name.ts | 82 (Hotspot) | Complexity rising ↑ | one two; back\\\\slash | x\\|y |',
    );
    // Every table row has exactly seven unescaped pipes.
    for (const row of md.split('\n').filter((l) => l.startsWith('|'))) {
      expect(row.replace(/\\\\/g, '').replace(/\\\|/g, '').split('|')).toHaveLength(8);
    }
    expect(tableCell('  a \t b  ')).toBe('a b');
  });

  it('says there is nothing yet for an empty result', () => {
    expect(hotspotsMarkdown({ repoName: 'r', window: 365, date: '2026-09-30', top: [] })).toBe(
      '**Churnmap hotspots** — r · last 365 days · 2026-09-30\n\nNo hotspots yet.\n\nMade with Churnmap · Indrasol Labs\n',
    );
  });

  it('formats the local date and the copied message', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(copiedMessage(20)).toBe('Copied 20 hotspots as Markdown.');
    expect(copiedMessage(1)).toBe('Copied 1 hotspot as Markdown.');
  });
});
