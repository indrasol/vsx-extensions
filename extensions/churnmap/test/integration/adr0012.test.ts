// Runs alone, on the hostile fixture (see .vscode-test.mjs): the repository's own .git/config
// points core.pager, core.fsmonitor and core.hooksPath at a script that writes a marker file.
import * as assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';
import { callTool, mcpClient } from './helpers.js';

const EXTENSION_ID = 'Indrasol.churnmap';
/** Written by the fixture repo's hostile core.pager / core.fsmonitor / hooks (make-repo.mjs). */
const MARKER = 'churnmap-pwned';

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

function marker(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'the fixture repository is not open');
  const file = join(folder.uri.fsPath, '.git', MARKER);
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

suite('ADR-0012 on a hostile repository', () => {
  test('a full build (log, ls-files, show) never runs the repository-configured programs', async () => {
    const testApi = await api();
    assert.equal(
      vscode.workspace.getConfiguration('git').get('enabled'),
      false,
      'the fixture should turn the Git extension off',
    );
    await vscode.commands.executeCommand('churnmap.clearCache');
    const spawnsBefore = testApi.__spawns();
    await vscode.commands.executeCommand('churnmap.build');
    const summary = testApi.__lastBuildSummary();
    assert.ok(summary, 'the build did not finish');
    assert.equal(summary.cached, false);
    assert.equal(testApi.__analysis()?.top[0]?.file.path, 'src/core/engine.js');
    assert.equal(testApi.__analysis()?.top[0]?.trend, 'rising'); // `git show` ran too
    console.log(
      `      ${summary.message}; git processes: ${String(testApi.__spawns() - spawnsBefore)}`,
    );
    const ran = marker();
    assert.equal(ran, '', `git ran a repository-supplied program:\n${ran}`);
  });

  test('with the Git extension off, the SCM warning stays hidden and the trap stays quiet', async () => {
    const testApi = await api();
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('/'),
        'src',
        'core',
        'engine.js',
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(testApi.__daily.scm().visible, false);
    assert.equal(testApi.__daily.rank().text, '$(flame) Hotspot #1');
    assert.equal(marker(), '');
  });

  test('a build through the MCP server never runs the repository-configured programs', async () => {
    const testApi = await api();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'the fixture repository is not open');
    // A fresh cache folder, so the server cannot answer from the extension's cache.
    const cacheDir = mkdtempSync(join(tmpdir(), 'cm-mcp-hostile-'));
    const client = await mcpClient(testApi.__mcpServerPath(), cacheDir, folder.uri.fsPath);
    try {
      const built = await callTool(client, 'build');
      assert.equal(built.isError, false, built.texts.join('\n'));
      console.log(`      MCP: ${built.texts[0] ?? ''}`);
      const top = (built.data?.top as { path: string; trend: string }[] | undefined) ?? [];
      assert.equal(top[0]?.path, 'src/core/engine.js');
      assert.equal(top[0].trend, 'rising'); // `git show` ran too
    } finally {
      await client.close();
      rmSync(cacheDir, { recursive: true, force: true });
    }
    const ran = marker();
    assert.equal(ran, '', `git ran a repository-supplied program:\n${ran}`);
  });
});
