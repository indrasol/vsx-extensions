import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { abortedError } from './gitProcess.js';
import type { FileStat } from './model.js';

/** Host → worker: measure these repository-relative paths. */
export interface WorkerRequest {
  id: number;
  repoRoot: string;
  paths: string[];
  maxBytes: number;
}

/** Worker → host: the stats for request `id`, in path order, or why it failed. */
export type WorkerResponse = { id: number; stats: FileStat[] } | { id: number; error: string };

function isWorkerResponse(value: unknown): value is WorkerResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'number' &&
    (('stats' in value && Array.isArray(value.stats)) ||
      ('error' in value && typeof value.error === 'string'))
  );
}

/** Measures batches of paths somewhere other than the calling thread. */
export interface MeasurePool {
  /**
   * Resolves when every batch has been reported through `onBatch(index, stats)`. Rejects on
   * abort (a `GitError` of kind `aborted`) or when a worker cannot start or fails; batches that
   * were reported before the failure stay valid, so the caller can measure only the rest.
   */
  measure(
    repoRoot: string,
    batches: readonly (readonly string[])[],
    maxBytes: number,
    signal: AbortSignal | undefined,
    onBatch: (index: number, stats: FileStat[]) => void,
  ): Promise<void>;
}

export class PoolUnavailableError extends Error {
  override readonly name = 'PoolUnavailableError';
}

/** min(4, max(1, cores − 1)): leave a core for the editor. */
export function defaultPoolSize(): number {
  return Math.min(4, Math.max(1, os.availableParallelism() - 1));
}

export interface WorkerPoolOptions {
  /** Defaults to `worker.js` next to the running bundle (`dist/worker.js`). */
  workerPath?: string;
  size?: number;
}

/**
 * A pool of `worker_threads` workers started per `measure` call and terminated when it ends, so
 * no worker exists outside a build (and none at activation).
 */
export function createWorkerPool(opts: WorkerPoolOptions = {}): MeasurePool {
  const workerPath = opts.workerPath ?? path.join(__dirname, 'worker.js');
  const size = Math.max(1, opts.size ?? defaultPoolSize());

  return {
    measure(repoRoot, batches, maxBytes, signal, onBatch) {
      if (batches.length === 0) return Promise.resolve();
      if (signal?.aborted) return Promise.reject(abortedError());
      if (!existsSync(workerPath)) {
        return Promise.reject(new PoolUnavailableError(`worker not found: ${workerPath}`));
      }

      return new Promise<void>((resolve, reject) => {
        const workers: Worker[] = [];
        let nextBatch = 0;
        let reported = 0;
        let finished = false;

        const stop = (): void => {
          finished = true;
          signal?.removeEventListener('abort', onAbort);
          for (const worker of workers) void worker.terminate();
        };
        const fail = (err: unknown): void => {
          if (finished) return;
          stop();
          reject(err instanceof Error ? err : new PoolUnavailableError(String(err)));
        };
        const onAbort = (): void => {
          fail(abortedError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        const dispatch = (worker: Worker): void => {
          const batch = batches[nextBatch];
          if (!batch) return;
          const request: WorkerRequest = { id: nextBatch, repoRoot, paths: [...batch], maxBytes };
          nextBatch += 1;
          worker.postMessage(request);
        };

        for (let i = 0; i < Math.min(size, batches.length); i++) {
          let worker: Worker;
          try {
            worker = new Worker(workerPath);
          } catch (err) {
            fail(err);
            return;
          }
          workers.push(worker);
          worker.on('message', (message: unknown) => {
            if (finished) return;
            if (!isWorkerResponse(message)) {
              fail(new PoolUnavailableError('unexpected message from worker'));
              return;
            }
            if ('error' in message) {
              fail(new PoolUnavailableError(message.error));
              return;
            }
            onBatch(message.id, message.stats);
            reported += 1;
            if (reported === batches.length) {
              stop();
              resolve();
            } else {
              dispatch(worker);
            }
          });
          worker.on('error', fail);
          worker.on('exit', (code) => {
            if (!finished)
              fail(new PoolUnavailableError(`worker exited with code ${String(code)}`));
          });
          dispatch(worker);
        }
      });
    },
  };
}
