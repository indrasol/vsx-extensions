import { describe, expect, it } from 'vitest';
import { layoutCity } from '../../../src/city/layout.js';
import type { Building, District } from '../../../src/city/model.js';
import type { TopEntry } from '../../../src/city/protocol.js';
import {
  buildingCard,
  districtCard,
  districtTotals,
  ignoredLine,
  NO_RANKED_NOTE,
  pillText,
  placeCard,
  tipText,
} from '../../../webview/card.js';
import { summary } from '../../../webview/rail.js';
import { distanceFade, pickDistrictLabels } from '../../../webview/labels.js';
import { sparklinePoints } from '../../../webview/svg.js';

const building = (over: Partial<Building> = {}): Building => ({
  id: 0,
  path: 'src/billing/invoice.ts',
  rect: { x: 0, y: 0, w: 10, h: 10 },
  height: 1,
  loc: 1234,
  score: 91.26,
  heat: 100,
  position: 1,
  ...over,
});

const TOP: TopEntry = {
  path: 'src/billing/invoice.ts',
  rank: 1,
  score: 91.26,
  heat: 100,
  reasons: [
    'more often than 99% of files',
    'more than 95% of files',
    '~3,800 lines added or removed vs 1,234 lines today',
    'extra',
  ],
  sentences: [
    'Changed 212 times in 90 days',
    '6 people edited it',
    'Rewritten about 3× in 90 days',
    'extra sentence',
  ],
  weekly: [0, 2, 5, 1],
  authors: 6,
  trend: 'rising',
  parts: [],
};

describe('buildingCard', () => {
  it('top hotspots: rank, name, folder, meter, three sentences with numbers, facts, sparkline', () => {
    const card = buildingCard(building({ rank: 1 }), { top: TOP, window: 90 });
    expect(card).toEqual({
      kind: 'hotspot',
      rank: 1,
      name: 'invoice.ts',
      folder: 'src/billing/',
      score: 91.26,
      heat: 100,
      band: 'hotspot',
      sentences: [
        {
          icon: 'frequency',
          text: 'Changed 212 times in 90 days',
          detail: 'more often than 99% of files',
        },
        { icon: 'authors', text: '6 people edited it', detail: 'more than 95% of files' },
        {
          icon: 'relChurn',
          text: 'Rewritten about 3× in 90 days',
          detail: '~3,800 lines added or removed vs 1,234 lines today',
        },
      ],
      weekly: [0, 2, 5, 1],
      // People is a reason here, so the facts row leaves it out.
      facts: [
        { text: '1,234 lines' },
        { text: 'Complexity rising ↑', title: 'compared with the start of the window' },
      ],
      hint: 'Click to select · Double-click to open · A · AI prompt',
      askPath: 'src/billing/invoice.ts',
      openPath: 'src/billing/invoice.ts',
    });
  });

  it('shows "People N" in the facts row when authors is not a top reason', () => {
    const top = {
      ...TOP,
      sentences: ['Changed 212 times in 90 days'],
      authors: 2,
      trend: 'flat' as const,
    };
    expect(buildingCard(building({ rank: 1 }), { top, window: 90 }).facts).toEqual([
      { text: '1,234 lines' },
      { text: 'People 2' },
      { text: 'Complexity steady', title: 'compared with the start of the window' },
    ]);
  });

  it('the band follows heat (relative), not the raw score', () => {
    const card = buildingCard(building({ rank: 1, score: 84, heat: 100 }), {
      top: TOP,
      window: 90,
    });
    expect(card.band).toBe('hotspot');
    expect(buildingCard(building({ score: 90, heat: 30 }), { window: 90 }).band).toBe('stable');
  });

  it('collapses to a pill with its rank and name', () => {
    expect(pillText({ rank: 1, name: 'task_router.py' })).toBe('#1 task_router.py ›');
    expect(pillText({ name: 'notes.md' })).toBe('notes.md ›');
  });

  it('every drawn file can be opened from its pinned card; a folded block cannot', () => {
    expect(buildingCard(building({ why: 'docs' }), { window: 90 }).openPath).toBe(
      'src/billing/invoice.ts',
    );
    expect(buildingCard(building({ why: 'docs' }), { window: 90 }).hint).toBe(
      'Click to select · Double-click to open',
    );
    expect(
      buildingCard(building({ path: 'vendor/…', folded: { files: 3, loc: 90 } }), { window: 90 })
        .openPath,
    ).toBeUndefined();
  });

  it('unranked files show one friendly line and no meter', () => {
    const card = buildingCard(building({ score: 0, why: 'few-commits', commits: 1 }), {
      window: 90,
    });
    expect(card.kind).toBe('unranked');
    expect(card.score).toBeUndefined();
    expect(card.note).toBe('Not ranked yet: only 1 change in 90 days (needs 2).');
    expect(card.sentences).toEqual([]);
    expect(buildingCard(building({ why: 'small', loc: 5 }), { window: 30 }).note).toMatch(
      /too small/,
    );
  });

  it('other scoring files show their meter and short notes', () => {
    const card = buildingCard(building({ score: 64, heat: 70, position: 9 }), {
      notes: ['38% of changes were bug fixes', 'Only 1 person edited it', 'third'],
      window: 90,
    });
    expect(card.kind).toBe('scored');
    expect(card.band).toBe('watch');
    expect(card.rank).toBe(9);
    expect(card.sentences.map((s) => s.icon)).toEqual(['fixRatio', 'authors']);
    expect(card.askPath).toBe(card.kind === 'scored' ? 'src/billing/invoice.ts' : undefined);
  });

  it('only scored files can be asked about (not unranked or folded ones)', () => {
    expect(buildingCard(building({ why: 'docs' }), { window: 90 }).askPath).toBeUndefined();
    expect(
      buildingCard(building({ path: 'vendor/…', folded: { files: 3, loc: 90 } }), { window: 90 })
        .askPath,
    ).toBeUndefined();
  });

  it('folded leaves say how many files and to zoom in', () => {
    const card = buildingCard(
      building({ path: 'vendor/big/…', loc: 50_000, folded: { files: 812, loc: 50_000 } }),
      { window: 90 },
    );
    expect(card.facts).toEqual([{ text: '812 files' }, { text: '50,000 lines' }]);
    expect(card.hint).toMatch(/Zoom in/);
  });

  it('long folders are cut in the middle', () => {
    const path = `${'deep/'.repeat(20)}file.ts`;
    const card = buildingCard(building({ path }), { window: 90 });
    expect(card.name).toBe('file.ts');
    expect(card.folder.length).toBeLessThanOrEqual(48);
    expect(card.folder).toContain('…');
  });
});

describe('ignored buildings', () => {
  it('say why and until when on the card', () => {
    const entry = { path: 'src/a.ts', reason: 'rewrite in Q4', until: Date.UTC(2027, 0, 15, 12) };
    expect(ignoredLine(entry)).toBe('Ignored: rewrite in Q4 (until 2027-01-15)');
    expect(ignoredLine({ ...entry, reason: '' })).toBe(
      'Ignored: no reason given (until 2027-01-15)',
    );
    const card = buildingCard(building({}), { ignored: entry, window: 90 });
    expect(card.note).toBe('Ignored: rewrite in Q4 (until 2027-01-15)');
    expect(buildingCard(building({}), { window: 90 }).note).toBeUndefined();
  });
});

describe('district cards and totals', () => {
  const layout = layoutCity(
    [
      { path: 'src/a.ts', loc: 100, score: 10, heat: 12, position: 2 },
      { path: 'src/core/b.ts', loc: 50, score: 80, heat: 100, position: 1 },
      { path: 'README.md', loc: 5, score: 0, why: 'docs' },
      { path: 'docs/guide.md', loc: 90, score: 0, why: 'docs' },
    ],
    {},
    { 'src/core/b.ts': 1, 'src/a.ts': 2 },
  );
  const byPath = (p: string): District | undefined => layout.districts.find((d) => d.path === p);

  it('totals files, LOC, the highest score and the riskiest file over the subtree', () => {
    const totals = districtTotals(layout);
    const best = { name: 'b.ts', position: 1 };
    expect(totals[byPath('')?.id ?? -1]).toEqual({
      files: 4,
      loc: 245,
      maxScore: 80,
      maxHeat: 100,
      best,
    });
    expect(totals[byPath('src')?.id ?? -1]).toEqual({
      files: 2,
      loc: 150,
      maxScore: 80,
      maxHeat: 100,
      best,
    });
    expect(totals[byPath('docs')?.id ?? -1]).toEqual({
      files: 1,
      loc: 90,
      maxScore: 0,
      maxHeat: -1,
    });
  });

  it('names the riskiest file and its rank; a folder with nothing ranked says so, with no meter', () => {
    const totals = districtTotals(layout);
    const src = byPath('src');
    expect(src && districtCard(src, totals[src.id])).toMatchObject({
      kind: 'district',
      name: 'src/',
      band: 'hotspot',
      facts: [{ text: '2 files' }, { text: '150 lines' }],
      note: 'Riskiest file: b.ts (#1)',
    });
    const docs = byPath('docs');
    const card = docs && districtCard(docs, totals[docs.id]);
    expect(card?.note).toBe(NO_RANKED_NOTE);
    expect(card?.note).toBe('No ranked files here (documentation / data)');
    expect(card?.score).toBeUndefined();
    const root = layout.districts[0];
    expect(root && districtCard(root, undefined).name).toBe('Repository root');
  });

  it('while a card is pinned, other items get a one-line tooltip: name and rank', () => {
    const b = layout.buildings.find((x) => x.path === 'src/core/b.ts');
    const readme = layout.buildings.find((x) => x.path === 'README.md');
    expect(b && tipText(b)).toBe('#1 b.ts');
    expect(readme && tipText(readme)).toBe('README.md');
    const docs = byPath('docs');
    expect(docs && tipText(docs)).toBe('docs/');
  });
});

describe('placeCard', () => {
  it('sits below-right of the pointer and flips at the edges', () => {
    expect(placeCard(100, 100, 200, 80, 800, 600)).toEqual({ left: 114, top: 114 });
    expect(placeCard(750, 100, 200, 80, 800, 600)).toEqual({ left: 536, top: 114 });
    expect(placeCard(100, 580, 200, 80, 800, 600)).toEqual({ left: 114, top: 486 });
  });

  it('stays inside tiny bounds', () => {
    const p = placeCard(10, 10, 300, 200, 200, 100);
    expect(p.left).toBeGreaterThanOrEqual(4);
    expect(p.top).toBeGreaterThanOrEqual(4);
  });
});

describe('insights rail, labels and sparkline', () => {
  it('summarises a hotspot in its first sentence', () => {
    expect(summary(TOP)).toBe('Changed 212 times in 90 days.');
    expect(summary({ ...TOP, sentences: [], reasons: ['more than 95% of files'] })).toBe(
      'more than 95% of files.',
    );
  });

  it('labels the biggest top-level districts, at most 12', () => {
    const districts = Array.from({ length: 20 }, (_, i) => ({
      path: `d${String(i)}`,
      depth: 1,
      area: i,
    }));
    const chosen = pickDistrictLabels([...districts, { path: '', depth: 0, area: 999 }]);
    expect(chosen).toHaveLength(12);
    expect(chosen[0]?.path).toBe('d19');
    // Fewer than three top-level folders: the next level joins in.
    const nested = pickDistrictLabels([
      { path: 'src', depth: 1, area: 100 },
      { path: 'src/a', depth: 2, area: 60 },
      { path: 'src/b', depth: 2, area: 40 },
    ]);
    expect(nested.map((d) => d.path)).toEqual(['src', 'src/a', 'src/b']);
  });

  it('fades labels with distance', () => {
    expect(distanceFade(100, 200, 400)).toBe(1);
    expect(distanceFade(300, 200, 400)).toBeCloseTo(0.5, 6);
    expect(distanceFade(500, 200, 400)).toBe(0);
  });

  it('plots weekly commits bottom-up across the box', () => {
    expect(sparklinePoints([0, 2, 4], 120, 24, 2)).toEqual([
      [2, 22],
      [60, 12],
      [118, 2],
    ]);
    expect(sparklinePoints([], 120, 24)).toEqual([]);
    expect(sparklinePoints([3], 120, 24, 2)).toEqual([[60, 2]]);
  });
});
