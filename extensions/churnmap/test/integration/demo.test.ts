import * as assert from 'node:assert';
import { Buffer } from 'node:buffer';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';

// Runs only in the `demo` configuration (CHURNMAP_DEMO=1, scripts/make-demo-gif.mjs), on the
// README demo repository. Records the demo GIF's frames at exact times on a frozen animation
// clock (`test:clock` / `test:frame`), so the motion is the same on every run and on any machine,
// however long each capture takes. Writes test-output/demo/frame-NNN.png and two 1600×900 stills.

const EXTENSION_ID = 'Indrasol.churnmap';
const FPS = 15;
const WIDTH = 960;
const HEIGHT = 540;

/** The storyboard, in seconds: what happens at each moment of the 10-second GIF. */
const SECONDS = 10;
const AT = { fly: 2, rail: 5, flat: 7, back: 8.6 } as const;

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function drain(testApi: TestApi): Promise<void> {
  const reply = testApi.__city.nextMessage('test:stats');
  assert.ok(testApi.__city.post({ type: 'test:stats' }), 'no ready city panel');
  await reply;
}

async function capture(
  testApi: TestApi,
  message: { type: 'test:frame' | 'test:capture'; width: number; height: number },
): Promise<Buffer> {
  const reply = testApi.__city.nextMessage('test:capture', 30_000);
  assert.ok(testApi.__city.post(message), 'no ready city panel');
  const answer = await reply;
  assert.ok(answer.type === 'test:capture');
  return Buffer.from(answer.png);
}

suite('Demo GIF frames', () => {
  test('records the storyboard at 15 fps on a frozen clock', async function () {
    this.timeout(600_000);
    const testApi = await api();
    const root = vscode.extensions.getExtension(EXTENSION_ID)?.extensionPath ?? '.';
    const dir = join(root, 'test-output', 'demo');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const workbench = vscode.workspace.getConfiguration('workbench');
    await workbench.update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
    try {
      const rendered = testApi.__city.nextMessage('rendered', 60_000);
      await vscode.commands.executeCommand('churnmap.build');
      await rendered;
      await drain(testApi);
      testApi.__city.post({ type: 'test:dismissCoach' });
      testApi.__city.post({ type: 'theme', kind: 'dark' });
      await pause(1500);

      const top = testApi.__analysis()?.top ?? [];
      const first = top[0]?.file.path;
      assert.ok(first && top.length >= 3, 'the demo repository has no top-3 hotspots');
      console.log(`      #1 ${first}, #2 ${top[1]?.file.path ?? ''}`);

      // Freeze the clock, then replay the intro from its first frame.
      testApi.__city.post({ type: 'test:clock', advance: 0 });
      testApi.__city.post({ type: 'test:benchIntro' });

      const frames = SECONDS * FPS;
      const step = 1000 / FPS;
      const cue = (seconds: number, i: number) => i === Math.round(seconds * FPS);
      for (let i = 0; i < frames; i++) {
        if (i > 0) testApi.__city.post({ type: 'test:clock', advance: step });
        if (cue(AT.fly, i)) testApi.__city.post({ type: 'select', path: first });
        if (cue(AT.rail, i)) testApi.__city.post({ type: 'test:railFly', rank: 2 });
        if (cue(AT.flat, i)) testApi.__city.post({ type: 'view', mode: '2d' });
        if (cue(AT.back, i)) testApi.__city.post({ type: 'view', mode: '3d' });
        const png = await capture(testApi, { type: 'test:frame', width: WIDTH, height: HEIGHT });
        writeFileSync(join(dir, `frame-${String(i).padStart(3, '0')}.png`), png);
      }
      testApi.__city.post({ type: 'test:clock', advance: null });
      console.log(`      ${String(frames)} frames: ${dir}`);

      // The README stills, from a freshly opened city (no focus left from the recording): the
      // city with #1's card (dark), and the treemap (light).
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await pause(500);
      const reopened = testApi.__city.nextMessage('rendered', 60_000);
      await vscode.commands.executeCommand('churnmap.open');
      await reopened;
      await drain(testApi);
      testApi.__city.post({ type: 'view', mode: '3d' });
      await pause(1500);
      testApi.__city.post({ type: 'select', path: first });
      await pause(1200);
      writeFileSync(
        join(dir, 'city-dark.png'),
        await capture(testApi, { type: 'test:capture', width: 1600, height: 900 }),
      );
      await workbench.update(
        'colorTheme',
        'Default Light Modern',
        vscode.ConfigurationTarget.Global,
      );
      await pause(800);
      testApi.__city.post({ type: 'theme', kind: 'light' });
      const toggled = testApi.__city.nextMessage('viewChanged');
      testApi.__city.post({ type: 'view', mode: '2d' });
      await toggled;
      await pause(1200);
      writeFileSync(
        join(dir, 'treemap-light.png'),
        await capture(testApi, { type: 'test:capture', width: 1600, height: 900 }),
      );
    } finally {
      testApi.__city.post({ type: 'test:clock', advance: null });
      await workbench.update('colorTheme', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
