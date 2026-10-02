import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';
import { MORE_FROM_LABS_LINKS } from '../../src/links.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const COMMANDS = [
  'churnmap.build',
  'churnmap.open',
  'churnmap.showHotspots',
  'churnmap.setWindow',
  'churnmap.toggleTreemap',
  'churnmap.exportPostcard',
  'churnmap.ignoreHotspot',
  'churnmap.unignore',
  'churnmap.openFile',
  'churnmap.clearCache',
  'churnmap.showInCity',
  'churnmap.copyHotspotsMarkdown',
  'churnmap.showChangedHotspots',
  'churnmap.createAIPromptTop',
  'churnmap.rankCodeOnly',
];
const VIEWS = ['churnmap.hotspots', 'churnmap.moreFromLabs'];
const WALKTHROUGH = 'churnmap.gettingStarted';

interface Manifest {
  contributes: {
    views: Record<string, { id: string }[]>;
    walkthroughs: { id: string; steps: unknown[] }[];
  };
}

function getExtension(): vscode.Extension<unknown> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  return ext;
}

function manifest(): Manifest {
  return getExtension().packageJSON as Manifest;
}

suite('churnmap', () => {
  test('is present', () => {
    getExtension();
  });

  test(`registers all ${String(COMMANDS.length)} commands`, async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = COMMANDS.filter((id) => !registered.has(id));
    assert.deepEqual(missing, []);
  });

  test('contributes the Hotspots and More from Labs views', () => {
    const viewIds = Object.values(manifest().contributes.views).flatMap((views) =>
      views.map((view) => view.id),
    );
    for (const id of VIEWS) assert.ok(viewIds.includes(id), `${id} is not contributed`);
  });

  test('More from Indrasol Labs lists the Indrasol items first', async () => {
    const api = (await getExtension().activate()) as TestApi | undefined;
    assert.ok(api, 'the test API is only returned in test mode');
    const rows = api.__moreFromLabs();
    console.log(`      More from Labs (VS Code ${vscode.version}): ${JSON.stringify(rows)}`);
    assert.deepEqual(
      rows.slice(0, MORE_FROM_LABS_LINKS.length),
      MORE_FROM_LABS_LINKS.map((l) => ({ label: l.label, url: l.url })),
    );
    assert.equal(rows.at(-1)?.label, 'All extensions');
    const registered = new Set(await vscode.commands.getCommands(true));
    assert.ok(registered.has('churnmap.moreFromLabs.open'), 'the view is not registered');
  });

  test('contributes the getting-started walkthrough', () => {
    const walkthrough = manifest().contributes.walkthroughs.find((w) => w.id === WALKTHROUGH);
    assert.ok(walkthrough, `${WALKTHROUGH} is not contributed`);
    assert.equal(walkthrough.steps.length, 3);
  });

  test('runs build in the test workspace without throwing', async () => {
    await vscode.commands.executeCommand('churnmap.build');
  });
});
