import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AnalysisCache, normalizeRoot } from '../../../src/analysis/cache.js';
import type { AnalysisResult } from '../../../src/analysis/model.js';

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    version: 4,
    repoRoot: '/work/repo',
    head: 'a'.repeat(40),
    window: 90,
    generatedAt: '2026-09-30T00:00:00.000Z',
    shallow: false,
    commitCount: 3,
    files: [],
    top: [],
    excludedCount: 0,
    capped: false,
    settingsKey: 'k1',
    timings: { total: 5 },
    ...overrides,
  };
}

describe('AnalysisCache', () => {
  let storage: string;
  let cache: AnalysisCache;

  beforeEach(() => {
    storage = mkdtempSync(join(tmpdir(), 'cm-cache-'));
    cache = new AnalysisCache(storage);
  });

  afterEach(() => {
    rmSync(storage, { recursive: true, force: true });
  });

  it('keys files by sha1(repoRoot) and window under <storage>/cache', () => {
    expect(AnalysisCache.key('/work/repo', 90)).toMatch(/^[0-9a-f]{40}-90\.json$/);
    expect(AnalysisCache.key('/work/repo', 30)).not.toBe(AnalysisCache.key('/work/repo', 90));
    expect(cache.file('/work/repo', 90).startsWith(join(storage, 'cache'))).toBe(true);
  });

  it('round-trips a result for the same HEAD and settings', async () => {
    await cache.write(result());
    expect(await cache.read('/work/repo', 90, 'a'.repeat(40), 'k1')).toEqual(result());
    expect(await cache.read('/work/repo', 90, 'a'.repeat(40))).toEqual(result());
    expect(readdirSync(join(storage, 'cache'))).toHaveLength(1); // no temp files left
  });

  it('misses when HEAD changes, settings change, or for another window', async () => {
    await cache.write(result());
    expect(await cache.read('/work/repo', 90, 'b'.repeat(40), 'k1')).toBeUndefined();
    expect(await cache.read('/work/repo', 90, 'a'.repeat(40), 'k2')).toBeUndefined();
    expect(await cache.read('/work/repo', 30, 'a'.repeat(40), 'k1')).toBeUndefined();
  });

  it('misses on another version (older caches, without relative bands, are ignored) and deletes a corrupt file', async () => {
    mkdirSync(join(storage, 'cache'), { recursive: true });
    const file = cache.file('/work/repo', 90);
    for (const version of [1, 2, 3, 5]) {
      writeFileSync(file, JSON.stringify({ ...result(), version }));
      expect(await cache.read('/work/repo', 90, 'a'.repeat(40))).toBeUndefined();
      expect(existsSync(file)).toBe(true);
    }

    writeFileSync(file, '{"version": 1, "head": ');
    expect(await cache.read('/work/repo', 90, 'a'.repeat(40))).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });

  it('readAnyHead returns a result for any HEAD (stale detection) and never deletes', async () => {
    expect(await cache.readAnyHead('/work/repo', 90)).toBeUndefined();
    await cache.write(result());
    expect((await cache.readAnyHead('/work/repo', 90))?.head).toBe('a'.repeat(40));
    expect(await cache.read('/work/repo', 90, 'b'.repeat(40))).toBeUndefined();
    expect(await cache.readAnyHead('/work/repo', 30)).toBeUndefined();
    writeFileSync(cache.file('/work/repo', 90), '{ corrupt');
    expect(await cache.readAnyHead('/work/repo', 90)).toBeUndefined();
    expect(existsSync(cache.file('/work/repo', 90))).toBe(true);
  });

  it('overwrites atomically and clear() removes the folder', async () => {
    await cache.write(result({ commitCount: 1 }));
    await cache.write(result({ commitCount: 2 }));
    expect((await cache.read('/work/repo', 90, 'a'.repeat(40)))?.commitCount).toBe(2);
    await cache.clear();
    expect(existsSync(join(storage, 'cache'))).toBe(false);
    await cache.clear(); // idempotent
  });

  it('reports a failed write and leaves no temp file', async () => {
    mkdirSync(join(storage, 'cache'), { recursive: true });
    mkdirSync(cache.file('/work/repo', 90)); // a directory where the file should go
    await expect(cache.write(result())).rejects.toThrow();
    expect(readdirSync(join(storage, 'cache'))).toEqual([AnalysisCache.key('/work/repo', 90)]);
  });
});

describe('normalizeRoot', () => {
  it('uses forward slashes, drops a trailing slash, and folds case on Windows', () => {
    expect(normalizeRoot('C:\\Work\\Repo\\', 'win32')).toBe('c:/work/repo');
    expect(normalizeRoot('/Work/Repo/', 'darwin')).toBe('/Work/Repo');
    expect(AnalysisCache.key('/a/b', 90)).toBe(AnalysisCache.key('/a/b/', 90));
  });
});
