import * as assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import * as vscode from 'vscode';
import type { AnyHostToWebview } from '../../src/city/protocol.js';
import type { TestApi } from '../../src/extension.js';
import { decodePng } from '../fixtures/png.mjs';

// 3D ↔ 2D: after any sequence of switches that ends in 3D, the whole city is drawn again
// (buildings and district plates, from a perspective camera), not just the ground grid.

const EXTENSION_ID = 'Indrasol.churnmap';
const WIDTH = 800;
const HEIGHT = 450;

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

async function stats(testApi: TestApi): Promise<Record<string, number | boolean>> {
  const reply = testApi.__city.nextMessage('test:stats');
  assert.ok(testApi.__city.post({ type: 'test:stats' }), 'no ready city panel');
  const message = await reply;
  assert.equal(message.type, 'test:stats');
  return message.stats;
}

function post(testApi: TestApi, message: AnyHostToWebview): void {
  assert.ok(testApi.__city.post(message), 'no ready city panel');
}

/** Opens a fresh city on the current analysis (the intro runs again) in 3D. */
async function freshCity(testApi: TestApi): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => cityTabs().length === 0, 'editors did not close');
  const rendered = testApi.__city.nextMessage('rendered', 10_000);
  await vscode.commands.executeCommand('churnmap.open');
  await rendered;
  await stats(testApi);
  post(testApi, { type: 'test:dismissCoach' });
  if ((await stats(testApi)).mode2d === true) await switchTo(testApi, '3d');
}

/** Switches through the host's `view` message and waits for the webview's `viewChanged`. */
async function switchTo(testApi: TestApi, mode: '2d' | '3d'): Promise<void> {
  const changed = testApi.__city.nextMessage('viewChanged');
  post(testApi, { type: 'view', mode });
  await changed;
}

/** Waits until nothing animates but the glow pulse (in either view), then returns the stats. */
async function settled(testApi: TestApi): Promise<Record<string, number | boolean>> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const s = await stats(testApi);
    if (s.tweening !== true && s.morphing3d !== true) return s;
    assert.ok(Date.now() < deadline, `the city did not settle: ${JSON.stringify(s)}`);
    await pause(100);
  }
}

/**
 * Share of pixels in the middle of a `test:frame` capture (the city area, away from the HUD and
 * the rail) that differ clearly from the backdrop at the left edge of the same row.
 */
async function cityCoverage(testApi: TestApi): Promise<number> {
  const reply = testApi.__city.nextMessage('test:capture', 30_000);
  post(testApi, { type: 'test:frame', width: WIDTH, height: HEIGHT });
  const message = await reply;
  assert.ok(message.type === 'test:capture');
  post(testApi, { type: 'test:clock', advance: null }); // releases the held page size
  const { width, height, rgba } = decodePng(Buffer.from(message.png));
  let differing = 0;
  let total = 0;
  for (let y = Math.floor(height * 0.25); y < height * 0.8; y += 2) {
    const edge = (y * width + 2) * 4;
    for (let x = Math.floor(width * 0.2); x < width * 0.65; x += 2) {
      const o = (y * width + x) * 4;
      const d =
        Math.abs((rgba[o] ?? 0) - (rgba[edge] ?? 0)) +
        Math.abs((rgba[o + 1] ?? 0) - (rgba[edge + 1] ?? 0)) +
        Math.abs((rgba[o + 2] ?? 0) - (rgba[edge + 2] ?? 0));
      if (d > 45) differing += 1;
      total += 1;
    }
  }
  return differing / Math.max(1, total);
}

/** The full city: every building and plate drawn, full height, perspective camera. */
async function assertFullCity(testApi: TestApi, label: string): Promise<void> {
  const s = await settled(testApi);
  console.log(`      ${label}: ${JSON.stringify(s)}`);
  assert.equal(s.mode2d, false, `${label}: still in 2D`);
  assert.equal(s.shown, true, `${label}: the 3D canvas is hidden`);
  assert.equal(s.flatten, 1, `${label}: the city is still flat`);
  assert.equal(s.fov, 45, `${label}: the camera is still narrowed for the morph`);
  assert.ok(Number(s.buildingsVisible) > 0, `${label}: no buildings drawn`);
  assert.equal(s.buildingsVisible, s.buildings, `${label}: some buildings are missing`);
  assert.ok(Number(s.platesVisible) > 0, `${label}: no district plates`);
  assert.equal(s.controlsEnabled, true, `${label}: orbit controls left off`);
  const coverage = await cityCoverage(testApi);
  console.log(`      ${label}: ${(coverage * 100).toFixed(1)} % of the city area drawn`);
  assert.ok(coverage > 0.03, `${label}: the city area is empty (${String(coverage)})`);
}

suite('3D ↔ 2D toggle restores the full city', () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.build');
    await freshCity(testApi);
  });

  teardown(async () => {
    const testApi = await api();
    testApi.__city.post({ type: 'test:reducedMotion', on: null });
  });

  test('build → 2D → 3D draws every building and plate again', async function () {
    this.timeout(30_000);
    const testApi = await api();
    await freshCity(testApi);
    await pause(1200); // the intro is over
    await assertFullCity(testApi, 'before');
    await switchTo(testApi, '2d');
    await settled(testApi);
    await pause(300);
    await switchTo(testApi, '3d');
    await assertFullCity(testApi, '2D → 3D');
  });

  test('toggling twice quickly ends with the full city', async function () {
    this.timeout(30_000);
    const testApi = await api();
    await freshCity(testApi);
    await pause(1200);
    for (const mode of ['2d', '3d', '2d', '3d'] as const) post(testApi, { type: 'view', mode });
    await pause(100);
    await switchTo(testApi, '2d');
    await pause(150);
    await switchTo(testApi, '3d');
    await assertFullCity(testApi, 'quick toggles');
  });

  test('toggling during the intro ends with the full city', async function () {
    this.timeout(30_000);
    const testApi = await api();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitFor(() => cityTabs().length === 0, 'editors did not close');
    const rendered = testApi.__city.nextMessage('rendered', 10_000);
    await vscode.commands.executeCommand('churnmap.open');
    await rendered;
    post(testApi, { type: 'view', mode: '2d' });
    await pause(200);
    await switchTo(testApi, '3d');
    post(testApi, { type: 'test:dismissCoach' });
    await assertFullCity(testApi, 'during the intro');
  });

  test('with reduced motion the switch back is instant and complete', async function () {
    this.timeout(30_000);
    const testApi = await api();
    await freshCity(testApi);
    await pause(1200);
    post(testApi, { type: 'test:reducedMotion', on: true });
    await switchTo(testApi, '2d');
    await switchTo(testApi, '3d');
    const s = await stats(testApi);
    assert.equal(s.tweening, false, 'a morph ran with reduced motion');
    await assertFullCity(testApi, 'reduced motion');
  });

  test('a window switch while in 2D, then back to 3D, draws the new city', async function () {
    this.timeout(60_000);
    const testApi = await api();
    await freshCity(testApi);
    await pause(1200);
    await switchTo(testApi, '2d');
    try {
      const rendered = testApi.__city.nextMessage('rendered', 20_000);
      post(testApi, { type: 'test:emit', payload: { type: 'setWindow', window: 30 } });
      await rendered;
      await settled(testApi);
      await switchTo(testApi, '3d');
      await assertFullCity(testApi, 'window switch in 2D');
    } finally {
      await vscode.workspace
        .getConfiguration('churnmap')
        .update('window', undefined, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand('churnmap.build');
    }
  });

  test('the Toggle 2D treemap command there and back draws the full city', async function () {
    this.timeout(30_000);
    const testApi = await api();
    await freshCity(testApi);
    await pause(1200);
    for (const expected of ['2d', '3d']) {
      const changed = testApi.__city.nextMessage('viewChanged');
      await vscode.commands.executeCommand('churnmap.toggleTreemap');
      const message = await changed;
      assert.equal(message.type === 'viewChanged' && message.mode, expected);
      await pause(500);
    }
    await assertFullCity(testApi, 'command toggle');
  });
});
