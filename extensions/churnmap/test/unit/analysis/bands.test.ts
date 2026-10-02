import { describe, expect, it } from 'vitest';
import {
  BAND_RULES,
  bandAt,
  bandOfFile,
  bandSizes,
  HEAT_RANGES,
  HOTSPOT_SHARE,
  MAX_HOTSPOTS,
  MIN_HOTSPOTS,
  WATCH_SHARE,
  withBands,
} from '../../../src/analysis/bands.js';
import type { FileScore } from '../../../src/analysis/model.js';
import { rank } from '../../../src/analysis/score.js';
import { bandOfHeat } from '../../../src/city/palette.js';

function file(path: string, score: number, over: Partial<FileScore> = {}): FileScore {
  return {
    path,
    loc: 100,
    commits: 5,
    churn: 100,
    relChurn: 1,
    frequency: 1,
    complexity: 1,
    maxDepth: 3,
    authors: 1,
    fixRatio: 0,
    percentiles: { relChurn: 0, frequency: 0, complexity: 0, authors: 0, fixRatio: 0 },
    score,
    eligible: true,
    owners: [],
    weekly: [],
    ...over,
  };
}

/** `n` ranked files with falling scores. */
function ranked(n: number, top = 84): FileScore[] {
  return Array.from({ length: n }, (_, i) =>
    file(`src/f${String(i).padStart(4, '0')}.ts`, Math.max(0, top - (i * top) / n)),
  );
}

function counts(files: readonly FileScore[]): Record<string, number> {
  const out: Record<string, number> = { hotspot: 0, watch: 0, stable: 0 };
  for (const f of files) if (f.band) out[f.band] = (out[f.band] ?? 0) + 1;
  return out;
}

describe('relative bands', () => {
  it('Hotspot is the top 5 % (at least 3, at most 20), Watch the next 15 %, Stable the rest', () => {
    expect(bandSizes(10)).toEqual({ hotspot: 3, watch: 2, stable: 5 });
    expect(bandSizes(60)).toEqual({ hotspot: 3, watch: 9, stable: 48 });
    expect(bandSizes(400)).toEqual({ hotspot: 20, watch: 60, stable: 320 });
    expect(bandSizes(1000)).toEqual({ hotspot: 20, watch: 150, stable: 830 });
    expect(bandSizes(2)).toEqual({ hotspot: 2, watch: 0, stable: 0 });
    expect(bandSizes(0)).toEqual({ hotspot: 0, watch: 0, stable: 0 });
    expect([HOTSPOT_SHARE, MIN_HOTSPOTS, MAX_HOTSPOTS, WATCH_SHARE]).toEqual([0.05, 3, 20, 0.15]);
  });

  it.each([10, 60, 400])('assigns the band counts for %i ranked files', (n) => {
    const files = withBands(ranked(n));
    expect(counts(files)).toEqual(bandSizes(n));
    // Positions follow the ranking, 1..n, and bands never go back up.
    const order = [...files].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    expect(order.map((f) => f.position)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    const bands = order.map((f) => f.band);
    expect(bands.lastIndexOf('hotspot')).toBeLessThan(
      bands.indexOf('watch') === -1 ? n : bands.indexOf('watch'),
    );
    expect(bands.lastIndexOf('watch')).toBeLessThan(bands.indexOf('stable'));
  });

  it('#1 is always a Hotspot whenever at least one file ranks, whatever its score', () => {
    for (const [n, top] of [
      [1, 12],
      [2, 40],
      [5, 60],
      [60, 84],
      [400, 30],
    ] as const) {
      const files = withBands(ranked(n, top));
      const first = rank(files, 90)[0];
      expect(first?.file.band, `${String(n)} files, top score ${String(top)}`).toBe('hotspot');
      expect(bandAt(1, n)).toBe('hotspot');
      // …and gets the hottest colour.
      expect(first?.file.heat).toBe(100);
    }
  });

  it('heat stays inside its band’s range, so colour and label agree', () => {
    const files = withBands(ranked(400));
    for (const f of files) {
      const band = f.band ?? 'stable';
      const [lo, hi] = HEAT_RANGES[band];
      expect(f.heat).toBeGreaterThanOrEqual(lo);
      expect(f.heat).toBeLessThanOrEqual(hi);
      expect(bandOfHeat(f.heat ?? 0)).toBe(band);
    }
  });

  it('leaves unranked files out; an ignored file moves the others up and keeps a calm heat', () => {
    const files = [
      file('a.ts', 90),
      file('b.ts', 80),
      file('c.ts', 70),
      file('d.ts', 60),
      file('docs.md', 0, { eligible: false, why: 'docs' }),
    ];
    const plain = withBands(files);
    expect(plain.find((f) => f.path === 'docs.md')).not.toHaveProperty('band');
    expect(plain.map((f) => f.band)).toEqual(['hotspot', 'hotspot', 'hotspot', 'watch', undefined]);
    const ignoring = withBands(files, new Set(['a.ts']));
    expect(ignoring.map((f) => f.position)).toEqual([undefined, 1, 2, 3, undefined]);
    expect(ignoring[0]?.band).toBeUndefined();
    expect(ignoring[0]?.heat).toBeLessThanOrEqual(HEAT_RANGES.stable[1]);
    expect(bandOfFile(ignoring[0] ?? file('x', 0))).toBe('stable');
  });

  it('is idempotent and never depends on input order', () => {
    const files = ranked(60);
    const once = withBands(files);
    expect(withBands(once)).toEqual(once);
    const reversed = withBands([...files].reverse());
    expect(new Map(reversed.map((f) => [f.path, f.band]))).toEqual(
      new Map(once.map((f) => [f.path, f.band])),
    );
  });

  it('words the rules the legend and explainer show', () => {
    expect(BAND_RULES.hotspot).toBe(
      `top ${String(HOTSPOT_SHARE * 100)} % of your code files (at least ${String(MIN_HOTSPOTS)}, at most ${String(MAX_HOTSPOTS)})`,
    );
    expect(BAND_RULES.watch).toBe(`the next ${String(WATCH_SHARE * 100)} %`);
  });
});
