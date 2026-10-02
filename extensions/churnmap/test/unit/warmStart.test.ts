import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AnalysisCache } from '../../src/analysis/cache.js';
import type { AnalysisResult } from '../../src/analysis/model.js';
import { type AnalysisSettings, settingsKey } from '../../src/analysis/pipeline.js';
import { AnalysisStore } from '../../src/analysis/store.js';
import { warmStart, type WarmStartDeps } from '../../src/warmStart.js';

const HEAD = 'a'.repeat(40);
const ROOT = '/repos/shop';
const settings: AnalysisSettings = { exclude: [], maxFiles: 20_000, fixKeywords: 'fix' };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function result(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    version: 4,
    repoRoot: ROOT,
    head: HEAD,
    window: 90,
    generatedAt: '2026-09-30T00:00:00.000Z',
    shallow: false,
    commitCount: 3,
    files: [],
    top: [],
    excludedCount: 0,
    capped: false,
    settingsKey: settingsKey(settings),
    timings: { total: 120 },
    ...over,
  };
}

function deps(over: Partial<WarmStartDeps> = {}): WarmStartDeps & { logs: string[] } {
  const storageDir = mkdtempSync(join(tmpdir(), 'cm-warm-'));
  dirs.push(storageDir);
  const logs: string[] = [];
  return {
    store: new AnalysisStore(),
    storageDir,
    folders: () => Promise.resolve([ROOT]),
    trusted: true,
    window: 90,
    settings,
    logger: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    readHead: () => Promise.resolve({ repoRoot: ROOT, head: HEAD }),
    logs,
    ...over,
  };
}

describe('warmStart', () => {
  it('loads the cached result for root + HEAD into the store, with timings.cache set', async () => {
    const d = deps();
    await new AnalysisCache(d.storageDir).write(result());
    const { outcome, ms } = await warmStart(d);
    expect(outcome).toBe('loaded');
    expect(ms).toBeLessThan(500);
    const loaded = d.store.get();
    expect(loaded?.commitCount).toBe(3);
    expect(loaded?.timings.total).toBe(120);
    expect(typeof loaded?.timings.cache).toBe('number');
    expect(d.logs).toHaveLength(1);
    expect(d.logs[0]).toMatch(/^Warm start: loaded \(/);
  });

  it('does nothing in an untrusted workspace, not even reading .git', async () => {
    let reads = 0;
    const d = deps({
      trusted: false,
      readHead: () => {
        reads += 1;
        return Promise.resolve({ repoRoot: ROOT, head: HEAD });
      },
    });
    await new AnalysisCache(d.storageDir).write(result());
    expect((await warmStart(d)).outcome).toBe('untrusted');
    expect(reads).toBe(0);
    expect(d.store.get()).toBeUndefined();
  });

  it('gives up quietly without a folder, a readable repository, or a matching cache', async () => {
    expect((await warmStart(deps({ folders: () => Promise.resolve([]) }))).outcome).toBe(
      'no-folder',
    );
    expect((await warmStart(deps({ readHead: () => Promise.resolve(undefined) }))).outcome).toBe(
      'no-repository',
    );
    const d = deps();
    expect((await warmStart(d)).outcome).toBe('miss');
    await new AnalysisCache(d.storageDir).write(result({ head: 'b'.repeat(40) }));
    expect((await warmStart(d)).outcome).toBe('miss'); // another HEAD
    await new AnalysisCache(d.storageDir).write(result({ settingsKey: 'other' }));
    expect((await warmStart(d)).outcome).toBe('miss'); // other settings
    expect((await warmStart({ ...d, window: 30 })).outcome).toBe('miss'); // other window
    expect(d.store.get()).toBeUndefined();
  });

  it('tries each folder in order and loads the first one with a cached analysis', async () => {
    const heads: Record<string, string> = { '/w/docs': 'd'.repeat(40), [ROOT]: HEAD };
    const tried: string[] = [];
    const d = deps({
      folders: () => Promise.resolve(['/w/none', '/w/docs', ROOT, '/w/later']),
      readHead: (folder) => {
        tried.push(folder);
        const head = heads[folder];
        return Promise.resolve(head === undefined ? undefined : { repoRoot: folder, head });
      },
    });
    await new AnalysisCache(d.storageDir).write(result());
    expect((await warmStart(d)).outcome).toBe('loaded');
    expect(tried).toEqual(['/w/none', '/w/docs', ROOT]);
    expect(d.store.get()?.repoRoot).toBe(ROOT);
  });

  it('never overwrites a result that arrived while it was reading', async () => {
    const store = new AnalysisStore();
    const built = result({ commitCount: 99 });
    const d = deps({
      store,
      readHead: () => {
        store.set(built); // a build (or Clear cache) finished meanwhile
        return Promise.resolve({ repoRoot: ROOT, head: HEAD });
      },
    });
    await new AnalysisCache(d.storageDir).write(result());
    expect((await warmStart(d)).outcome).toBe('superseded');
    expect(store.get()).toBe(built);
  });
});
