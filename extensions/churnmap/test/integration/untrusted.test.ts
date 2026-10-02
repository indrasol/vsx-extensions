// Runs alone, with Workspace Trust on and the fixture folder not trusted (see .vscode-test.mjs).
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { AnalysisCache } from '../../src/analysis/cache.js';
import { settingsKey } from '../../src/analysis/pipeline.js';
import { readRepoHead } from '../../src/analysis/repoHead.js';
import { configuredSettings } from '../../src/build.js';
import type { TestApi } from '../../src/extension.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const TOP = 'src/core/engine.js';

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const deadline = Date.now() + 10_000;
  while (!ext.isActive && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(ext.isActive, 'the extension did not activate in an untrusted workspace');
  assert.ok(ext.exports, 'the test API is only returned in test mode');
  return ext.exports;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('untrusted workspace', () => {
  test('activates in Restricted Mode within budget', async () => {
    assert.equal(vscode.workspace.isTrusted, false, 'the fixture folder should not be trusted');
    const testApi = await api();
    console.log(`      activation (untrusted): ${testApi.__activationMs.toFixed(1)} ms`);
    assert.ok(testApi.__activationMs < 100);
  });

  test('warm start does nothing, even with a matching cache on disk', async () => {
    const testApi = await api();
    // Plant a cache hit for this repository's root + HEAD + settings.
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const disk = await readRepoHead(folder);
    assert.ok(disk, 'the fixture has no readable HEAD');
    await new AnalysisCache(testApi.__storageDir()).write({
      version: 4,
      repoRoot: disk.repoRoot,
      head: disk.head,
      window: 90,
      generatedAt: new Date().toISOString(),
      shallow: false,
      commitCount: 1,
      files: [],
      top: [],
      excludedCount: 0,
      capped: false,
      settingsKey: settingsKey(configuredSettings()),
      timings: {},
    });
    const warm = await testApi.__warmStart();
    assert.equal(warm.outcome, 'untrusted');
    assert.equal(warm.timings, undefined);
    assert.equal(warm.spawns, 0);
    assert.equal(testApi.__analysis(), undefined, 'the activation warm start loaded the cache');
  });

  test('repository discovery works before trust and starts no process', async () => {
    const testApi = await api();
    const found = await testApi.__repositories.discover();
    assert.equal(found.spawns, 0, 'discovery started a process');
    assert.equal(found.candidates.length, 1);
    assert.equal(found.candidates[0]?.isNested, false);
  });

  test('Select repository… is refused before trust', async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.selectRepository');
    assert.equal(testApi.__analysis(), undefined);
    assert.equal(testApi.__spawns(), 0);
  });

  test('the status-bar items stay hidden and no git process ever ran', async () => {
    const testApi = await api();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(folder);
    await vscode.window.showTextDocument(vscode.Uri.joinPath(folder, ...TOP.split('/')));
    await vscode.commands.executeCommand('churnmap.build'); // refused: not trusted
    await pause(500);
    assert.equal(testApi.__daily.rank().visible, false);
    assert.equal(testApi.__daily.scm().visible, false);
    assert.equal(testApi.__analysis(), undefined);
    assert.deepEqual(testApi.__hotspots.children(), []);
    assert.equal(testApi.__spawns(), 0, 'Churnmap started a process in an untrusted workspace');
  });
});
