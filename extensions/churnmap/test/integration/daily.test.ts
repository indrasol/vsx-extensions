import * as assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';
import type { Prompts } from '../../src/prompts.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const TOP = 'src/core/engine.js';
const WARM_BUDGET_MS = 500;
const SCM_BUDGET_MS = 2000;

/** The part of the built-in Git extension's API (version 1) the test drives. */
interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: { readonly indexChanges: readonly { uri: vscode.Uri }[] };
  add(paths: string[]): Promise<void>;
  revert(paths: string[]): Promise<void>;
  clean(paths: string[]): Promise<void>;
}
interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): { readonly repositories: readonly GitRepository[] };
}

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 5000,
): Promise<number> {
  const start = performance.now();
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return performance.now() - start;
}

function folder(): vscode.Uri {
  const uri = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(uri, 'the fixture repository is not open');
  return uri;
}

/** Opens a repository file as the workspace folder spells it (on macOS `/var/…`, not git's `/private/var/…`). */
async function open(path: string): Promise<void> {
  await vscode.window.showTextDocument(vscode.Uri.joinPath(folder(), ...path.split('/')));
}

async function setSetting(key: string, value: boolean | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration('churnmap')
    .update(key, value, vscode.ConfigurationTarget.Workspace);
}

suite('warm start', () => {
  test(`loads the cached analysis into a fresh store within ${String(WARM_BUDGET_MS)} ms, starting no process`, async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.build'); // writes (or hits) the cache
    const spawns = testApi.__spawns();
    const warm = await testApi.__warmStart();
    console.log(
      `      warm start: ${warm.outcome} in ${String(warm.ms)} ms (VS Code ${vscode.version})`,
    );
    assert.equal(warm.outcome, 'loaded');
    assert.ok(warm.ms < WARM_BUDGET_MS, `warm start took ${String(warm.ms)} ms`);
    assert.equal(typeof warm.timings?.cache, 'number', 'timings.cache is not set');
    assert.equal(warm.spawns, 0, 'warm start started a process');
    assert.equal(testApi.__spawns(), spawns);
  });
});

suite('status-bar rank', () => {
  suiteSetup(async () => {
    await vscode.commands.executeCommand('churnmap.build');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  teardown(async () => {
    await setSetting('showStatusBar', undefined);
  });

  test('shows "$(flame) Hotspot #1" for the rank-1 file and hides for an unranked one', async () => {
    const testApi = await api();
    await open(TOP);
    await waitFor(() => testApi.__daily.rank().visible, 'the rank item did not appear');
    assert.deepEqual(testApi.__daily.rank(), {
      visible: true,
      text: '$(flame) Hotspot #1',
      warning: true,
      argument: TOP,
    });
    await open('README.md');
    await waitFor(() => !testApi.__daily.rank().visible, 'the rank item stayed for README.md');
    await vscode.commands.executeCommand('workbench.action.files.newUntitledFile');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(testApi.__daily.rank().visible, false, 'shown for an untitled file');
  });

  test('churnmap.showStatusBar turns the item off and on live', async () => {
    const testApi = await api();
    await open(TOP);
    await waitFor(() => testApi.__daily.rank().visible, 'the rank item did not appear');
    await setSetting('showStatusBar', false);
    await waitFor(() => !testApi.__daily.rank().visible, 'the setting did not hide the item');
    await setSetting('showStatusBar', true);
    await waitFor(() => testApi.__daily.rank().visible, 'the setting did not bring it back');
  });
});

suite('SCM hotspot warning (built-in Git API)', () => {
  let repo: GitRepository;
  let file: string;
  let original: string;
  let restore: (() => void) | undefined;

  suiteSetup(async function () {
    this.timeout(30_000);
    await vscode.commands.executeCommand('churnmap.build');
    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    assert.ok(ext, 'the built-in Git extension is missing');
    const git = ext.isActive ? ext.exports : await ext.activate();
    assert.ok(git.enabled, 'the Git extension is off in the clean run');
    const gitApi = git.getAPI(1);
    await waitFor(() => gitApi.repositories.length > 0, 'Git did not open the fixture', 15_000);
    const found = gitApi.repositories[0];
    assert.ok(found);
    repo = found;
    file = vscode.Uri.joinPath(repo.rootUri, ...TOP.split('/')).fsPath;
    original = readFileSync(file, 'utf8');
  });

  teardown(() => {
    restore?.();
    restore = undefined;
    if (readFileSync(file, 'utf8') !== original) writeFileSync(file, original);
  });

  test(`a staged change to the rank-1 file shows "1 hotspot in your changes" within ${String(SCM_BUDGET_MS / 1000)} s; clean hides it`, async function () {
    this.timeout(30_000);
    const testApi = await api();
    await waitFor(() => !testApi.__daily.scm().visible, 'the warning was already on', 5000);

    writeFileSync(file, `${original}// touched by the SCM test\n`);
    const stagedAt = performance.now();
    await repo.add([file]);
    const addMs = performance.now() - stagedAt;
    assert.ok(
      repo.state.indexChanges.some((c) => c.uri.fsPath === file),
      'the file is not staged',
    );
    const shownMs = await waitFor(
      () => testApi.__daily.scm().visible,
      'the SCM warning did not appear',
      SCM_BUDGET_MS + 3000,
    );
    console.log(
      `      stage → warning: ${shownMs.toFixed(0)} ms after add() resolved (add() took ${addMs.toFixed(0)} ms; VS Code ${vscode.version})`,
    );
    assert.ok(shownMs <= SCM_BUDGET_MS, `the warning took ${shownMs.toFixed(0)} ms`);
    assert.deepEqual(testApi.__daily.scm(), {
      visible: true,
      text: '$(warning) 1 hotspot in your changes',
      warning: true,
    });

    // Its click lists the changed hotspots and opens the chosen one.
    restore = testApi.__prompts({
      pick: ((items: unknown[]) => Promise.resolve(items[0])) as Prompts['pick'],
    });
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('churnmap.showChangedHotspots');
    await waitFor(
      () => vscode.window.activeTextEditor?.document.uri.fsPath.endsWith('engine.js') ?? false,
      'the changed hotspot did not open',
    );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    // Unstaged but still modified: still in your changes.
    await repo.revert([file]);
    await new Promise((resolve) => setTimeout(resolve, SCM_BUDGET_MS + 200));
    assert.equal(testApi.__daily.scm().text, '$(warning) 1 hotspot in your changes');

    // Discarded: gone.
    const cleanAt = performance.now();
    await repo.clean([file]);
    await waitFor(() => !testApi.__daily.scm().visible, 'the warning stayed', SCM_BUDGET_MS + 3000);
    console.log(`      clean → hidden: ${(performance.now() - cleanAt).toFixed(0)} ms`);
    assert.equal(readFileSync(file, 'utf8'), original);
  });

  test('churnmap.warnOnStagedHotspots turns the warning off live', async function () {
    this.timeout(30_000);
    const testApi = await api();
    try {
      // Staged through the Git API, so the test does not wait on the file watcher's timing.
      writeFileSync(file, `${original}// touched\n`);
      await repo.add([file]);
      await waitFor(() => testApi.__daily.scm().visible, 'the warning did not appear', 10_000);
      await setSetting('warnOnStagedHotspots', false);
      await waitFor(() => !testApi.__daily.scm().visible, 'the setting did not hide it');
      await setSetting('warnOnStagedHotspots', true);
      await waitFor(
        () => testApi.__daily.scm().visible,
        'the setting did not bring it back',
        10_000,
      );
    } finally {
      await setSetting('warnOnStagedHotspots', undefined);
      await repo.revert([file]);
      await repo.clean([file]);
    }
  });
});
