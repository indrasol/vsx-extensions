// The card, the rail and the legend never trap the city: they close, collapse, expand and move
// (drag to any corner, or the arrow keys on their header), and each remembers its place per
// workspace. The HUD never overlaps itself or a panel at 360, 640, 900 or 1400 px wide, with the
// card expanded or collapsed. Also: while a card is pinned, hovering shows a one-line tooltip,
// never a second card; and "How is this scored?" opens from the card and the legend.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type {
  AnyHostToWebview,
  Corner,
  PanelId,
  PanelPrefs,
  TestBox,
} from '../../src/city/protocol.js';
import type { TestApi } from '../../src/extension.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const TOP = 'src/core/engine.js';
const CORNERS: Corner[] = ['tl', 'tr', 'br', 'bl'];
/** The webview's `CORNERS` order: stats give each panel's corner as an index into it. */
const STAT_CORNERS: Corner[] = ['tl', 'tr', 'br', 'bl'];

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

/** A fresh city in 3D, coach closed; `reset` forgets the remembered panel places first. */
async function freshCity(testApi: TestApi, reset = false): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => cityTabs().length === 0, 'editors did not close');
  if (reset) await testApi.__panels.reset();
  const rendered = testApi.__city.nextMessage('rendered', 10_000);
  await vscode.commands.executeCommand('churnmap.open');
  await rendered;
  if ((await stats(testApi)).mode2d === true) {
    const changed = testApi.__city.nextMessage('viewChanged');
    post(testApi, { type: 'view', mode: '3d' });
    await changed;
  }
  post(testApi, { type: 'test:dismissCoach' });
  await pause(900);
}

async function select(testApi: TestApi): Promise<void> {
  post(testApi, { type: 'select', path: TOP });
  await pause(300);
  assert.equal((await stats(testApi)).cardPinned, true, 'the card is not pinned');
}

/** The next `setPanels` the webview posts after `act`. */
async function nextPanels(testApi: TestApi, act: () => void): Promise<PanelPrefs> {
  const saved = testApi.__city.nextMessage('setPanels');
  act();
  const message = await saved;
  assert.ok(message.type === 'setPanels');
  return message.panels;
}

function corner(s: Record<string, number | boolean>, id: PanelId): Corner | undefined {
  return STAT_CORNERS[Number(s[`${id}Corner`])];
}

async function boxes(testApi: TestApi, width: number, height: number): Promise<TestBox[]> {
  const reply = testApi.__city.nextMessage('test:boxes');
  post(testApi, { type: 'test:layout', width, height });
  const message = await reply;
  assert.ok(message.type === 'test:boxes');
  return message.boxes;
}

function intersect(a: TestBox, b: TestBox): boolean {
  // Half a pixel of tolerance for sub-pixel layout.
  return (
    a.x + 0.5 < b.x + b.w && b.x + 0.5 < a.x + a.w && a.y + 0.5 < b.y + b.h && b.y + 0.5 < a.y + a.h
  );
}

/** Every pair that must not overlap: HUD parts among themselves, panels with the HUD and each other. */
function overlaps(list: readonly TestBox[]): string[] {
  const hud = list.filter((b) => b.name.startsWith('hud:'));
  const panels = list.filter((b) => b.name.startsWith('panel:'));
  const out: string[] = [];
  const check = (group: readonly TestBox[]): void => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a && b && a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 && intersect(a, b)) {
          out.push(`${a.name} ${JSON.stringify(a)} × ${b.name} ${JSON.stringify(b)}`);
        }
      }
    }
  };
  check(hud);
  check(panels);
  return out;
}

suite('panels and the responsive HUD', () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    const testApi = await api();
    if (!testApi.__analysis()) await vscode.commands.executeCommand('churnmap.build');
    await freshCity(testApi, true);
  });

  suiteTeardown(async () => {
    const testApi = await api();
    await testApi.__panels.reset();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  for (const state of ['no card', 'card expanded', 'card collapsed'] as const) {
    test(`nothing in the HUD overlaps at 360, 640, 900 and 1400 px (${state})`, async function () {
      this.timeout(40_000);
      const testApi = await api();
      await freshCity(testApi, true);
      if (state !== 'no card') {
        await select(testApi);
        if (state === 'card collapsed') {
          await nextPanels(testApi, () => {
            post(testApi, { type: 'test:click', target: 'card-collapse' });
          });
          assert.equal((await stats(testApi)).cardCollapsed, true);
        }
      }
      for (const [width, height] of [
        [360, 640],
        [640, 480],
        [900, 700],
        [1400, 900],
      ] as const) {
        const list = await boxes(testApi, width, height);
        const names = list.map((b) => b.name);
        console.log(
          `      ${String(width)}×${String(height)} ${state}: ${String(list.length)} boxes, HUD ${JSON.stringify(list.find((b) => b.name === 'panel:hud'))}`,
        );
        assert.ok(names.includes('hud:hud-repo'), `no repository name at ${String(width)}`);
        assert.ok(names.includes('hud:ai-prompt'), `no AI prompt button at ${String(width)}`);
        assert.equal(names.includes('hud:hud-meta'), width >= 640, `meta at ${String(width)}`);
        if (state !== 'no card')
          assert.ok(names.includes('panel:card'), `no card at ${String(width)}`);
        const bad = overlaps(list);
        assert.deepEqual(bad, [], `overlaps at ${String(width)} px (${state})`);
        for (const b of list) {
          assert.ok(
            b.x >= -0.5 && b.x + b.w <= width + 0.5,
            `${b.name} leaves the canvas at ${String(width)}`,
          );
        }
      }
    });
  }

  test('the card closes with ×, collapses to a pill, and expands again (C too); remembered', async () => {
    const testApi = await api();
    await freshCity(testApi, true);
    await select(testApi);
    let prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:click', target: 'card-collapse' });
    });
    assert.equal(prefs.card.collapsed, true);
    let s = await stats(testApi);
    assert.equal(s.cardCollapsed, true);
    assert.equal(s.pinnedButtons, 0, 'the pill still shows the card’s buttons');
    prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:click', target: 'card-expand' });
    });
    assert.equal(prefs.card.collapsed, false);
    assert.equal((await stats(testApi)).pinnedButtons, 2);
    // C on the card toggles it too.
    prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:key', target: 'card-handle', key: 'c' });
    });
    assert.equal(prefs.card.collapsed, true);
    // Remembered: a new selection in a new city opens collapsed.
    await freshCity(testApi);
    await select(testApi);
    assert.equal((await stats(testApi)).cardCollapsed, true);
    await nextPanels(testApi, () => {
      post(testApi, { type: 'test:click', target: 'card-expand' });
    });
    // × closes the card and clears the selection.
    post(testApi, { type: 'test:click', target: 'card-close' });
    await pause(200);
    s = await stats(testApi);
    assert.equal(s.cardPinned, false);
    assert.equal(s.selected, false);
  });

  for (const id of ['card', 'rail', 'legend'] as const) {
    test(`the ${id} drags to each corner, and each corner is remembered`, async function () {
      this.timeout(30_000);
      const testApi = await api();
      await freshCity(testApi, true);
      if (id === 'card') await select(testApi);
      for (const target of CORNERS) {
        const before = corner(await stats(testApi), id);
        if (before === target) continue;
        const prefs = await nextPanels(testApi, () => {
          post(testApi, { type: 'test:drag', panel: id, corner: target });
        });
        assert.equal(prefs[id].corner, target, `${id} did not land in ${target}`);
        assert.equal(corner(await stats(testApi), id), target);
        const stored = testApi.__panels.stored() as PanelPrefs | undefined;
        assert.equal(stored?.[id].corner, target, `${id} ${target} was not saved`);
        const list = await boxes(testApi, 1200, 800);
        assert.deepEqual(overlaps(list), [], `${id} in ${target} overlaps`);
      }
      // A new city puts it back where it was left.
      const last = corner(await stats(testApi), id);
      await freshCity(testApi);
      assert.equal(corner(await stats(testApi), id), last);
    });
  }

  test('arrow keys and Enter on a header move the panel between corners', async () => {
    const testApi = await api();
    await freshCity(testApi, true);
    let prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:key', target: 'legend-handle', key: 'ArrowUp' });
    });
    assert.equal(prefs.legend.corner, 'tl');
    prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:key', target: 'legend-handle', key: 'Enter' });
    });
    assert.equal(prefs.legend.corner, 'tr');
    prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:key', target: 'rail-handle', key: 'ArrowLeft' });
    });
    assert.equal(prefs.rail.corner, 'tl');
  });

  test('the rail and legend collapse, expand and close; ⋯ brings them back', async () => {
    const testApi = await api();
    await freshCity(testApi, true);
    let prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:click', target: 'legend-collapse' });
    });
    assert.equal(prefs.legend.collapsed, true);
    prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:click', target: 'legend-collapse' });
    });
    assert.equal(prefs.legend.collapsed, false);
    prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:click', target: 'legend-close' });
    });
    assert.equal(prefs.legend.hidden, true);
    prefs = await nextPanels(testApi, () => {
      post(testApi, { type: 'test:click', target: 'rail-close' });
    });
    assert.equal(prefs.rail.hidden, true);
    let s = await stats(testApi);
    assert.equal(s.legendHidden, true);
    assert.equal(s.railHidden, true);
    assert.equal(s.railCards, 0, 'the closed rail still shows its cards');
    // Remembered, then brought back from the ⋯ menu.
    await freshCity(testApi);
    s = await stats(testApi);
    assert.equal(s.legendHidden, true);
    assert.equal(s.railHidden, true);
    for (const item of ['menu-show-legend', 'menu-show-rail']) {
      await nextPanels(testApi, () => {
        post(testApi, { type: 'test:click', target: 'more' });
        post(testApi, { type: 'test:click', target: item });
      });
    }
    s = await stats(testApi);
    assert.equal(s.legendHidden, false);
    assert.equal(s.railHidden, false);
    assert.ok(Number(s.railCards) >= 1);
  });

  test('while a card is pinned, hovering another building shows a one-line tooltip, not a card', async () => {
    const testApi = await api();
    await freshCity(testApi, true);
    const hovered = testApi.__city.nextMessage('hover');
    post(testApi, { type: 'test:clickBuilding', path: TOP, double: false });
    await hovered;
    await pause(300);
    assert.equal((await stats(testApi)).cardPinned, true);
    // Wait for the fly-to, then move a real pointer over another building (not a click).
    await pause(900);
    // Skip hover messages from before the move (the pointer leaving TOP, the real mouse).
    const moved = (async (): Promise<string | null> => {
      const deadline = Date.now() + 5000;
      for (;;) {
        const message = await testApi.__city.nextMessage(
          'hover',
          Math.max(1, deadline - Date.now()),
        );
        if (message.type === 'hover' && message.path !== null && message.path !== TOP) {
          return message.path;
        }
      }
    })();
    post(testApi, { type: 'test:hoverAny', except: TOP });
    assert.ok(await moved, 'no other building was hovered');
    await pause(200);
    const s = await stats(testApi);
    assert.equal(s.hoverCard, false, 'a second full card appeared');
    assert.equal(s.hoverTip, true, 'no tooltip');
  });

  test('"How is this scored?" opens from the card and from the legend; Escape closes it', async () => {
    const testApi = await api();
    await freshCity(testApi, true);
    await select(testApi);
    post(testApi, { type: 'test:click', target: 'card-explain' });
    await pause(200);
    assert.equal((await stats(testApi)).explainerOpen, true);
    post(testApi, { type: 'test:key', target: 'explainer-close', key: 'Escape' });
    await pause(100);
    assert.equal((await stats(testApi)).explainerOpen, false);
    post(testApi, { type: 'test:click', target: 'legend-explain' });
    await pause(200);
    assert.equal((await stats(testApi)).explainerOpen, true);
    post(testApi, { type: 'test:click', target: 'explainer-close' });
    await pause(100);
    assert.equal((await stats(testApi)).explainerOpen, false);
  });
});
