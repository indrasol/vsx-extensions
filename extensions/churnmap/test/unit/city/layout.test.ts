import { describe, expect, it } from 'vitest';
import { layoutCity } from '../../../src/city/layout.js';
import type { Layout, LayoutFile, Rect } from '../../../src/city/model.js';
import { buildTree, fileWeight, foldTree } from '../../../src/city/tree.js';

/** A deterministic pseudo-random generator, so synthetic repos are the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** `count` files spread over nested folders, like a real monorepo. */
export function syntheticFiles(count: number, seed = 1): LayoutFile[] {
  const rand = rng(seed);
  const files: LayoutFile[] = [];
  for (let i = 0; i < count; i++) {
    const depth = 1 + Math.floor(rand() * 5);
    const parts: string[] = [];
    for (let d = 0; d < depth; d++) parts.push(`d${String(d)}_${String(Math.floor(rand() * 6))}`);
    parts.push(`f${String(i)}.ts`);
    files.push({
      path: parts.join('/'),
      loc: Math.floor(rand() * 2000),
      score: Math.round(rand() * 1000) / 10,
    });
  }
  return files;
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = rng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function inside(inner: Rect, outer: Rect): boolean {
  const e = 0.011; // rects are rounded to 2 decimals
  return (
    inner.x >= outer.x - e &&
    inner.y >= outer.y - e &&
    inner.x + inner.w <= outer.x + outer.w + e &&
    inner.y + inner.h <= outer.y + outer.h + e
  );
}

const SMALL: LayoutFile[] = [
  { path: 'README.md', loc: 10, score: 0 },
  { path: 'src/core/engine.ts', loc: 800, score: 92 },
  { path: 'src/core/rules.ts', loc: 300, score: 70 },
  { path: 'src/api/handler.ts', loc: 400, score: 50 },
  { path: 'src/util/format.ts', loc: 60, score: 10 },
  { path: 'docs/guide.md', loc: 120, score: 0 },
];

describe('layoutCity', () => {
  it('makes folders districts and files buildings, nested inside their parents', () => {
    const layout = layoutCity(SMALL, {}, { 'src/core/engine.ts': 1 });
    expect(layout.width).toBe(1000);
    expect(layout.districts.map((d) => d.path)).toEqual([
      '',
      'src',
      'src/core',
      'src/api',
      'src/util',
      'docs',
    ]);
    expect(layout.buildings).toHaveLength(6);
    expect(layout.stats).toEqual({ files: 6, folded: 0, maxLoc: 800 });
    for (const district of layout.districts) {
      for (const id of district.buildings) {
        const b = layout.buildings[id];
        expect(b && inside(b.rect, district.rect)).toBe(true);
        expect(b?.path.startsWith(district.path)).toBe(true);
      }
      for (const id of district.children) {
        const child = layout.districts[id];
        expect(child && inside(child.rect, district.rect)).toBe(true);
        expect(child?.depth).toBe(district.depth + 1);
      }
    }
    const engine = layout.buildings[layout.byPath['src/core/engine.ts'] ?? -1];
    expect(engine?.rank).toBe(1);
    expect(engine?.height).toBe(1);
    expect(layout.buildings.find((b) => b.path === 'README.md')?.rank).toBeUndefined();
    // Every coordinate is rounded to 2 decimals.
    for (const b of layout.buildings) {
      for (const n of [b.rect.x, b.rect.y, b.rect.w, b.rect.h]) {
        expect(Math.round(n * 100) / 100).toBe(n);
      }
    }
  });

  it('orders siblings by weight, then path, and area follows max(loc, 20)', () => {
    const layout = layoutCity([
      { path: 'b.ts', loc: 5, score: 0 },
      { path: 'a.ts', loc: 1, score: 0 },
      { path: 'c.ts', loc: 100, score: 0 },
    ]);
    expect(layout.buildings.map((b) => b.path)).toEqual(['c.ts', 'a.ts', 'b.ts']);
    const [c, a, b] = layout.buildings.map((x) => x.rect.w * x.rect.h);
    expect(a).toBeCloseTo(b ?? 0, 0);
    expect((c ?? 0) / (a ?? 1)).toBeGreaterThan(3);
    expect(fileWeight(1)).toBe(20);
  });

  it('log and linear heights', () => {
    const files = [
      { path: 'big.ts', loc: 1000, score: 0 },
      { path: 'small.ts', loc: 10, score: 0 },
      { path: 'empty.ts', loc: 0, score: 0 },
    ];
    const log = layoutCity(files);
    const linear = layoutCity(files, { heightScale: 'linear' });
    const h = (l: Layout, p: string): number | undefined => l.buildings[l.byPath[p] ?? -1]?.height;
    expect(h(log, 'big.ts')).toBe(1);
    expect(h(log, 'small.ts')).toBeCloseTo(Math.log1p(10) / Math.log1p(1000), 4);
    expect(h(linear, 'small.ts')).toBe(0.01);
    expect(h(linear, 'empty.ts')).toBe(0);
    expect(layoutCity([{ path: 'z.ts', loc: 0, score: 0 }]).buildings[0]?.height).toBe(0);
  });

  it('is deterministic: shuffled input gives byte-identical JSON', () => {
    const files = syntheticFiles(3000, 7);
    const ranks = { [files[5]?.path ?? '']: 1, [files[9]?.path ?? '']: 2 };
    const a = JSON.stringify(layoutCity(files, {}, ranks));
    const b = JSON.stringify(layoutCity(shuffle(files, 99), {}, ranks));
    const c = JSON.stringify(layoutCity(shuffle(files, 3).reverse(), {}, ranks));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('folds 30 000 files to at most 10 000 buildings; every path still resolves', () => {
    const files = syntheticFiles(30_000, 11);
    const ranks = { [files[0]?.path ?? '']: 1 };
    const layout = layoutCity(files, {}, ranks);
    expect(layout.buildings.length).toBeLessThanOrEqual(10_000);
    expect(layout.stats.files).toBe(30_000);
    expect(layout.stats.folded).toBeGreaterThan(0);
    const folded = layout.buildings.filter((b) => b.folded);
    expect(folded.length).toBeGreaterThan(0);
    expect(folded.reduce((s, b) => s + (b.folded?.files ?? 0), 0)).toBe(layout.stats.folded);
    for (const file of files) {
      const b = layout.buildings[layout.byPath[file.path] ?? -1];
      expect(b, file.path).toBeDefined();
      if (b?.folded) {
        expect(b.path.endsWith('/…')).toBe(true);
        expect(file.path.startsWith(b.path.slice(0, -1))).toBe(true);
        expect(b.score).toBeGreaterThanOrEqual(file.score);
      } else {
        expect(b?.path).toBe(file.path);
      }
    }
    // The ranked file's building (folded or not) keeps its rank.
    expect(layout.buildings[layout.byPath[files[0]?.path ?? ''] ?? -1]?.rank).toBe(1);
  });

  // 100 ms on a developer laptop; shared CI runners (2 vCPUs, measured 120 ms on Windows) get 3×.
  const LAYOUT_BUDGET_MS = process.env.CI ? 300 : 100;

  it.skipIf(process.env.CHURNMAP_SKIP_PERF === '1')(
    `lays out 20 000 files in under ${String(LAYOUT_BUDGET_MS)} ms`,
    () => {
      const files = syntheticFiles(20_000, 5);
      layoutCity(files); // warm-up (JIT)
      const runs: number[] = [];
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        layoutCity(files, { maxBuildings: 20_000 });
        runs.push(performance.now() - start);
      }
      const best = Math.min(...runs);
      console.log(
        `      layout 20k files: ${runs.map((ms) => ms.toFixed(1)).join(' / ')} ms (best ${best.toFixed(1)})`,
      );
      expect(best).toBeLessThan(LAYOUT_BUDGET_MS);
    },
  );
});

describe('buildTree / foldTree', () => {
  it('totals loc, files, maxScore and weight per folder', () => {
    const root = buildTree(SMALL);
    expect(root.files).toBe(6);
    expect(root.loc).toBe(1690);
    expect(root.maxScore).toBe(92);
    expect(root.leaves).toBe(6);
    const src = root.children.find((c) => c.path === 'src');
    expect(src?.kind).toBe('folder');
    if (src?.kind === 'folder') {
      expect(src.files).toBe(4);
      expect(src.weight).toBe(800 + 300 + 400 + 60);
    }
    // README (10 LOC) weighs 20.
    expect(root.children.find((c) => c.path === 'README.md')?.weight).toBe(20);
  });

  it('folds deepest folders first, fewest files first, and never the root', () => {
    const files: LayoutFile[] = [
      { path: 'a/x/1.ts', loc: 10, score: 5 },
      { path: 'a/x/2.ts', loc: 10, score: 40 },
      { path: 'a/y/1.ts', loc: 10, score: 1 },
      { path: 'a/y/2.ts', loc: 10, score: 1 },
      { path: 'a/y/3.ts', loc: 10, score: 1 },
      { path: 'b/1.ts', loc: 10, score: 1 },
      { path: 'top.ts', loc: 10, score: 1 },
    ];
    // 7 leaves, cap 6: a/x (depth 2, 2 files) folds first.
    const once = foldTree(buildTree(files), 6);
    expect(once.leaves).toBe(6);
    const a = once.children.find((c) => c.path === 'a');
    expect(a?.kind === 'folder' && a.children.map((c) => c.path).sort()).toEqual(['a/x/…', 'a/y']);
    const leaf = a?.kind === 'folder' ? a.children.find((c) => c.kind === 'folded') : undefined;
    expect(leaf?.kind === 'folded' && [leaf.files, leaf.loc, leaf.score]).toEqual([2, 20, 40]);
    // Cap 1: every folder below the root that holds more than one building folds (a one-file
    // folder saves nothing); the root keeps its direct file and is never folded.
    const all = foldTree(buildTree(files), 1);
    expect(all.children.map((c) => `${c.kind}:${c.path}`).sort()).toEqual([
      'file:top.ts',
      'folded:a/…',
      'folder:b',
    ]);
    expect(all.leaves).toBe(3);
    // Under the cap nothing changes.
    expect(foldTree(buildTree(files), 100).leaves).toBe(7);
  });
});
