// Runs alone, on the umbrella fixture (test/fixtures/make-umbrella.mjs; see .vscode-test.mjs): the
// workspace root is a repository of notes that ignores app/, and the code lives in the nested
// repository app/.
import * as assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import type { AnyHostToWebview } from '../../src/city/protocol.js';
import type { TestApi } from '../../src/extension.js';
import { MOSTLY_DOCS_MESSAGE, RANK_ALL_ACTION, RANK_ALL_LABEL } from '../../src/repoChoice.js';
import { commitAll, initRepo, lines, writeFiles } from '../fixtures/gitRepo.mjs';
import { callTool, mcpClient } from './helpers.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const NESTED = 'app';
const TOP = 'src/core/engine.js';

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

function folder(): string {
  const path = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(path, 'no workspace folder');
  return path;
}

async function waitFor(
  condition: () => boolean,
  message: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

interface PickRecord {
  labels: string[];
  descriptions: string[];
}

/**
 * Answers the repository question with `label` (or dismisses it) and records every question and
 * information message. Returns the records and a restore function.
 */
function answer(
  testApi: TestApi,
  label: string | undefined,
  info?: string,
): { picks: PickRecord[]; infos: string[]; restore: () => void } {
  const picks: PickRecord[] = [];
  const infos: string[] = [];
  const restore = testApi.__prompts({
    pick: <T extends vscode.QuickPickItem>(items: T[]) => {
      picks.push({
        labels: items.map((i) => i.label),
        descriptions: items.map((i) => i.description ?? ''),
      });
      return Promise.resolve(items.find((i) => i.label === label));
    },
    info: (message: string) => {
      infos.push(message);
      return Promise.resolve(info);
    },
  });
  return { picks, infos, restore };
}

/** No documentation file ever ranks with the default `churnmap.rank: code`. */
function assertNoDocsRanked(testApi: TestApi): void {
  const top = testApi.__analysis()?.top ?? [];
  const docs = top.filter((h) => /\.(md|html?|txt)$/i.test(h.file.path));
  assert.deepEqual(
    docs.map((h) => h.file.path),
    [],
    'a documentation file ranked',
  );
}

suite('repository picker on an umbrella workspace', () => {
  let restore: (() => void) | undefined;

  suiteSetup(async () => {
    const testApi = await api();
    await testApi.__repositories.forget();
    await vscode.commands.executeCommand('churnmap.clearCache');
  });

  teardown(() => {
    restore?.();
    restore = undefined;
  });

  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration('churnmap')
      .update('rank', undefined, vscode.ConfigurationTarget.Workspace);
    await (await api()).__repositories.forget();
  });

  test('discovery finds the umbrella and the nested app/ with filesystem reads only', async () => {
    const testApi = await api();
    const found = await testApi.__repositories.discover();
    assert.equal(found.spawns, 0, 'discovery started a process');
    assert.deepEqual(
      found.candidates.map((c) => [c.name, c.isNested]),
      [
        [basename(folder()), false],
        [NESTED, true],
      ],
    );
  });

  test('Build with the active file inside app/ analyses app/ without asking', async () => {
    const testApi = await api();
    const prompts = answer(testApi, undefined);
    restore = prompts.restore;
    await vscode.window.showTextDocument(
      vscode.Uri.file(join(folder(), NESTED, ...TOP.split('/'))),
    );
    await vscode.commands.executeCommand('churnmap.build');
    assert.equal(prompts.picks.length, 0, 'the user was asked');
    const result = testApi.__analysis();
    assert.ok(result, 'no analysis');
    assert.equal(basename(result.repoRoot), NESTED);
    assert.equal(result.top[0]?.file.path, TOP);
    assertNoDocsRanked(testApi);
    // An automatic choice is not remembered.
    assert.equal(testApi.__repositories.remembered(), undefined);
    console.log(
      `      top: ${result.top.map((h) => `#${String(h.rank)} ${h.file.path}`).join(', ')}`,
    );
  });

  test('Build with a doc of the umbrella active does not pick the umbrella: it asks, app first', async () => {
    const testApi = await api();
    await testApi.__repositories.forget();
    const prompts = answer(testApi, NESTED);
    restore = prompts.restore;
    await vscode.window.showTextDocument(vscode.Uri.file(join(folder(), 'NOTES.md')));
    await vscode.commands.executeCommand('churnmap.build');
    assert.equal(prompts.picks.length, 1, 'the umbrella was picked without asking');
    const pick = prompts.picks[0];
    assert.ok(pick);
    assert.equal(pick.labels[0], NESTED, 'the code repository is not offered first');
    assert.match(pick.descriptions[0] ?? '', /recommended/);
    assert.equal(basename(testApi.__analysis()?.repoRoot ?? ''), NESTED);
    assertNoDocsRanked(testApi);
    await testApi.__repositories.forget();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('Build with no active editor asks, recommends app, and remembers the answer', async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitFor(() => vscode.window.activeTextEditor === undefined, 'an editor stayed open');
    const prompts = answer(testApi, NESTED);
    restore = prompts.restore;

    await vscode.commands.executeCommand('churnmap.build');
    assert.equal(prompts.picks.length, 1);
    const pick = prompts.picks[0];
    assert.ok(pick);
    assert.equal(pick.labels[0], NESTED, 'the recommended repository is not listed first');
    assert.match(pick.descriptions[0] ?? '', /recommended/);
    assert.deepEqual([...pick.labels].sort(), [basename(folder()), NESTED].sort());
    assert.equal(basename(testApi.__analysis()?.repoRoot ?? ''), NESTED);
    assert.equal(testApi.__repositories.remembered(), join(folder(), NESTED));
    assertNoDocsRanked(testApi);

    // Remembered: the next Build does not ask again.
    await vscode.commands.executeCommand('churnmap.build');
    assert.equal(prompts.picks.length, 1, 'asked again after the choice was remembered');
    assert.equal(basename(testApi.__analysis()?.repoRoot ?? ''), NESTED);
  });

  test('Select repository… switches; the city receives an analysis named after the new one', async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const rendered = testApi.__city.nextMessage('rendered', 30_000);
    await vscode.commands.executeCommand('churnmap.open');
    await rendered;

    const umbrella = basename(folder());
    const prompts = answer(testApi, umbrella);
    restore = prompts.restore;
    const posted = testApi.__city.nextPosted('analysis', 30_000);
    await vscode.commands.executeCommand('churnmap.selectRepository');
    const message = (await posted) as Extract<AnyHostToWebview, { type: 'analysis' }>;
    assert.equal(message.repoName, umbrella);
    assert.equal(testApi.__repositories.remembered(), folder());
    // The umbrella holds only notes: nothing ranks, and the empty state says why.
    assert.equal(message.top.length, 0);
    assertNoDocsRanked(testApi);
    await waitFor(() => prompts.infos.includes(MOSTLY_DOCS_MESSAGE), 'no empty-state message');
    const notes = message.layout.buildings.find((b) => b.path === 'NOTES.md');
    assert.equal(notes?.why, 'docs', 'NOTES.md is not drawn as documentation glass');
  });

  test('the HUD switch button asks the same question', async () => {
    const testApi = await api();
    const prompts = answer(testApi, NESTED);
    restore = prompts.restore;
    const posted = testApi.__city.nextPosted('analysis', 30_000);
    assert.ok(
      testApi.__city.post({ type: 'test:emit', payload: { type: 'selectRepository' } }),
      'no ready city panel',
    );
    const message = (await posted) as Extract<AnyHostToWebview, { type: 'analysis' }>;
    assert.equal(prompts.picks.length, 1);
    assert.equal(message.repoName, NESTED);
    assert.equal(message.top[0]?.path, TOP);
  });

  test('"Rank all files" in the empty state ranks every file (the notes, too)', async () => {
    const testApi = await api();
    const umbrella = basename(folder());
    const prompts = answer(testApi, umbrella, RANK_ALL_ACTION);
    restore = prompts.restore;
    await vscode.commands.executeCommand('churnmap.selectRepository');
    await waitFor(
      () => testApi.__analysis()?.top.some((h) => h.file.path === 'NOTES.md') === true,
      'NOTES.md did not rank with churnmap.rank = all',
    );
    assert.equal(vscode.workspace.getConfiguration('churnmap').get('rank'), 'all');
    assert.equal(basename(testApi.__analysis()?.repoRoot ?? ''), umbrella);
  });
  test('while every file ranks, the HUD chip and the Hotspots view say so', async () => {
    const testApi = await api();
    assert.equal(vscode.workspace.getConfiguration('churnmap').get('rank'), 'all');
    // Workspace scope only: the user's own settings are untouched.
    const inspected = vscode.workspace.getConfiguration('churnmap').inspect('rank');
    assert.ok(inspected);
    assert.equal(inspected.workspaceValue, 'all');
    assert.equal(inspected.globalValue, undefined);
    assert.equal(testApi.__hotspots.description(), RANK_ALL_LABEL);
    const reply = testApi.__city.nextMessage('test:stats');
    assert.ok(testApi.__city.post({ type: 'test:stats' }), 'no ready city panel');
    const stats = await reply;
    assert.ok(stats.type === 'test:stats');
    assert.equal(stats.stats.rankChip, true, 'no "Ranking: all files" chip in the HUD');
  });

  test('"Code only" on the chip restores code ranking and rebuilds', async () => {
    const testApi = await api();
    const posted = testApi.__city.nextPosted('analysis', 30_000);
    assert.ok(
      testApi.__city.post({ type: 'test:click', target: 'rank-code-only' }),
      'no ready city panel',
    );
    const message = (await posted) as Extract<AnyHostToWebview, { type: 'analysis' }>;
    assert.equal(message.rank, 'code');
    assert.equal(vscode.workspace.getConfiguration('churnmap').get('rank'), 'code');
    assertNoDocsRanked(testApi);
    assert.equal(testApi.__hotspots.description(), '');
    const reply = testApi.__city.nextMessage('test:stats');
    testApi.__city.post({ type: 'test:stats' });
    const stats = await reply;
    assert.ok(stats.type === 'test:stats');
    assert.equal(stats.stats.rankChip, false, 'the chip stayed after Code only');
  });
});

// An agent starts the MCP server in the umbrella folder, with no --repo and (here) a fresh cache
// folder, so no editor build tells it which repository to use: it must pick the one code
// repository, never the notes, and with two code repositories it must return the list.
suite('the MCP server started in the umbrella folder', () => {
  // Windows refuses to delete a folder while a handle is still open on it (the editor's Git
  // extension picks up the new svc/ repository and keeps watching it). rmSync retries EPERM/EBUSY;
  // if the folder is still held after that, it stays in the run's temporary fixture.
  const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 200 } as const;
  const remove = (dir: string): void => {
    try {
      rmSync(dir, RM);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EBUSY')) throw err;
      console.log(`      left ${dir} in place (${code}: still in use)`);
    }
  };
  const caches: string[] = [];
  const cacheDir = (): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cm-mcp-umbrella-')));
    caches.push(dir);
    return dir;
  };

  suiteTeardown(() => {
    for (const dir of caches) remove(dir);
    remove(join(folder(), 'svc'));
  });

  test('with one nested code repository, list_hotspots without repo returns its hotspots, not the umbrella’s', async function () {
    this.timeout(60_000);
    const testApi = await api();
    const client = await mcpClient(testApi.__mcpServerPath(), cacheDir(), undefined, folder());
    try {
      const listed = await callTool(client, 'list_repositories');
      const repos = listed.data?.repositories as { name: string; umbrella: boolean }[];
      assert.deepEqual(
        repos.map((r) => [r.name, r.umbrella]),
        [
          [basename(folder()), true],
          [NESTED, false],
        ],
      );
      const before = await callTool(client, 'list_hotspots');
      assert.equal(before.isError, false, before.texts.join('\n'));
      assert.equal(basename(String(before.data?.repo)), NESTED, 'it resolved the umbrella');
      const built = await callTool(client, 'build');
      assert.equal(built.isError, false, built.texts.join('\n'));
      assert.equal(basename(String(built.data?.repo)), NESTED);
      const after = await callTool(client, 'list_hotspots');
      const top = after.data?.top as { path: string }[];
      assert.equal(top[0]?.path, TOP);
      assert.ok(
        top.every((t) => !/\.(md|png)$/.test(t.path)),
        'a notes file ranked',
      );
    } finally {
      await client.close();
    }
  });

  test('with two code repositories, calls without repo return the list; repo "all" covers both', async function () {
    this.timeout(60_000);
    const testApi = await api();
    // A second, small code repository next to app/ (removed again afterwards).
    const svc = join(folder(), 'svc');
    initRepo(svc);
    writeFiles(svc, { 'src/server.ts': lines(40, '  '), 'src/routes.ts': lines(30) });
    commitAll(svc, {
      message: 'Start the service',
      date: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    });
    writeFiles(svc, { 'src/server.ts': lines(48, '    ') });
    commitAll(svc, {
      message: 'fix: server start',
      date: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    });
    const client = await mcpClient(testApi.__mcpServerPath(), cacheDir(), undefined, folder());
    try {
      const res = await callTool(client, 'list_hotspots');
      assert.equal(res.isError, false);
      assert.match(res.texts[0] ?? '', /several git repositories\. Pass `repo`/);
      const repos = res.data?.repositories as { name: string }[];
      assert.deepEqual(repos.map((r) => r.name).sort(), [NESTED, basename(folder()), 'svc'].sort());
      const all = await callTool(client, 'list_hotspots', { repo: 'all' });
      const each = all.data?.repositories as { name: string; needsBuild: boolean; next?: string }[];
      assert.deepEqual(each.map((r) => r.name).sort(), [NESTED, 'svc']);
      assert.ok(each.every((r) => r.needsBuild && r.next?.startsWith('call build(')));
    } finally {
      await client.close();
      remove(join(folder(), 'svc'));
    }
  });
});
