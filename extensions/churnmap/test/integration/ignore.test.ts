import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';
import type { HotspotNode } from '../../src/panel/hotspotTree.js';
import type { Prompts } from '../../src/prompts.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const REASON = 'scheduled rewrite in Q4';

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

function hotspotPaths(nodes: HotspotNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === 'hotspot' ? [n.hotspot.file.path] : []));
}

/** Answers every prompt: the reason, and no button pressed on the toast. */
function answer(testApi: TestApi, overrides: Partial<Prompts> = {}): () => void {
  return testApi.__prompts({
    inputBox: () => Promise.resolve(REASON),
    info: () => Promise.resolve(undefined),
    ...overrides,
  });
}

suite('ignore a hotspot', () => {
  let restore: (() => void) | undefined;
  let original: string[] = [];

  suiteSetup(async () => {
    const testApi = await api();
    await testApi.__ignores.store([]);
    await vscode.commands.executeCommand('churnmap.build');
    original = hotspotPaths(testApi.__hotspots.children());
    assert.ok(original.length >= 3, 'the fixture has fewer than 3 hotspots');
    // The city is open, so it receives the analysis without the ignored file.
    const rendered = testApi.__city.nextMessage('rendered', 15_000);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.commands.executeCommand('churnmap.open');
    await rendered;
  });

  teardown(async () => {
    restore?.();
    restore = undefined;
    await (await api()).__ignores.store([]);
  });

  test('ignoring rank 1 with a reason moves rank 2 up, adds "Ignored (1)" and drops the glow', async () => {
    const testApi = await api();
    restore = answer(testApi);
    const [first, second] = original;
    assert.ok(first && second);
    const node = testApi.__hotspots.children()[0];
    const posted = testApi.__city.nextPosted('analysis');

    assert.equal(await vscode.commands.executeCommand('churnmap.ignoreHotspot', node), true);

    const roots = testApi.__hotspots.children();
    assert.deepEqual(hotspotPaths(roots).slice(0, 1), [second]);
    assert.ok(!hotspotPaths(roots).includes(first), 'the ignored file is still listed');
    const rank1 = roots[0];
    assert.ok(rank1?.kind === 'hotspot' && rank1.hotspot.rank === 1);
    const group = roots.at(-1);
    assert.ok(group?.kind === 'ignoredGroup', 'no "Ignored" node at the bottom');
    assert.equal(testApi.__hotspots.item(group).label, 'Ignored (1)');
    const [ignored] = testApi.__hotspots.children(group);
    assert.ok(ignored?.kind === 'ignored');
    assert.equal(ignored.entry.path, first);
    assert.equal(ignored.entry.reason, REASON);
    assert.match(String(testApi.__hotspots.item(ignored).description), /^90 d left · /);
    assert.equal(testApi.__hotspots.badge(), hotspotPaths(roots).length);

    // The city: out of `top` (no glow), still drawn, and the card can say why.
    const message = await posted;
    assert.ok(message.type === 'analysis');
    assert.ok(!message.top.some((t) => t.path === first), 'the ignored file is still in top');
    assert.ok(message.layout.byPath[first] !== undefined, 'the ignored file left the city');
    const building = message.layout.buildings[message.layout.byPath[first] ?? -1];
    assert.equal(building?.rank, undefined);
    assert.deepEqual(
      message.ignored.map((e) => [e.path, e.reason]),
      [[first, REASON]],
    );

    // The analysis still has the file (marked), the export does not.
    const file = testApi.__analysis()?.files.find((f) => f.path === first);
    assert.equal(file?.ignored, true);
    await vscode.commands.executeCommand('churnmap.copyHotspotsMarkdown');
    assert.ok(!(await vscode.env.clipboard.readText()).includes(`| ${first} |`));
  });

  test('un-ignoring from the "Ignored" node restores the ranking', async () => {
    const testApi = await api();
    restore = answer(testApi);
    const first = original[0] ?? '';
    await vscode.commands.executeCommand('churnmap.ignoreHotspot', first);
    const group = testApi.__hotspots.children().at(-1);
    assert.ok(group?.kind === 'ignoredGroup');
    const [ignored] = testApi.__hotspots.children(group);
    assert.equal(await vscode.commands.executeCommand('churnmap.unignore', ignored), 1);
    assert.deepEqual(hotspotPaths(testApi.__hotspots.children()), original);
    assert.ok(!testApi.__hotspots.children().some((n) => n.kind === 'ignoredGroup'));
  });

  test('Undo on the toast restores it in the same session', async () => {
    const testApi = await api();
    restore = answer(testApi, { info: () => Promise.resolve('Undo') });
    await vscode.commands.executeCommand('churnmap.ignoreHotspot', original[0]);
    await waitFor(() => testApi.__ignores.list().length === 0, 'Undo did not un-ignore');
    assert.deepEqual(hotspotPaths(testApi.__hotspots.children()), original);
  });

  test('from the palette: pick a hotspot, then un-ignore it from the list', async () => {
    const testApi = await api();
    const shown: string[] = [];
    restore = answer(testApi, {
      pick: ((items: { label: string }[]) =>
        Promise.resolve(items.find((i) => i.label === original[1]))) as Prompts['pick'],
      pickMany: ((items: unknown[]) => Promise.resolve(items)) as Prompts['pickMany'],
      info: (message: string) => {
        shown.push(message);
        return Promise.resolve(undefined);
      },
    });
    await vscode.commands.executeCommand('churnmap.ignoreHotspot');
    assert.deepEqual(
      testApi.__ignores.list().map((e) => e.path),
      [original[1]],
    );
    assert.equal(shown[0], `Ignored ${original[1] ?? ''} for 90 days.`);
    assert.equal(await vscode.commands.executeCommand('churnmap.unignore'), 1);
    assert.deepEqual(testApi.__ignores.list(), []);
    assert.equal(await vscode.commands.executeCommand('churnmap.unignore'), 0);
    assert.equal(shown.at(-1), 'Nothing is ignored.');
  });

  test('a cancelled reason ignores nothing', async () => {
    const testApi = await api();
    restore = answer(testApi, { inputBox: () => Promise.resolve(undefined) });
    assert.equal(
      await vscode.commands.executeCommand('churnmap.ignoreHotspot', original[0]),
      false,
    );
    assert.deepEqual(testApi.__ignores.list(), []);
  });

  test('an expired entry is purged on the next read', async () => {
    const testApi = await api();
    const live = { path: original[2] ?? '', reason: 'still valid', until: Date.now() + 86_400_000 };
    const expired = { path: original[0] ?? '', reason: 'old', until: Date.now() - 1000 };
    await testApi.__ignores.store([expired, live]);
    assert.deepEqual(testApi.__ignores.list(), [live]);
    await waitFor(
      () => JSON.stringify(testApi.__ignores.stored()) === JSON.stringify([live]),
      'the expired entry was not removed from workspace state',
    );
  });
});
