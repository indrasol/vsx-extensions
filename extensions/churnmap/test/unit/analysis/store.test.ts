import { describe, expect, it } from 'vitest';
import type { AnalysisResult, FileScore, IgnoredFile } from '../../../src/analysis/model.js';
import { rank } from '../../../src/analysis/score.js';
import { AnalysisStore } from '../../../src/analysis/store.js';

const file = (path: string, score: number): FileScore => ({
  path,
  loc: 40,
  commits: 5,
  churn: 10,
  relChurn: 1,
  frequency: 1,
  complexity: 1,
  maxDepth: 2,
  authors: 1,
  fixRatio: 0,
  percentiles: { relChurn: 0.5, frequency: 0.5, complexity: 0.5, authors: 0.5, fixRatio: 0.5 },
  score,
  eligible: true,
  owners: [],
  weekly: [],
});

describe('AnalysisStore', () => {
  it('holds the latest result and notifies until disposed', () => {
    const store = new AnalysisStore();
    const seen: (number | undefined)[] = [];
    const sub = store.onDidChange((r) => seen.push(r?.commitCount));
    const result = { commitCount: 7 } as AnalysisResult;
    store.set(result);
    expect(store.get()).toBe(result);
    store.set(undefined);
    sub.dispose();
    store.set(result);
    expect(seen).toEqual([7, undefined]);
    store.dispose();
  });

  it('computes the layout lazily, once per result', () => {
    const store = new AnalysisStore();
    expect(store.getLayout()).toBeUndefined();
    const file = (path: string, rank: number) => ({ path, loc: 40, score: 90 - rank });
    const result = {
      files: [file('src/a.ts', 1), file('src/b.ts', 2)],
      top: [{ rank: 1, file: file('src/a.ts', 1) }],
    } as unknown as AnalysisResult;
    store.set(result);
    const layout = store.getLayout();
    expect(layout?.buildings).toHaveLength(2);
    expect(layout?.buildings.find((b) => b.path === 'src/a.ts')?.rank).toBe(1);
    expect(store.getLayout()).toBe(layout);
    store.set({ ...result });
    expect(store.getLayout()).not.toBe(layout);
    store.set(undefined);
    expect(store.getLayout()).toBeUndefined();
  });

  it('applies ignores on read: out of top and the glow, marked in files, cache result untouched', () => {
    const store = new AnalysisStore();
    const files = [file('a.ts', 90), file('b.ts', 80), file('c.ts', 70)];
    const top = rank(files, 90).map((h) => ({ ...h, trend: 'rising' as const }));
    const result = { files, top, window: 90 } as unknown as AnalysisResult;
    let ignored: IgnoredFile[] = [];
    store.setIgnoreSource(() => ignored);
    store.set(result);
    expect(store.get()).toBe(result);
    const plain = store.getLayout();
    expect(plain?.buildings.find((b) => b.path === 'a.ts')?.rank).toBe(1);

    const seen: (string | undefined)[] = [];
    store.onDidChange((r) => seen.push(r?.top[0]?.file.path));
    ignored = [{ path: 'a.ts', reason: 'later', until: Date.now() + 1000 }];
    store.ignoresChanged();
    expect(seen).toEqual(['b.ts']);
    const derived = store.get();
    expect(derived?.top.map((h) => [h.rank, h.file.path, h.trend])).toEqual([
      [1, 'b.ts', 'rising'],
      [2, 'c.ts', 'rising'],
    ]);
    expect(derived?.files.find((f) => f.path === 'a.ts')?.ignored).toBe(true);
    expect(derived?.files.find((f) => f.path === 'b.ts')?.ignored).toBeUndefined();
    expect(store.get()).toBe(derived); // memoised while nothing changes
    expect(store.raw()).toBe(result);
    expect(result.top[0]?.file.path).toBe('a.ts'); // the analysis itself is not changed
    expect(result.files[0]?.ignored).toBeUndefined();
    const layout = store.getLayout();
    expect(layout?.buildings.find((b) => b.path === 'a.ts')?.rank).toBeUndefined();
    expect(layout?.buildings.find((b) => b.path === 'b.ts')?.rank).toBe(1);
    expect(store.ignored()).toEqual(ignored);

    ignored = [];
    store.ignoresChanged();
    expect(store.get()).toBe(result);
  });

  it('gives a file promoted into the top an unknown trend', () => {
    const store = new AnalysisStore();
    const files = Array.from({ length: 21 }, (_, i) =>
      file(`f${String(i).padStart(2, '0')}`, 100 - i),
    );
    const top = rank(files, 90).map((h) => ({ ...h, trend: 'flat' as const }));
    store.set({ files, top, window: 90 } as unknown as AnalysisResult);
    store.setIgnoreSource(() => [{ path: 'f00', reason: '', until: Number.MAX_SAFE_INTEGER }]);
    const derived = store.get();
    expect(derived?.top).toHaveLength(20);
    expect(derived?.top.at(-1)).toMatchObject({ rank: 20, trend: 'unknown' });
    expect(derived?.top[0]).toMatchObject({ rank: 1, trend: 'flat' });
    expect(derived?.top.at(-1)?.file.path).toBe('f20');
  });

  it('counts changes in version', () => {
    const store = new AnalysisStore();
    const v = store.version;
    store.set(undefined);
    store.ignoresChanged();
    expect(store.version).toBe(v + 2);
  });
});
