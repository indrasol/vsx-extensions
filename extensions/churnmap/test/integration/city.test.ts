import * as assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { AnyWebviewToHost } from '../../src/city/protocol.js';
import { layoutCity } from '../../src/city/layout.js';
import type { TestApi } from '../../src/extension.js';
import { hoverOf } from './helpers.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const RENDER_TIMEOUT_MS = 10_000;
/**
 * ADR-0011 with a 32-byte base64url nonce (43 characters) and VS Code's `webview.cspSource`
 * (for example `'self' https://*.vscode-cdn.net`, so it may contain a space).
 */
const CSP =
  /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-([A-Za-z0-9_-]{43})'; style-src 'nonce-\1' ([^;"]+); img-src \2 data:;">/;

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

function cityTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label === 'Churnmap' && tab.input instanceof vscode.TabInputWebview);
}

/** Tab groups update asynchronously after a panel opens or closes. */
async function waitFor(condition: () => boolean, message: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function closeCity(): Promise<void> {
  await vscode.window.tabGroups.close(cityTabs());
}

/** Resolves with `rendered`, or with the webview's `error` if it reports one first. */
function renderedOrError(testApi: TestApi): Promise<AnyWebviewToHost> {
  return Promise.race([
    testApi.__city.nextMessage('rendered', RENDER_TIMEOUT_MS),
    testApi.__city.nextMessage('error', RENDER_TIMEOUT_MS + 1000),
  ]);
}

suite('city webview', () => {
  suiteSetup(async () => {
    await closeCity();
  });

  test('churnmap.open shows one "Churnmap" editor tab with the ADR-0011 CSP', async () => {
    const testApi = await api();
    const ready = testApi.__city.nextMessage('ready');
    await vscode.commands.executeCommand('churnmap.open');
    await vscode.commands.executeCommand('churnmap.open'); // a second call reveals, not duplicates
    await waitFor(() => cityTabs().length > 0, 'the Churnmap tab did not appear');
    assert.equal(cityTabs().length, 1);
    await ready;

    const html = testApi.__city.html() ?? '';
    const csp = CSP.exec(html);
    assert.ok(csp, `CSP missing or different from ADR-0011:\n${html.slice(0, 600)}`);
    assert.doesNotMatch(html, /unsafe-/);
    // Every script and stylesheet carries the nonce.
    for (const tag of html.match(/<(script|link)\b[^>]*>/gi) ?? []) {
      assert.ok(tag.includes(`nonce="${csp[1] ?? ''}"`), tag);
    }
  });

  test(`after build the host receives "rendered" with ≥ 3 buildings within ${String(RENDER_TIMEOUT_MS / 1000)} s`, async function () {
    const testApi = await api();
    const next = renderedOrError(testApi);
    const start = performance.now();
    await vscode.commands.executeCommand('churnmap.build');
    const message = await next;
    const elapsed = performance.now() - start;
    if (message.type === 'error') {
      // No WebGL in this VS Code build (for example a headless CI machine without GPU or
      // SwiftShader): the webview reports it instead of rendering.
      assert.match(message.message, /WebGL/);
      console.log(`      webview reported: ${message.message} — render assertion pending`);
      this.skip();
    }
    assert.equal(message.type, 'rendered');
    assert.ok(message.buildings >= 3, `only ${String(message.buildings)} buildings`);
    console.log(
      `      rendered ${String(message.buildings)} buildings: webview ${message.ms.toFixed(1)} ms, build → rendered ${elapsed.toFixed(0)} ms (VS Code ${vscode.version})`,
    );
  });

  test('a new panel gets a fresh nonce', async () => {
    const testApi = await api();
    const first = CSP.exec(testApi.__city.html() ?? '')?.[1];
    await closeCity();
    await waitFor(() => cityTabs().length === 0, 'the Churnmap tab did not close');
    const ready = testApi.__city.nextMessage('ready');
    await vscode.commands.executeCommand('churnmap.open');
    await ready;
    const second = CSP.exec(testApi.__city.html() ?? '')?.[1];
    assert.ok(first && second);
    assert.notEqual(first, second);
  });
});

suite('city performance (synthetic 10 000 buildings)', () => {
  const BENCH_TIMEOUT_MS = process.env.CI ? 120_000 : 30_000;
  const BENCH_FRAMES = process.env.CI ? 60 : 240;

  test('renders 10k instanced buildings in 4 draw calls; orbit frame time vs a 7-building baseline', async function () {
    // A Linux CI runner renders WebGL in software: fewer orbit frames, more time.
    this.timeout(process.env.CI ? 300_000 : 60_000);
    const testApi = await api();
    // Baseline in the same window: the 7-building fixture city. If its frame interval equals the
    // 10k city's, the interval is the window's frame-rate cap (vsync or background throttling),
    // not rendering cost.
    const baseline = testApi.__city.nextMessage('test:stats', BENCH_TIMEOUT_MS);
    assert.ok(testApi.__city.post({ type: 'test:bench', frames: 120 }), 'no ready city panel');
    const small = await baseline;
    assert.equal(small.type, 'test:stats');
    console.log(`      fixture city baseline: ${JSON.stringify(small.stats)}`);
    // A synthetic monorepo: 10 000 files over nested folders (no real repository needed).
    const files = Array.from({ length: 10_000 }, (_, i) => ({
      path: `pkg${String(i % 23)}/src/m${String(i % 7)}/d${String(i % 11)}/f${String(i)}.ts`,
      loc: 20 + ((i * 7919) % 1500),
      score: (i * 37) % 100,
    }));
    const layout = layoutCity(files);
    const rendered = testApi.__city.nextMessage('rendered', BENCH_TIMEOUT_MS);
    assert.ok(
      testApi.__city.post({
        type: 'analysis',
        layout,
        top: [],
        window: 90,
        repoName: 'synthetic-10k',
        ignored: [],
        notes: {},
      }),
      'no ready city panel',
    );
    const message = await rendered;
    assert.equal(message.type, 'rendered');
    const stats = testApi.__city.nextMessage('test:stats', BENCH_TIMEOUT_MS);
    testApi.__city.post({ type: 'test:bench', frames: BENCH_FRAMES });
    const bench = await stats;
    assert.equal(bench.type, 'test:stats');
    console.log(
      `      10k city: rendered in ${message.ms.toFixed(1)} ms; orbit ${JSON.stringify(bench.stats)} (VS Code ${vscode.version})`,
    );
    assert.equal(bench.stats.buildings, layout.buildings.length);
    assert.equal(bench.stats.cspViolations, 0, 'the webview reported CSP violations');
    // The gradient backdrop + ground + plates + solid buildings; no glass (all scored), no glow
    // (no top list), and no shadow pass above 5 000 buildings.
    assert.equal(bench.stats.drawCalls, 4);
    assert.equal(bench.stats.shadows, false);
    // The intro on 10k buildings, replayed and timed (budget ≥ 45 fps). Motion is forced on: with
    // the OS asking for reduced motion (as on some CI runners) the intro is, rightly, instant.
    const intro = testApi.__city.nextMessage('test:stats', BENCH_TIMEOUT_MS);
    testApi.__city.post({ type: 'test:reducedMotion', on: false });
    testApi.__city.post({ type: 'test:benchIntro' });
    const introStats = await intro.finally(() =>
      testApi.__city.post({ type: 'test:reducedMotion', on: null }),
    );
    assert.equal(introStats.type, 'test:stats');
    console.log(`      10k intro: ${JSON.stringify(introStats.stats)}`);
    assert.ok(Number(introStats.stats.introFrames) > 1, 'the intro drew no frames');

    // 5 000 buildings: the largest city that gets shadows, so every effect is on.
    const five = layoutCity(files.slice(0, 5000));
    const fiveRendered = testApi.__city.nextMessage('rendered', BENCH_TIMEOUT_MS);
    testApi.__city.post({
      type: 'analysis',
      layout: five,
      top: [],
      window: 90,
      repoName: 'synthetic-5k',
      ignored: [],
      notes: {},
    });
    await fiveRendered;
    const fiveStats = testApi.__city.nextMessage('test:stats', BENCH_TIMEOUT_MS);
    testApi.__city.post({ type: 'test:bench', frames: BENCH_FRAMES });
    const fiveBench = await fiveStats;
    assert.equal(fiveBench.type, 'test:stats');
    console.log(`      5k city, shadows on: ${JSON.stringify(fiveBench.stats)}`);
    // 5 000 is the largest city that gets shadows. A slow runner's adaptive quality may have shed
    // them (the first step it drops, reported as qualityLevel ≥ 1); otherwise they must be on.
    assert.equal(fiveBench.stats.shadows, Number(fiveBench.stats.qualityLevel) === 0);
    assert.equal(fiveBench.stats.cspViolations, 0);
  });
});

/** Closes every editor, opens the city and waits until it has rendered the current analysis. */
async function freshCity(testApi: TestApi): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor(() => cityTabs().length === 0, 'editors did not close');
  const rendered = testApi.__city.nextMessage('rendered', RENDER_TIMEOUT_MS);
  await vscode.commands.executeCommand('churnmap.open');
  await rendered;
  // The remembered view follows the analysis; let it (and its viewChanged) settle first.
  await drain(testApi);
}

/** Messages are handled in order, so a stats round trip means everything before it was handled. */
async function drain(testApi: TestApi): Promise<Record<string, number | boolean>> {
  const reply = testApi.__city.nextMessage('test:stats');
  assert.ok(testApi.__city.post({ type: 'test:stats' }), 'no ready city panel');
  const message = await reply;
  assert.equal(message.type, 'test:stats');
  return message.stats;
}

/**
 * Waits until no animation runs and the frame counter has stopped moving (two reads 150 ms apart
 * agree), then returns those stats. Only for cities without a glow, which never stop pulsing.
 */
async function settled(
  testApi: TestApi,
  timeoutMs = 5000,
): Promise<Record<string, number | boolean>> {
  const deadline = Date.now() + timeoutMs;
  let previous = await drain(testApi);
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const now = await drain(testApi);
    if (
      now.tweening === false &&
      now.animating === false &&
      now.framesRendered === previous.framesRendered
    ) {
      return now;
    }
    assert.ok(Date.now() < deadline, `the city did not settle: ${JSON.stringify(now)}`);
    previous = now;
  }
}

/**
 * The render-settled signal: replies once no tween or morph runs and two more frames have drawn.
 * Works with a pulsing glow (unlike `settled`), so screenshots wait on it instead of a fixed delay.
 */
async function renderSettled(
  testApi: TestApi,
  timeoutMs = 10_000,
): Promise<Record<string, number | boolean>> {
  const reply = testApi.__city.nextMessage('test:stats', timeoutMs + 5000);
  assert.ok(testApi.__city.post({ type: 'test:settle', timeoutMs }), 'no ready city panel');
  const message = await reply;
  assert.equal(message.type, 'test:stats');
  assert.equal(
    message.stats.settled,
    true,
    `the city did not settle: ${JSON.stringify(message.stats)}`,
  );
  return message.stats;
}

function activePath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath.split(/[\\/]/).join('/');
}

async function waitForEditor(suffix: string, timeoutMs = 5000): Promise<number> {
  const start = performance.now();
  await waitFor(() => activePath()?.endsWith(suffix) ?? false, `${suffix} did not open`, timeoutMs);
  return performance.now() - start;
}

suite('city interaction (message round trips)', () => {
  const TOP = 'src/core/engine.js';

  suiteSetup(async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.build');
    await freshCity(testApi);
  });

  test('select from the host flies to the building and reports it as hovered', async () => {
    const testApi = await api();
    const hover = hoverOf(testApi, TOP);
    assert.ok(testApi.__city.post({ type: 'select', path: TOP }));
    await hover;
  });

  test('openFile emitted by the webview opens the file at line 1', async () => {
    const testApi = await api();
    await freshCity(testApi);
    const before = testApi.__city.received('openFile');
    assert.ok(testApi.__city.post({ type: 'test:emit', payload: { type: 'openFile', path: TOP } }));
    const ms = await waitForEditor(TOP);
    assert.equal(testApi.__city.received('openFile'), before + 1);
    assert.equal(vscode.window.activeTextEditor?.selection.active.line, 0);
    console.log(`      openFile round trip: ${ms.toFixed(0)} ms`);
  });

  test('openFile refuses "..", absolute and missing paths', async () => {
    const testApi = await api();
    await freshCity(testApi);
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    for (const path of [
      '../outside.js',
      `${root}/src/core/engine.js`,
      'src/missing.js',
      'src/big/…',
    ]) {
      const opened = await vscode.commands.executeCommand<boolean>('churnmap.openFile', path);
      assert.equal(opened, false, path);
    }
    assert.equal(vscode.window.activeTextEditor, undefined, 'an editor opened');
    // From the webview, a traversal path never reaches the command: the guard drops it.
    const before = testApi.__city.received('openFile');
    testApi.__city.post({
      type: 'test:emit',
      payload: { type: 'openFile', path: '../outside.js' },
    });
    await drain(testApi);
    assert.equal(testApi.__city.received('openFile'), before);
    assert.equal(vscode.window.activeTextEditor, undefined, 'an editor opened');
  });

  test('setWindow from the HUD saves the setting and posts a new analysis', async () => {
    const testApi = await api();
    await freshCity(testApi);
    try {
      const analysis = testApi.__city.nextPosted('analysis', 20_000);
      assert.ok(
        testApi.__city.post({ type: 'test:emit', payload: { type: 'setWindow', window: 30 } }),
      );
      const message = await analysis;
      assert.equal(message.type === 'analysis' && message.window, 30);
      assert.equal(vscode.workspace.getConfiguration('churnmap').get('window'), 30);
    } finally {
      await vscode.workspace
        .getConfiguration('churnmap')
        .update('window', undefined, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand('churnmap.build');
    }
  });

  test('the animation loop runs only while the top-20 glow pulses', async () => {
    const testApi = await api();
    await freshCity(testApi);
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // The fixture city has ranked files, so the glow pulses (unless the OS asks for reduced motion).
    const a = await drain(testApi);
    await pause(300);
    const b = await drain(testApi);
    console.log(`      with glow: ${JSON.stringify(b)}`);
    assert.ok(Number(a.glowing) > 0);
    if (a.reducedMotion === true) {
      assert.equal(b.animating, false);
      assert.equal(b.animationFrames, a.animationFrames);
    } else {
      assert.equal(b.animating, true);
      assert.ok(Number(b.animationFrames) > Number(a.animationFrames), 'the pulse did not run');
    }
    // A city with nothing ranked: no glow, so once its 400 ms morph has settled, no loop and no
    // frames while still.
    const unranked = layoutCity([
      { path: 'a.ts', loc: 100, score: 10 },
      { path: 'b/c.ts', loc: 50, score: 90 },
    ]);
    const rendered = testApi.__city.nextMessage('rendered');
    testApi.__city.post({
      type: 'analysis',
      layout: unranked,
      top: [],
      window: 90,
      repoName: 'still',
      ignored: [],
      notes: {},
    });
    await rendered;
    const c = await settled(testApi);
    await pause(300);
    const d = await drain(testApi);
    console.log(`      without glow: ${JSON.stringify(d)}`);
    assert.equal(d.glowing, 0);
    assert.equal(d.animating, false);
    assert.equal(d.animationFrames, c.animationFrames, 'frames were drawn while nothing moved');
    assert.equal(d.framesRendered, c.framesRendered, 'frames were drawn while nothing moved');
  });

  test('a hidden panel is torn down (no loop can run) and re-renders when shown', async () => {
    const testApi = await api();
    await freshCity(testApi);
    const readyBefore = testApi.__city.received('ready');
    // Opening a file in the same group hides the city; retainContextWhenHidden is off.
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('/'),
        'README.md',
      ),
    );
    await waitFor(() => !cityTabs().some((t) => t.isActive), 'the city stayed active');
    assert.equal(
      testApi.__city.post({ type: 'test:stats' }),
      false,
      'a hidden city accepted messages',
    );
    const rendered = testApi.__city.nextMessage('rendered');
    await vscode.commands.executeCommand('churnmap.open');
    await rendered;
    assert.equal(testApi.__city.received('ready'), readyBefore + 1);
  });
});

suite('2D treemap toggle', () => {
  const TOP = 'src/core/engine.js';
  // 100 ms on a developer machine; CI runners render WebGL in software (Linux) and get 3×.
  const TOGGLE_BUDGET_MS = process.env.CI ? 300 : 100;

  /** Toggles and times the webview's switch: from the host posting `view` to `viewChanged`. */
  async function toggle(testApi: TestApi): Promise<{ mode: string; ms: number; total: number }> {
    const posted = testApi.__city.nextPosted('view');
    const changed = testApi.__city.nextMessage('viewChanged');
    const start = performance.now();
    await vscode.commands.executeCommand('churnmap.toggleTreemap');
    await posted;
    const postedAt = performance.now();
    const message = await changed;
    const end = performance.now();
    if (message.type !== 'viewChanged') throw new Error(`unexpected ${message.type}`);
    return { mode: message.mode, ms: end - postedAt, total: end - start };
  }

  suiteSetup(async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.build');
    await freshCity(testApi);
  });

  test(`toggleTreemap switches to 2D in < ${String(TOGGLE_BUDGET_MS)} ms without re-sending the analysis`, async () => {
    const testApi = await api();
    const analyses = testApi.__city.posted('analysis');
    const { mode, ms, total } = await toggle(testApi);
    console.log(
      `      toggle → 2d: view posted → viewChanged ${ms.toFixed(1)} ms (command → viewChanged ${total.toFixed(1)} ms)`,
    );
    assert.equal(mode, '2d');
    assert.ok(ms < TOGGLE_BUDGET_MS, `toggle took ${ms.toFixed(1)} ms`);
    assert.equal(testApi.__city.posted('analysis'), analyses, 'the analysis was sent again');
    const stats = await drain(testApi);
    assert.equal(stats.mode2d, true);
    assert.equal(stats.animating, false);
    console.log(`      2d stats: ${JSON.stringify(stats)}`);
  });

  test('select works in 2D and reports the hover', async () => {
    const testApi = await api();
    const hover = hoverOf(testApi, TOP);
    assert.ok(testApi.__city.post({ type: 'select', path: TOP }));
    await hover;
  });

  test('openFile emitted from the 2D view opens the file', async () => {
    const testApi = await api();
    assert.equal((await drain(testApi)).mode2d, true);
    testApi.__city.post({ type: 'test:emit', payload: { type: 'openFile', path: TOP } });
    await waitForEditor(TOP);
    // Reopening the city restores the remembered 2D mode (sent right after the analysis).
    const view = testApi.__city.nextPosted('view');
    await freshCity(testApi);
    const message = await view;
    assert.equal(message.type === 'view' && message.mode, '2d');
    assert.equal((await drain(testApi)).mode2d, true);
  });

  test('draws 20 000 rects in ≤ 50 ms at 1×', async function () {
    this.timeout(60_000);
    const testApi = await api();
    const files = Array.from({ length: 20_000 }, (_, i) => ({
      path: `pkg${String(i % 29)}/src/m${String(i % 7)}/d${String(i % 13)}/f${String(i)}.ts`,
      loc: 20 + ((i * 7919) % 1500),
      score: (i * 37) % 100,
    }));
    const layout = layoutCity(files, { maxBuildings: 20_000 });
    assert.equal(layout.buildings.length, 20_000);
    const rendered = testApi.__city.nextMessage('rendered', 20_000);
    testApi.__city.post({
      type: 'analysis',
      layout,
      top: [],
      window: 90,
      repoName: 'synthetic-20k',
      ignored: [],
      notes: {},
    });
    await rendered;
    const reply = testApi.__city.nextMessage('test:stats', 30_000);
    testApi.__city.post({ type: 'test:bench', frames: 10 });
    const bench = await reply;
    assert.equal(bench.type, 'test:stats');
    console.log(`      2d 20k: ${JSON.stringify(bench.stats)} (VS Code ${vscode.version})`);
    assert.equal(bench.stats.buildings, 20_000);
    assert.ok(
      Number(bench.stats.draw1xMeanMs) <= 50,
      `mean draw ${String(bench.stats.draw1xMeanMs)} ms`,
    );
    assert.equal(bench.stats.cspViolations, 0);
  });

  test('toggling back returns to the 3D city', async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('churnmap.build'); // the real analysis again
    await freshCity(testApi);
    const analyses = testApi.__city.posted('analysis');
    const { mode, ms } = await toggle(testApi);
    console.log(`      toggle → 3d: ${ms.toFixed(1)} ms`);
    assert.equal(mode, '3d');
    assert.ok(ms < TOGGLE_BUDGET_MS, `toggle took ${ms.toFixed(1)} ms`);
    assert.equal(testApi.__city.posted('analysis'), analyses);
    assert.equal((await drain(testApi)).mode2d, false);
  });
});

suite('visual refresh', () => {
  const TOP = 'src/core/engine.js';

  suiteSetup(async () => {
    await vscode.commands.executeCommand('churnmap.build');
  });

  test('the analysis message carries weekly commits and plain sentences for the top files', async () => {
    const testApi = await api();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitFor(() => cityTabs().length === 0, 'editors did not close');
    const posted = testApi.__city.nextPosted('analysis', RENDER_TIMEOUT_MS);
    await vscode.commands.executeCommand('churnmap.open');
    const message = await posted;
    assert.ok(message.type === 'analysis');
    assert.ok(message.top.length > 0, 'no top files');
    for (const entry of message.top) {
      assert.equal(entry.weekly.length, 13, `${entry.path}: ${String(entry.weekly.length)} weeks`);
      assert.ok(entry.weekly.every((n) => Number.isInteger(n) && n >= 0));
      assert.ok(entry.sentences.length > 0 && entry.sentences.length <= 3);
      for (const sentence of entry.sentences) assert.ok(sentence.length <= 120, sentence);
    }
    const first = message.top[0];
    console.log(
      `      #1 ${first?.path ?? ''}: ${JSON.stringify(first?.sentences)} weekly ${JSON.stringify(first?.weekly)}`,
    );
    for (const list of Object.values(message.notes)) {
      assert.ok(list.length <= 2 && list.every((n) => n.length <= 80));
    }
    const unranked = message.layout.buildings.filter((b) => b.why !== undefined);
    console.log(
      `      ${String(unranked.length)} unranked (glass) buildings, ${String(Object.keys(message.notes).length)} with notes`,
    );
    await testApi.__city.nextMessage('rendered', RENDER_TIMEOUT_MS).catch(() => undefined);
  });

  test('a window switch tweens heights and colours in place: frames rise then settle, no new meshes', async function () {
    this.timeout(40_000);
    const testApi = await api();
    await freshCity(testApi);
    const before = await drain(testApi);
    try {
      const rendered = testApi.__city.nextMessage('rendered', 20_000);
      assert.ok(
        testApi.__city.post({ type: 'test:emit', payload: { type: 'setWindow', window: 30 } }),
      );
      await rendered;
      const during = await drain(testApi);
      // The 400 ms tween ends and stays ended (the glow pulse keeps the loop itself running).
      let after = await drain(testApi);
      const deadline = Date.now() + 5000;
      while (after.tweening !== false) {
        assert.ok(Date.now() < deadline, `the tween did not settle: ${JSON.stringify(after)}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        after = await drain(testApi);
      }
      console.log(
        `      window switch: tweenFrames ${String(before.tweenFrames)} → ${String(after.tweenFrames)}, meshes ${String(before.instancedMeshes)} → ${String(after.instancedMeshes)}, tweening ${String(during.tweening)} → ${String(after.tweening)}`,
      );
      assert.equal(after.instancedMeshes, before.instancedMeshes, 'the switch allocated meshes');
      assert.ok(Number(after.tweenFrames) > Number(before.tweenFrames), 'no tween frames');
      assert.equal(after.tweening, false, 'the tween did not settle');
      assert.equal(after.cspViolations, 0);
    } finally {
      await vscode.workspace
        .getConfiguration('churnmap')
        .update('window', undefined, vscode.ConfigurationTarget.Workspace);
      await vscode.commands.executeCommand('churnmap.build');
    }
  });

  test('the coach mark shows the first time a city opens, then never again', async () => {
    const testApi = await api();
    await testApi.__coach.reset();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitFor(() => cityTabs().length === 0, 'editors did not close');
    const coach = testApi.__city.nextPosted('coach');
    await freshCity(testApi);
    await coach;
    const shown = await drain(testApi);
    assert.equal(shown.coachVisible, true);
    // The flag is written without awaiting; globalState settles through the main process, where a
    // late echo of the reset above can briefly win.
    await waitFor(() => testApi.__coach.shown() === true, 'the coach mark was not remembered');
    const count = testApi.__city.posted('coach');
    testApi.__city.post({ type: 'test:dismissCoach' });
    assert.equal((await drain(testApi)).coachVisible, false);
    await freshCity(testApi);
    const again = await drain(testApi);
    assert.equal(again.coachVisible, false, 'the coach mark came back');
    assert.equal(testApi.__city.posted('coach'), count);
    assert.equal(again.cspViolations, 0);
  });

  test('the default view explains itself: top-5 labels and a 3-card insights rail', async () => {
    const testApi = await api();
    await freshCity(testApi);
    await new Promise((resolve) => setTimeout(resolve, 1200)); // intro done, labels placed
    const stats = await drain(testApi);
    console.log(`      default view: ${JSON.stringify(stats)}`);
    assert.equal(stats.railOpen, true);
    assert.ok(Number(stats.railCards) >= 1 && Number(stats.railCards) <= 3);
    assert.equal(stats.cspViolations, 0);
  });

  test('screenshots: the fixture city at 1600×900 in dark and light (test-output/)', async function () {
    this.timeout(60_000);
    const testApi = await api();
    const root = vscode.extensions.getExtension(EXTENSION_ID)?.extensionPath ?? '.';
    const dir = join(root, 'test-output');
    mkdirSync(dir, { recursive: true });
    const label = vscode.version === '1.96.0' ? 'min' : 'stable';

    async function shoot(name: string): Promise<void> {
      testApi.__city.post({ type: 'test:dismissCoach' });
      await renderSettled(testApi);
      const reply = testApi.__city.nextMessage('test:capture', 30_000);
      assert.ok(testApi.__city.post({ type: 'test:capture', width: 1600, height: 900 }));
      const message = await reply;
      assert.ok(message.type === 'test:capture');
      const file = join(dir, `${name}-${label}.png`);
      writeFileSync(file, Buffer.from(message.png));
      console.log(`      screenshot: ${file} (${String(message.png.byteLength)} bytes)`);
    }

    const config = vscode.workspace.getConfiguration('workbench');
    try {
      await config.update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
      await freshCity(testApi);
      await shoot('city-dark');
      const hover = hoverOf(testApi, TOP);
      testApi.__city.post({ type: 'select', path: TOP });
      await hover;
      await shoot('city-dark-card');

      await config.update('colorTheme', 'Default Light Modern', vscode.ConfigurationTarget.Global);
      // The webview's CSS variables follow the theme a moment after the host's message: wait for
      // the body's theme class, then send the theme again so the city reads the new colours.
      const deadline = Date.now() + 10_000;
      while ((await renderSettled(testApi)).bodyLight !== true) {
        assert.ok(Date.now() < deadline, 'the webview never switched to the light theme');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      testApi.__city.post({ type: 'theme', kind: 'light' });
      await freshCity(testApi);
      await shoot('city-light');
      const toggled = testApi.__city.nextMessage('viewChanged');
      testApi.__city.post({ type: 'view', mode: '2d' });
      await toggled;
      await shoot('treemap-light');
      const back = testApi.__city.nextMessage('viewChanged');
      testApi.__city.post({ type: 'view', mode: '3d' });
      await back;
      const stats = await drain(testApi);
      assert.equal(stats.cspViolations, 0);
    } finally {
      await config.update('colorTheme', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
