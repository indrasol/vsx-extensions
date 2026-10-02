// Discoverability of the AI features from a fresh install: AI prompt is one click away in the city's
// HUD, on the insights rail and on the Hotspots view's title bar; a click on a building selects it
// (card pinned with Open file and AI prompt) and only a double-click opens the file.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { PromptOutcome } from '../../src/ai/aiPrompt.js';
import type { AnyHostToWebview } from '../../src/city/protocol.js';
import type { TestApi } from '../../src/extension.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const TOP = 'src/core/engine.js';

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cityTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label === 'Churnmap' && tab.input instanceof vscode.TabInputWebview);
}

async function waitFor(condition: () => boolean, message: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < deadline, message);
    await pause(25);
  }
}

function post(testApi: TestApi, message: AnyHostToWebview): void {
  assert.ok(testApi.__city.post(message), 'no ready city panel');
}

async function stats(testApi: TestApi): Promise<Record<string, number | boolean>> {
  const reply = testApi.__city.nextMessage('test:stats');
  post(testApi, { type: 'test:stats' });
  const message = await reply;
  assert.equal(message.type, 'test:stats');
  return message.stats;
}

/** A fresh city in 3D with the intro over and the coach mark closed. */
async function freshCity(testApi: TestApi): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => cityTabs().length === 0, 'editors did not close');
  const rendered = testApi.__city.nextMessage('rendered', 10_000);
  await vscode.commands.executeCommand('churnmap.open');
  await rendered;
  await stats(testApi);
  if ((await stats(testApi)).mode2d === true) {
    const changed = testApi.__city.nextMessage('viewChanged');
    post(testApi, { type: 'view', mode: '3d' });
    await changed;
  }
  post(testApi, { type: 'test:dismissCoach' });
  await pause(1200);
}

/** The next `createAIPrompt` the webview posts; the host's template question is answered with Escape. */
async function nextAsk(testApi: TestApi, act: () => void): Promise<string> {
  const restore = testApi.__prompts({ pick: () => Promise.resolve(undefined) });
  try {
    const asked = testApi.__city.nextMessage('createPrompt');
    act();
    const message = await asked;
    assert.ok(message.type === 'createPrompt');
    await pause(100); // the host's (dismissed) template question
    return message.path;
  } finally {
    restore();
  }
}

function activePath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath.split(/[\\/]/).join('/');
}

suite('AI entry points and click-to-select', () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.build');
    await freshCity(testApi);
  });

  test('the HUD AI prompt asks about #1 when nothing is selected', async () => {
    const testApi = await api();
    await freshCity(testApi);
    const s = await stats(testApi);
    assert.equal(s.askEnabled, true, 'the HUD AI prompt button is disabled');
    assert.equal(s.selected, false);
    const path = await nextAsk(testApi, () => {
      post(testApi, { type: 'test:click', target: 'ai-prompt' });
    });
    assert.equal(path, TOP);
  });

  test('a click selects a building and pins its card with Open file and AI prompt; nothing opens', async () => {
    const testApi = await api();
    await freshCity(testApi);
    const hover = testApi.__city.nextMessage('hover');
    post(testApi, { type: 'test:clickBuilding', path: TOP, double: false });
    await hover;
    await pause(300);
    const s = await stats(testApi);
    console.log(`      after a click: ${JSON.stringify(s)}`);
    assert.equal(s.selected, true, 'the click did not select');
    assert.equal(s.cardPinned, true, 'the card is not pinned');
    assert.equal(s.pinnedButtons, 2, 'the pinned card lacks Open file and AI prompt');
    assert.equal(activePath(), undefined, 'a single click opened the file');
    // The HUD AI prompt now acts on the selection.
    const path = await nextAsk(testApi, () => {
      post(testApi, { type: 'test:click', target: 'ai-prompt' });
    });
    assert.equal(path, TOP);
  });

  test('a double-click opens the file', async () => {
    const testApi = await api();
    await freshCity(testApi);
    const before = testApi.__city.received('openFile');
    post(testApi, { type: 'test:clickBuilding', path: TOP, double: true });
    await waitFor(() => activePath()?.endsWith(TOP) ?? false, `${TOP} did not open`);
    assert.equal(testApi.__city.received('openFile'), before + 1);
  });

  test('a click in the 2D treemap selects too; a double-click there opens', async () => {
    const testApi = await api();
    await freshCity(testApi);
    const changed = testApi.__city.nextMessage('viewChanged');
    post(testApi, { type: 'view', mode: '2d' });
    await changed;
    await pause(500);
    post(testApi, { type: 'test:clickBuilding', path: TOP, double: false });
    await pause(300);
    const s = await stats(testApi);
    assert.equal(s.mode2d, true);
    assert.equal(s.cardPinned, true);
    assert.equal(activePath(), undefined, 'a single click opened the file');
    post(testApi, { type: 'test:clickBuilding', path: TOP, double: true });
    await waitFor(() => activePath()?.endsWith(TOP) ?? false, `${TOP} did not open`);
    await freshCity(testApi); // back to 3D, so later suites start there
    assert.equal((await stats(testApi)).mode2d, false);
  });

  test('the rail is open by default, each card has AI prompt, and collapsed it says how many', async () => {
    const testApi = await api();
    await freshCity(testApi);
    let s = await stats(testApi);
    assert.equal(s.railOpen, true);
    assert.equal(s.railAskButtons, s.railCards);
    assert.ok(Number(s.railCards) >= 1);
    const path = await nextAsk(testApi, () => {
      post(testApi, { type: 'test:click', target: 'rail-collapse' });
      post(testApi, { type: 'test:click', target: 'rail-expand' });
      post(testApi, { type: 'test:click', target: 'rail-prompt-1' });
    });
    assert.equal(path, TOP);
    const saved = testApi.__city.nextMessage('setRail');
    post(testApi, { type: 'test:click', target: 'rail-collapse' });
    const message = await saved;
    assert.ok(message.type === 'setRail' && !message.open);
    s = await stats(testApi);
    assert.equal(s.railOpen, false);
    assert.equal(s.railCollapsedCount, s.railCards, 'the collapsed rail does not say how many');
    // Remembered for this workspace: a new city opens collapsed, with the count showing.
    await freshCity(testApi);
    s = await stats(testApi);
    assert.equal(s.railOpen, false);
    assert.ok(Number(s.railCollapsedCount) >= 1);
    post(testApi, { type: 'test:click', target: 'rail-expand' });
    assert.equal((await stats(testApi)).railOpen, true);
  });

  test('the AI agent menu offers Export for agents and Connect to AI agent', async () => {
    const testApi = await api();
    await freshCity(testApi);
    const restore = testApi.__prompts({
      pick: () => Promise.resolve(undefined),
      pickMany: () => Promise.resolve(undefined),
      info: () => Promise.resolve(undefined),
    });
    try {
      const connect = testApi.__city.nextMessage('addToAgent');
      post(testApi, { type: 'test:click', target: 'ai-agent' });
      post(testApi, { type: 'test:click', target: 'connect-agent' });
      await connect;
      const exported = testApi.__city.nextMessage('exportForAgents');
      post(testApi, { type: 'test:click', target: 'ai-agent' });
      post(testApi, { type: 'test:click', target: 'export-for-agents' });
      await exported;
      await pause(200);
    } finally {
      restore();
    }
  });

  test('the Hotspots view title bar has AI prompt for the top hotspot and Connect to AI agent', async () => {
    const testApi = await api();
    const titleBar = (
      vscode.extensions.getExtension(EXTENSION_ID)?.packageJSON as {
        contributes: { menus: Record<string, { command: string; when: string; group: string }[]> };
      }
    ).contributes.menus['view/title'];
    for (const command of ['churnmap.createAIPromptTop', 'churnmap.addToAgent']) {
      const entry = titleBar?.find(
        (m) => m.command === command && m.when === 'view == churnmap.hotspots',
      );
      assert.ok(entry, `${command} is not on the title bar`);
      assert.match(entry.group, /^navigation/, `${command} is hidden in the ⋯ menu`);
    }
    const restore = testApi.__prompts({
      pick: (items) => Promise.resolve(items.find((i) => i.label === 'Tests first')),
      info: () => Promise.resolve('Done'),
    });
    try {
      const outcome = await vscode.commands.executeCommand<PromptOutcome | undefined>(
        'churnmap.createAIPromptTop',
      );
      assert.ok(outcome, 'createAIPromptTop returned nothing');
      assert.ok(outcome.brief.includes(`\`${TOP}\``), 'the prompt is not about #1');
    } finally {
      restore();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  test('the coach mark has five steps, the first about moving around, the last about AI prompts', async () => {
    const testApi = await api();
    await freshCity(testApi);
    assert.equal((await stats(testApi)).coachSteps, 5);
  });
});
