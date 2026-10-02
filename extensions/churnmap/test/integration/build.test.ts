import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const CACHED_BUDGET_MS = 200;

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

async function timedBuild(testApi: TestApi): Promise<{ ms: number; cached: boolean }> {
  const start = performance.now();
  await vscode.commands.executeCommand('churnmap.build');
  const ms = performance.now() - start;
  const summary = testApi.__lastBuildSummary();
  assert.ok(summary, 'build produced no summary');
  console.log(`      ${summary.message} (command ${ms.toFixed(1)} ms)`);
  return { ms, cached: summary.cached };
}

suite('build on the fixture repository', () => {
  test('ranks hotspots with reasons; the most-committed file is #1', async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.clearCache');
    const { cached } = await timedBuild(testApi);
    assert.equal(cached, false);

    const result = testApi.__analysis();
    assert.ok(result, 'the store has no result');
    assert.equal(result.window, 90);
    assert.equal(result.shallow, false);
    // 13 commits inside the window (one merge); the 120-day-old commit is outside it.
    assert.equal(result.commitCount, 13);
    // 7 tracked files; media/logo.png is binary (skipped); src/feature/flags.js has 1 commit.
    assert.equal(result.files.length, 7);
    assert.ok(result.top.length >= 3, `only ${String(result.top.length)} hotspots`);
    for (const hotspot of result.top) {
      assert.ok(hotspot.reasons.length >= 2, `${hotspot.file.path} has < 2 reasons`);
    }
    const first = result.top[0];
    const mostCommits = [...result.files].sort((a, b) => b.commits - a.commits)[0];
    assert.ok(first && mostCommits);
    assert.equal(first.file.path, mostCommits.path);
    assert.equal(first.file.path, 'src/core/engine.js');
    // Trend ran `git show` against the commit before the window: the engine got deeper.
    assert.equal(first.trend, 'rising');
    console.log(
      `      top: ${result.top.map((h) => `#${String(h.rank)} ${h.file.path} ${String(h.file.score)} [${h.reasons.map((r) => r.text).join('; ')}] ${h.trend}`).join(' | ')}`,
    );
  });

  test(`a second build comes from the cache in under ${String(CACHED_BUDGET_MS)} ms`, async () => {
    const { ms, cached } = await timedBuild(await api());
    assert.equal(cached, true);
    assert.ok(ms < CACHED_BUDGET_MS, `cached build took ${ms.toFixed(1)} ms`);
  });

  test('clearCache empties the store; the next build is not cached', async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.clearCache');
    assert.equal(testApi.__analysis(), undefined);
    const { cached } = await timedBuild(testApi);
    assert.equal(cached, false);
  });

  test('setWindow saves the window and rebuilds', async () => {
    const testApi = await api();
    try {
      await vscode.commands.executeCommand('churnmap.setWindow', 30);
      assert.equal(testApi.__lastBuildSummary()?.window, 30);
      assert.equal(testApi.__analysis()?.window, 30);
    } finally {
      await vscode.workspace
        .getConfiguration('churnmap')
        .update('window', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });
});
