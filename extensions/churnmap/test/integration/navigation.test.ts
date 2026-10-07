// Moving around the city: right-, Shift- and trackpad-drag pan the 3D camera (its target moves),
// the arrow keys pan and Alt + arrows orbit; in 2D a left-drag pans (a click still selects).
// F fits the whole city into the safe area (the canvas minus the HUD and the panels) at 360, 900
// and 1400 px, rail open or closed, in both views; the top-5 name pills never overlap each other
// or an overlay; ⋯ → ? Controls lists the controls.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { AnyHostToWebview, TestBox } from '../../src/city/protocol.js';
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

/** A fresh city in `mode`, coach closed, remembered panel places forgotten. */
async function freshCity(testApi: TestApi, mode: '3d' | '2d' = '3d'): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => cityTabs().length === 0, 'editors did not close');
  await testApi.__panels.reset();
  const rendered = testApi.__city.nextMessage('rendered', 10_000);
  await vscode.commands.executeCommand('churnmap.open');
  await rendered;
  if (((await stats(testApi)).mode2d === true) !== (mode === '2d')) {
    const changed = testApi.__city.nextMessage('viewChanged');
    post(testApi, { type: 'view', mode });
    await changed;
  }
  post(testApi, { type: 'test:dismissCoach' });
  // The intro (3D) or the morph finishes.
  await pause(1600);
}

const target = (s: Record<string, number | boolean>): [number, number, number] => [
  Number(s.targetX),
  Number(s.targetY),
  Number(s.targetZ),
];

function moved(a: readonly number[], b: readonly number[], min = 1): boolean {
  return Math.hypot(...a.map((v, i) => v - (b[i] ?? 0))) >= min;
}

/**
 * Waits until the camera target stops moving (two reads 200 ms apart within 0.1). Damping is
 * per frame, so a software-rendered CI window takes longer to settle than a fixed pause allows.
 */
async function targetAtRest(testApi: TestApi, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = target(await stats(testApi));
  while (Date.now() < deadline) {
    await pause(200);
    const next = target(await stats(testApi));
    if (!moved(last, next, 0.1)) return;
    last = next;
  }
  assert.fail(`the camera target did not come to rest within ${String(timeoutMs)} ms`);
}

/**
 * Pill stats once the label layout has caught up with the camera. Pills are re-placed every
 * OCCLUSION_MS on the frame loop and keep their last offsets in between, so while a damped pan
 * still moves (longer on a slow, software-rendered runner) two pills can briefly cross (#22).
 * Waits for the render-settled signal, then reads again until no pill overlaps or `timeoutMs`
 * passes; the last read is returned, so a real overlap still fails.
 */
async function settledPills(
  testApi: TestApi,
  timeoutMs = 2000,
): Promise<Record<string, number | boolean>> {
  const reply = testApi.__city.nextMessage('test:stats', 15_000);
  post(testApi, { type: 'test:settle', timeoutMs: 10_000 });
  await reply;
  const deadline = Date.now() + timeoutMs;
  let s = await stats(testApi);
  while (Number(s.pillOverlaps) !== 0 && Date.now() < deadline) {
    await pause(100);
    s = await stats(testApi);
  }
  return s;
}

async function fitBoxes(
  testApi: TestApi,
  width: number,
  height: number,
  rail: boolean,
): Promise<TestBox[]> {
  const reply = testApi.__city.nextMessage('test:boxes');
  post(testApi, { type: 'test:fit', width, height, rail });
  const message = await reply;
  assert.ok(message.type === 'test:boxes');
  return message.boxes;
}

function inside(outer: TestBox, inner: TestBox): boolean {
  const eps = 1;
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

function intersect(a: TestBox, b: TestBox): boolean {
  return (
    a.x + 0.5 < b.x + b.w && b.x + 0.5 < a.x + a.w && a.y + 0.5 < b.y + b.h && b.y + 0.5 < a.y + a.h
  );
}

suite('Navigation: pan, zoom, fit, labels', function () {
  this.timeout(120_000);

  suiteTeardown(async () => {
    const testApi = await api();
    await testApi.__panels.reset();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('3D: right-drag, Shift + drag and a two-finger trackpad drag move the camera target', async () => {
    const testApi = await api();
    await freshCity(testApi, '3d');
    for (const [label, send] of [
      ['right-drag', { type: 'test:dragView', dx: 160, dy: 60, button: 2, shift: false }],
      ['middle-drag', { type: 'test:dragView', dx: -140, dy: 40, button: 1, shift: false }],
      ['Shift + left-drag', { type: 'test:dragView', dx: -120, dy: -80, button: 0, shift: true }],
      ['trackpad drag', { type: 'test:wheel', deltaX: 60, deltaY: 30, ctrl: false }],
    ] as const) {
      const before = target(await stats(testApi));
      post(testApi, send);
      await pause(700);
      const after = await stats(testApi);
      assert.ok(
        moved(before, target(after)),
        `${label} did not pan: ${String(before)} → ${String(target(after))}`,
      );
      assert.equal(after.mode2d, false);
    }
  });

  test('3D: a plain left-drag rotates, it does not pan', async () => {
    const testApi = await api();
    await freshCity(testApi, '3d');
    const before = await stats(testApi);
    post(testApi, { type: 'test:dragView', dx: 150, dy: 0, button: 0, shift: false });
    await pause(700);
    const after = await stats(testApi);
    assert.ok(!moved(target(before), target(after), 0.5), 'a left-drag moved the target');
  });

  test('3D: arrows pan, Alt + arrows orbit, F fits again', async () => {
    const testApi = await api();
    await freshCity(testApi, '3d');
    const fitted = target(await stats(testApi));
    for (let i = 0; i < 4; i++)
      post(testApi, { type: 'test:key', target: 'view', key: 'ArrowRight' });
    await pause(500);
    const panned = target(await stats(testApi));
    assert.ok(moved(fitted, panned), 'the arrow keys did not pan');

    await targetAtRest(testApi); // the pan's damping comes to rest
    const beforeOrbit = await stats(testApi);
    post(testApi, { type: 'test:key', target: 'view', key: 'Alt+ArrowLeft' });
    await pause(500);
    const orbited = await stats(testApi);
    const camera = (x: Record<string, number | boolean>) => [Number(x.cameraX), Number(x.cameraZ)];
    assert.ok(moved(camera(beforeOrbit), camera(orbited), 20), 'Alt + arrow did not orbit');
    assert.ok(
      !moved(target(beforeOrbit), target(orbited), 2),
      `Alt + arrow panned: ${String(target(beforeOrbit))} → ${String(target(orbited))}`,
    );

    post(testApi, { type: 'test:key', target: 'view', key: 'f' });
    await pause(1200);
    const refit = await fitBoxes(testApi, 1200, 800, true);
    const safe = refit.find((b) => b.name === 'safe');
    const city = refit.find((b) => b.name === 'city');
    assert.ok(safe && city, 'no safe area or city box');
    assert.ok(
      inside(safe, city),
      `after F the city ${JSON.stringify(city)} is outside ${JSON.stringify(safe)}`,
    );
  });

  test('3D: panning far away stops near the city (it can never be lost)', async () => {
    const testApi = await api();
    await freshCity(testApi, '3d');
    for (let i = 0; i < 12; i++) {
      post(testApi, { type: 'test:dragView', dx: 900, dy: 0, button: 2, shift: false });
      await pause(150);
    }
    await pause(800);
    const s = await stats(testApi);
    // The layout spans ±500 world units; the clamp allows half the city past the edge at most.
    assert.ok(
      Math.abs(Number(s.targetX)) <= 1001 && Math.abs(Number(s.targetZ)) <= 1001,
      `target ${String(target(s))}`,
    );
  });

  test('2D: a left-drag pans the viewport; a click without moving still selects', async () => {
    const testApi = await api();
    await freshCity(testApi, '2d');
    const before = await stats(testApi);
    assert.equal(before.mode2d, true);
    post(testApi, { type: 'test:dragView', dx: 180, dy: 90, button: 0, shift: false });
    await pause(500);
    const after = await stats(testApi);
    assert.ok(
      moved(
        [Number(before.viewCx), Number(before.viewCy)],
        [Number(after.viewCx), Number(after.viewCy)],
      ),
      `the 2D viewport did not move: ${String(before.viewCx)},${String(before.viewCy)} → ${String(after.viewCx)},${String(after.viewCy)}`,
    );
    // A two-finger trackpad drag pans too; a pinch zooms.
    post(testApi, { type: 'test:wheel', deltaX: 0, deltaY: 0.5, ctrl: false });
    post(testApi, { type: 'test:wheel', deltaX: 40, deltaY: 20, ctrl: false });
    await pause(300);
    const swiped = await stats(testApi);
    assert.ok(
      moved([Number(after.viewCx)], [Number(swiped.viewCx)], 0.01),
      'the trackpad drag did not pan',
    );
    post(testApi, { type: 'test:wheel', deltaX: 0, deltaY: -8, ctrl: true });
    await pause(300);
    assert.ok(
      Number((await stats(testApi)).zoom) > Number(swiped.zoom),
      'the pinch did not zoom in',
    );

    post(testApi, { type: 'test:key', target: 'view', key: 'Home' });
    await pause(300);
    post(testApi, { type: 'test:clickBuilding', path: TOP, double: false });
    await pause(400);
    assert.equal((await stats(testApi)).cardPinned, true, 'a click no longer selects in 2D');
  });

  for (const mode of ['3d', '2d'] as const) {
    test(`${mode}: fit puts the whole city inside the safe area at 360, 900 and 1400 px`, async () => {
      const testApi = await api();
      await freshCity(testApi, mode);
      for (const width of [360, 900, 1400]) {
        for (const rail of [true, false]) {
          const list = await fitBoxes(testApi, width, 760, rail);
          const safe = list.find((b) => b.name === 'safe');
          const city = list.find((b) => b.name === 'city');
          const where = `${mode} ${String(width)} px, rail ${rail ? 'open' : 'closed'}`;
          assert.ok(safe && city, `${where}: no safe area or city box`);
          assert.ok(safe.w > 0 && safe.h > 0, `${where}: empty safe area`);
          assert.ok(
            inside(safe, city),
            `${where}: city ${JSON.stringify(city)} outside safe ${JSON.stringify(safe)}`,
          );
          // At 360 px the rail and the legend leave no room; the safe area may then lie under
          // one of them (never under the HUD).
          const respected = list.filter(
            (b) => b.name === 'panel:hud' || (width > 360 && b.name.startsWith('panel:')),
          );
          for (const panel of respected) {
            assert.ok(
              !intersect(safe, panel),
              `${where}: safe area overlaps ${panel.name}: ${JSON.stringify(list)}`,
            );
          }
          // The city is not a speck: it fills most of the safe area's limiting side.
          assert.ok(
            Math.max(city.w / safe.w, city.h / safe.h) > 0.75,
            `${where}: city ${JSON.stringify(city)} too small for ${JSON.stringify(safe)}`,
          );
        }
      }
    });
  }

  test('3D: the top-5 pills never overlap each other or an overlay', async () => {
    const testApi = await api();
    await freshCity(testApi, '3d');
    let seen = 0;
    for (const action of [
      undefined,
      { type: 'test:key', target: 'view', key: '-' },
      { type: 'test:key', target: 'view', key: '-' },
      { type: 'test:key', target: 'view', key: 'Alt+ArrowLeft' },
      { type: 'test:dragView', dx: 200, dy: 0, button: 2, shift: false },
    ] as const) {
      if (action) post(testApi, action);
      await pause(600);
      const s = await settledPills(testApi);
      seen = Math.max(seen, Number(s.pills));
      assert.equal(s.pillOverlaps, 0, `pills overlap after ${JSON.stringify(action)}`);
    }
    assert.ok(seen > 0, 'no pill was ever shown');
  });

  test('⋯ → ? Controls shows the controls; the coach mark starts with them', async () => {
    const testApi = await api();
    await freshCity(testApi, '3d');
    post(testApi, { type: 'test:click', target: 'menu-controls' });
    await pause(200);
    assert.equal((await stats(testApi)).controlsOpen, true);
    post(testApi, { type: 'test:click', target: 'controls-close' });
    await pause(200);
    assert.equal((await stats(testApi)).controlsOpen, false);
    post(testApi, { type: 'test:click', target: 'fit' });
    await pause(900);
    assert.equal((await stats(testApi)).mode2d, false);
  });
});
