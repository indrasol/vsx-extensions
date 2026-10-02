import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compareCodeUnits,
  listTrackedFiles,
  measureFiles,
  selectFiles,
} from '../../../src/analysis/files.js';
import { GitError, type RunGit } from '../../../src/analysis/gitProcess.js';
import { measureFile, resolveInside } from '../../../src/analysis/measureFile.js';
import type { FileStat } from '../../../src/analysis/model.js';
import type { MeasurePool } from '../../../src/analysis/pool.js';

describe('listTrackedFiles', () => {
  it('runs ls-files -z with "--" and parses NUL-separated UTF-8, sorted and de-duplicated', async () => {
    let seen: readonly string[] = [];
    const run: RunGit = (_git, args) => {
      seen = args;
      return Promise.resolve({
        stdout: Buffer.from('src/b.ts\0docs/ñandú/résumé.md\0src/a.ts\0src/a.ts\0win\\path.ts'),
        stderr: '',
      });
    };
    expect(await listTrackedFiles('/git', '/repo', '/hooks', undefined, run)).toEqual([
      'docs/ñandú/résumé.md',
      'src/a.ts',
      'src/b.ts',
      'win/path.ts',
    ]);
    expect(seen).toEqual(['ls-files', '-z', '--cached', '--exclude-standard', '--', '.']);
  });

  it('returns nothing for an empty repository', async () => {
    const run: RunGit = () => Promise.resolve({ stdout: Buffer.alloc(0), stderr: '' });
    expect(await listTrackedFiles('/git', '/repo', '/hooks', undefined, run)).toEqual([]);
  });
});

describe('selectFiles', () => {
  const paths = [
    'src/z.ts',
    'src/a.ts',
    'node_modules/x/index.js',
    'dist/extension.js',
    'web/app.min.js',
    'pnpm-lock.yaml',
    'generated/api.ts',
    'distance/metric.ts',
  ];

  it('applies built-ins, then user globs, and sorts', () => {
    expect(selectFiles(paths, { exclude: ['generated/**'], maxFiles: 100 })).toEqual({
      selected: ['distance/metric.ts', 'src/a.ts', 'src/z.ts'],
      excludedCount: 5,
      capped: false,
    });
  });

  it('keeps the first maxFiles after sorting and reports capped', () => {
    expect(selectFiles(paths, { exclude: [], maxFiles: 2 })).toEqual({
      selected: ['distance/metric.ts', 'generated/api.ts'],
      excludedCount: 4,
      capped: true,
    });
  });

  it('is not capped when exactly maxFiles remain', () => {
    expect(selectFiles(['a', 'b'], { exclude: [], maxFiles: 2 }).capped).toBe(false);
  });

  it('orders by code unit', () => {
    expect(['b', 'B', 'a', 'a'].sort(compareCodeUnits)).toEqual(['B', 'a', 'a', 'b']);
  });
});

describe('measuring files on disk', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cm-files-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/a.ts'), 'a\n  b\n    c\n');
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(2048));
    writeFileSync(join(root, 'logo.png'), Buffer.from([0x89, 0x50, 0, 0]));
    mkdirSync(join(root, 'submodule'));
    symlinkSync(join(root, 'src/a.ts'), join(root, 'link.ts'));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('measures text and skips too-large, binary, missing, directories and symlinks', async () => {
    const stats = await measureFiles(
      root,
      ['src/a.ts', 'big.txt', 'logo.png', 'missing.ts', 'submodule', 'link.ts', '../escape.ts'],
      { maxBytes: 1024 },
    );
    expect(stats).toEqual<FileStat[]>([
      { path: 'src/a.ts', bytes: 12, loc: 3, maxDepth: 2, meanDepth: 1, complexity: 1.6 },
      {
        path: 'big.txt',
        bytes: 2048,
        loc: 0,
        maxDepth: 0,
        meanDepth: 0,
        complexity: 0,
        skipped: 'too-large',
      },
      {
        path: 'logo.png',
        bytes: 4,
        loc: 0,
        maxDepth: 0,
        meanDepth: 0,
        complexity: 0,
        skipped: 'binary',
      },
      {
        path: 'missing.ts',
        bytes: 0,
        loc: 0,
        maxDepth: 0,
        meanDepth: 0,
        complexity: 0,
        skipped: 'unreadable',
      },
      {
        path: 'submodule',
        bytes: 0,
        loc: 0,
        maxDepth: 0,
        meanDepth: 0,
        complexity: 0,
        skipped: 'unreadable',
      },
      {
        path: 'link.ts',
        bytes: 0,
        loc: 0,
        maxDepth: 0,
        meanDepth: 0,
        complexity: 0,
        skipped: 'unreadable',
      },
      {
        path: '../escape.ts',
        bytes: 0,
        loc: 0,
        maxDepth: 0,
        meanDepth: 0,
        complexity: 0,
        skipped: 'unreadable',
      },
    ]);
  });

  it('reports progress per batch and keeps input order', async () => {
    const progress: number[] = [];
    const stats = await measureFiles(
      root,
      ['src/a.ts', 'logo.png', 'src/a.ts'],
      { maxBytes: 1024 },
      {
        batchSize: 1,
        onProgress: (measured) => progress.push(measured),
      },
    );
    expect(stats.map((s) => s.path)).toEqual(['src/a.ts', 'logo.png', 'src/a.ts']);
    expect(progress).toEqual([1, 2, 3]);
  });

  it('measures the rest in-process when the pool fails part-way, and logs once', async () => {
    const warnings: string[] = [];
    const pool: MeasurePool = {
      measure: async (repoRoot, batches, maxBytes, _signal, onBatch) => {
        onBatch(0, [
          { path: 'from-pool', bytes: 0, loc: 0, maxDepth: 0, meanDepth: 0, complexity: 0 },
        ]);
        await Promise.resolve();
        throw new Error(
          `worker crashed after 1 of ${String(batches.length)} (${repoRoot}, ${String(maxBytes)})`,
        );
      },
    };
    const stats = await measureFiles(
      root,
      ['x', 'src/a.ts'],
      { maxBytes: 1024 },
      {
        pool,
        batchSize: 1,
        logger: { info: () => undefined, warn: (m) => warnings.push(m) },
      },
    );
    expect(stats.map((s) => s.path)).toEqual(['from-pool', 'src/a.ts']);
    expect(stats[1]?.loc).toBe(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('measuring in-process');
  });

  it('rethrows an abort from the pool, and stops between batches when aborted', async () => {
    const pool: MeasurePool = {
      measure: () => Promise.reject(new GitError('aborted', 'cancelled')),
    };
    await expect(
      measureFiles(root, ['src/a.ts'], { maxBytes: 1024 }, { pool }),
    ).rejects.toMatchObject({
      kind: 'aborted',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      measureFiles(root, ['src/a.ts'], { maxBytes: 1024 }, { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('measureFile refuses paths outside the root', async () => {
    expect(resolveInside(root, '/etc/passwd')).toBeUndefined();
    expect(resolveInside(root, '')).toBeUndefined();
    expect((await measureFile(root, 'a/../../x', 10)).skipped).toBe('unreadable');
  });
});
