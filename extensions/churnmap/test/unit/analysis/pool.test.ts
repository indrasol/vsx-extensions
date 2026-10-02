import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { measureFiles } from '../../../src/analysis/files.js';
import { measureBatch } from '../../../src/analysis/measureFile.js';
import { createWorkerPool, defaultPoolSize } from '../../../src/analysis/pool.js';

// The pool runs the *built* worker. `pnpm build` produces it; the verification builds first.
const WORKER = resolve(__dirname, '../../../dist/worker.js');
const hasWorker = existsSync(WORKER);
if (!hasWorker) {
  console.warn(`Skipping worker-pool tests: ${WORKER} is missing. Run \`pnpm build\` first.`);
}

function makeTree(count: number, linesPer: number): { root: string; paths: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'cm-pool-'));
  const paths: string[] = [];
  const body = Array.from(
    { length: linesPer },
    (_, i) => `${'  '.repeat(i % 4)}line ${String(i)}`,
  ).join('\n');
  for (let i = 0; i < count; i++) {
    const dir = `pkg${String(i % 50)}`;
    if (i < 50) mkdirSync(join(root, dir));
    const rel = `${dir}/file${String(i)}.ts`;
    writeFileSync(join(root, rel), `${body}\n// ${String(i)}\n`);
    paths.push(rel);
  }
  return { root, paths };
}

describe('defaultPoolSize', () => {
  it('is between 1 and 4', () => {
    expect(defaultPoolSize()).toBeGreaterThanOrEqual(1);
    expect(defaultPoolSize()).toBeLessThanOrEqual(4);
  });
});

describe.skipIf(!hasWorker)('worker pool (dist/worker.js)', () => {
  let tree: { root: string; paths: string[] };

  beforeAll(() => {
    tree = makeTree(300, 30);
  });

  afterAll(() => {
    rmSync(tree.root, { recursive: true, force: true });
  });

  it('measures 300 files in workers with the same results as in-process', async () => {
    const pool = createWorkerPool({ workerPath: WORKER, size: 3 });
    const viaPool = await measureFiles(tree.root, tree.paths, { maxBytes: 1 << 20 }, { pool });
    const inProcess = await measureBatch(tree.root, tree.paths, 1 << 20);
    expect(viaPool).toHaveLength(300);
    expect(viaPool).toEqual(inProcess);
    expect(viaPool[0]).toMatchObject({ loc: 31, maxDepth: 3 });
  });

  it('falls back to in-process measuring when the worker file is missing', async () => {
    const warnings: string[] = [];
    const pool = createWorkerPool({ workerPath: join(tree.root, 'no-such-worker.js') });
    const stats = await measureFiles(
      tree.root,
      tree.paths,
      { maxBytes: 1 << 20 },
      {
        pool,
        logger: { info: () => undefined, warn: (m) => warnings.push(m) },
      },
    );
    expect(stats).toEqual(await measureBatch(tree.root, tree.paths, 1 << 20));
    expect(warnings).toEqual([expect.stringContaining('worker not found')]);
  });

  it('falls back when a worker throws at start-up', async () => {
    const broken = join(tree.root, 'broken-worker.js');
    writeFileSync(broken, "throw new Error('boom');\n");
    const warnings: string[] = [];
    const stats = await measureFiles(
      tree.root,
      tree.paths.slice(0, 10),
      { maxBytes: 1 << 20 },
      {
        pool: createWorkerPool({ workerPath: broken, size: 2 }),
        logger: { info: () => undefined, warn: (m) => warnings.push(m) },
      },
    );
    expect(stats).toHaveLength(10);
    expect(stats.every((s) => s.loc === 31)).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it('falls back when a worker answers with nonsense', async () => {
    const odd = join(tree.root, 'odd-worker.js');
    writeFileSync(
      odd,
      "require('node:worker_threads').parentPort.on('message', (m) => { require('node:worker_threads').parentPort.postMessage({ id: m.id, error: 'nope' }); });\n",
    );
    const warnings: string[] = [];
    const stats = await measureFiles(
      tree.root,
      tree.paths.slice(0, 3),
      { maxBytes: 1 << 20 },
      {
        pool: createWorkerPool({ workerPath: odd }),
        logger: { info: () => undefined, warn: (m) => warnings.push(m) },
      },
    );
    expect(stats).toHaveLength(3);
    expect(warnings[0]).toContain('nope');
  });

  it('stops the workers and rejects with kind aborted when the signal fires', async () => {
    const controller = new AbortController();
    const pool = createWorkerPool({ workerPath: WORKER, size: 2 });
    const run = measureFiles(
      tree.root,
      tree.paths,
      { maxBytes: 1 << 20 },
      {
        pool,
        signal: controller.signal,
        batchSize: 10,
        onProgress: () => {
          controller.abort();
        },
      },
    );
    await expect(run).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('resolves immediately for no batches and rejects an already-aborted signal', async () => {
    const pool = createWorkerPool({ workerPath: WORKER });
    await expect(
      pool.measure(tree.root, [], 1, undefined, () => undefined),
    ).resolves.toBeUndefined();
    const controller = new AbortController();
    controller.abort();
    await expect(
      pool.measure(tree.root, [['a']], 1, controller.signal, () => undefined),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe.skipIf(!hasWorker || Boolean(process.env.CHURNMAP_SKIP_PERF))('performance', () => {
  let tree: { root: string; paths: string[] };

  beforeAll(() => {
    tree = makeTree(20_000, 30);
  }, 120_000);

  afterAll(() => {
    rmSync(tree.root, { recursive: true, force: true });
  });

  it('measures 20 000 files of ~30 lines through the pool in under 4 s', async () => {
    const pool = createWorkerPool({ workerPath: WORKER });
    const start = performance.now();
    const stats = await measureFiles(tree.root, tree.paths, { maxBytes: 1 << 20 }, { pool });
    const elapsed = performance.now() - start;
    console.log(
      `      20k-file measure: ${elapsed.toFixed(0)} ms with ${String(defaultPoolSize())} workers`,
    );
    expect(stats).toHaveLength(20_000);
    expect(stats.every((s) => s.skipped === undefined && s.loc === 31)).toBe(true);
    expect(elapsed).toBeLessThan(4000);
  }, 30_000);
});
