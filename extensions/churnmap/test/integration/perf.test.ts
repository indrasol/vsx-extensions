import * as assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';

// Only in the `perf` configuration (scripts/perf-real.mjs): the workspace is a real repository
// (CHURNMAP_PERF_REPO) and the numbers go to CHURNMAP_PERF_OUT as JSON. It times what a user
// waits for: Build city from an empty cache, then the city drawn and the camera orbited.
const EXTENSION_ID = 'Indrasol.churnmap';

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

suite('performance on a real repository', () => {
  test('build from an empty cache, draw the city, orbit, rebuild from the cache', async function () {
    this.timeout(900_000);
    const testApi = await api();
    const activationMs = testApi.__activationMs;
    await vscode.commands.executeCommand('churnmap.clearCache');

    const start = performance.now();
    await vscode.commands.executeCommand('churnmap.build');
    const buildMs = performance.now() - start;
    const summary = testApi.__lastBuildSummary();
    const result = testApi.__analysis();
    assert.ok(summary && result, 'the build produced no result');
    assert.equal(summary.cached, false);

    const rendered = testApi.__city.nextMessage('rendered', 300_000);
    await vscode.commands.executeCommand('churnmap.open');
    const message = await rendered;
    assert.equal(message.type, 'rendered');
    const cityMs = performance.now() - start;

    const bench = testApi.__city.nextMessage('test:stats', 120_000);
    assert.ok(testApi.__city.post({ type: 'test:bench', frames: 240 }), 'no ready city panel');
    const orbit = await bench;
    assert.equal(orbit.type, 'test:stats');

    const cachedStart = performance.now();
    await vscode.commands.executeCommand('churnmap.build');
    const cachedMs = performance.now() - cachedStart;
    assert.equal(testApi.__lastBuildSummary()?.cached, true);

    const numbers = {
      vscode: vscode.version,
      activationMs: Math.round(activationMs * 10) / 10,
      files: result.files.length,
      commits: result.commitCount,
      hotspots: result.top.length,
      buildMs: Math.round(buildMs),
      cityAndHotspotsMs: Math.round(cityMs),
      buildings: message.buildings,
      firstFrameMs: message.ms,
      orbit: orbit.stats,
      cachedBuildMs: Math.round(cachedMs * 10) / 10,
      timings: result.timings,
    };
    console.log(`      perf: ${JSON.stringify(numbers)}`);
    const out = process.env.CHURNMAP_PERF_OUT;
    if (out) writeFileSync(out, `${JSON.stringify(numbers, null, 2)}\n`);
  });
});
