import { parentPort } from 'node:worker_threads';
import { measureBatch } from './measureFile.js';
import type { WorkerRequest, WorkerResponse } from './pool.js';

// Worker entry (bundled to dist/worker.js): measures one batch of paths per message.
// It reads files only; it never starts a process.
const port = parentPort;
if (port) {
  port.on('message', (request: WorkerRequest) => {
    measureBatch(request.repoRoot, request.paths, request.maxBytes).then(
      (stats) => {
        port.postMessage({ id: request.id, stats } satisfies WorkerResponse);
      },
      (err: unknown) => {
        port.postMessage({ id: request.id, error: String(err) } satisfies WorkerResponse);
      },
    );
  });
}
