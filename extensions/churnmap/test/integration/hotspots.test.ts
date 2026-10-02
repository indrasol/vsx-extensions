import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';
import { hoverOf } from './helpers.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const TOP = 'src/core/engine.js';

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

async function waitFor(condition: () => boolean, message: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function cityTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label === 'Churnmap' && tab.input instanceof vscode.TabInputWebview);
}

function activePath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath.split(/[\\/]/).join('/');
}

suite('hotspot panel', () => {
  suiteSetup(async () => {
    await vscode.commands.executeCommand('churnmap.build');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('lists the store top in store order, each with its reasons and a screen-reader label', async () => {
    const testApi = await api();
    const result = testApi.__analysis();
    assert.ok(result, 'no analysis');
    const roots = testApi.__hotspots.children();
    assert.ok(roots.length > 0 && roots.length <= 20, `${String(roots.length)} root nodes`);
    assert.deepEqual(
      roots.map((n) => (n.kind === 'hotspot' ? n.hotspot.file.path : n.kind)),
      result.top.map((h) => h.file.path),
    );
    const first = roots[0];
    assert.ok(first?.kind === 'hotspot');
    assert.equal(first.hotspot.file.path, TOP);
    const reasons = testApi.__hotspots.children(first);
    assert.ok(reasons.filter((n) => n.kind === 'reason').length >= 2, 'rank 1 has < 2 reasons');

    for (const node of [...roots, ...reasons]) {
      const item = testApi.__hotspots.item(node);
      assert.ok(item.accessibilityInformation?.label, `no label for ${JSON.stringify(item.label)}`);
    }
    const item = testApi.__hotspots.item(first);
    assert.equal(item.label, `#1  ${TOP}`);
    assert.equal(item.contextValue, 'hotspot');
    assert.ok(item.tooltip instanceof vscode.MarkdownString, 'tooltip not resolved');
    assert.match(
      item.accessibilityInformation?.label ?? '',
      /^Rank 1, src\/core\/engine\.js, Hotspot, score \d+, complexity rising; reasons: /,
    );
    assert.equal(testApi.__hotspots.title(), `Hotspots · ${String(result.window)} d`);
    assert.equal(testApi.__hotspots.badge(), result.top.length);
    console.log(
      `      rank 1: ${JSON.stringify(item.label)} — ${JSON.stringify(item.description)}`,
    );
  });

  test('showHotspots makes the view visible', async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.showHotspots');
    await waitFor(() => testApi.__hotspots.visible(), 'the Hotspots view is not visible');
  });

  test('copyHotspotsMarkdown puts the table on the clipboard', async () => {
    const testApi = await api();
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('churnmap.copyHotspotsMarkdown');
    const text = await vscode.env.clipboard.readText();
    const lines = text.split('\n');
    assert.match(
      lines[0] ?? '',
      /^\*\*Churnmap hotspots\*\* — .+ · last 90 days · \d{4}-\d{2}-\d{2}$/,
    );
    assert.ok(lines.includes('| # | File | Score | Trend | Why | Owners |'));
    assert.ok(text.includes(`| 1 | ${TOP} |`), text);
    assert.equal(
      lines.filter((l) => /^\| \d+ \|/.test(l)).length,
      testApi.__analysis()?.top.length,
    );
    assert.ok(text.trimEnd().endsWith('Made with Churnmap · Indrasol Labs'));
  });

  test('showInCity opens one city and selects the building there', async () => {
    const testApi = await api();
    const node = testApi.__hotspots.children()[0];
    assert.ok(node);
    const select = testApi.__city.nextPosted('select', 15_000);
    const hover = hoverOf(testApi, TOP, 15_000);
    await vscode.commands.executeCommand('churnmap.showInCity', node);
    assert.deepEqual(await select, { type: 'select', path: TOP });
    // The webview flew to it: it reports the building as hovered.
    await hover;
    await vscode.commands.executeCommand('churnmap.showInCity', node);
    await waitFor(() => cityTabs().length === 1, 'expected exactly one city tab');
    assert.equal(cityTabs().length, 1);
  });

  test('selecting a hotspot in the panel selects it in the open city', async () => {
    const testApi = await api();
    const second = testApi.__hotspots.children()[1];
    assert.ok(second?.kind === 'hotspot');
    const select = testApi.__city.nextPosted('select', 10_000);
    await vscode.commands.executeCommand('churnmap.showHotspots', second.hotspot.file.path);
    assert.deepEqual(await select, { type: 'select', path: second.hotspot.file.path });
  });

  test('the inline Open action opens the file', async () => {
    const testApi = await api();
    const node = testApi.__hotspots.children()[0];
    await vscode.commands.executeCommand('churnmap.openFile', node);
    await waitFor(() => activePath()?.endsWith(TOP) ?? false, `${TOP} did not open`);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});
