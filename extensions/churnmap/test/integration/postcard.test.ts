import * as assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { PostcardMessage } from '../../src/city/protocol.js';
import type { TestApi } from '../../src/extension.js';
import type { Prompts } from '../../src/prompts.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const MAX_BYTES = 1.5 * 1024 * 1024;
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const exports = await ext.activate();
  assert.ok(exports, 'the test API is only returned in test mode');
  return exports;
}

/** The PNG's chunks (type and data), parsed by hand: no image library. */
function chunks(png: Buffer): { type: string; data: Buffer }[] {
  const out: { type: string; data: Buffer }[] = [];
  let offset = SIGNATURE.length;
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    out.push({ type, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return out;
}

interface Answers {
  detail: 'paths' | 'districts' | 'none';
  /** undefined: the save dialog is cancelled. */
  saveAs: vscode.Uri | undefined;
}

suite('postcard export', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-postcard-'));
  const shown: string[] = [];
  let preselected: unknown;
  let restore: (() => void) | undefined;

  function answer(testApi: TestApi, a: Answers): void {
    restore = testApi.__prompts({
      pick: ((items: { value?: string }[], options: { active?: { value?: string } }) => {
        preselected = options.active?.value;
        return Promise.resolve(items.find((i) => i.value === a.detail));
      }) as unknown as Prompts['pick'],
      saveDialog: () => Promise.resolve(a.saveAs),
      info: (message: string) => {
        shown.push(message);
        return Promise.resolve(undefined);
      },
    });
  }

  /** Runs the command and returns what the host asked the webview to draw. */
  async function exportAs(
    testApi: TestApi,
    a: Answers,
  ): Promise<{ outcome: unknown; message: PostcardMessage }> {
    answer(testApi, a);
    const posted = testApi.__city.nextPosted('postcard', 20_000);
    const result = testApi.__city.nextMessage('postcardResult', 20_000);
    const outcome = await vscode.commands.executeCommand('churnmap.exportPostcard');
    const message = await posted;
    assert.ok(message.type === 'postcard');
    const reply = await result;
    assert.ok(reply.type === 'postcardResult');
    console.log(
      `      ${a.detail}: rendered in ${String(reply.ms)} ms (VS Code ${vscode.version})`,
    );
    return { outcome, message };
  }

  function checkPng(file: string, secrets: readonly string[]): Buffer {
    const png = readFileSync(file);
    assert.ok(png.subarray(0, 8).equals(SIGNATURE), 'not a PNG');
    assert.ok(png.length < MAX_BYTES, `${String(png.length)} bytes`);
    const parsed = chunks(png);
    const ihdr = parsed[0];
    assert.equal(ihdr?.type, 'IHDR');
    assert.equal(ihdr.data.readUInt32BE(0), 1600);
    assert.equal(ihdr.data.readUInt32BE(4), 900);
    assert.equal(parsed.at(-1)?.type, 'IEND');
    // No text chunks: every word on the card is pixels.
    assert.deepEqual(
      parsed.filter((c) => /^(tEXt|iTXt|zTXt)$/.test(c.type)).map((c) => c.type),
      [],
    );
    // Short labels ("src") can occur by chance inside compressed pixels, so they are checked
    // outside the image data; whole paths are checked over every byte.
    const outsidePixels = parsed
      .filter((c) => c.type !== 'IDAT')
      .map((c) => c.data.toString('latin1'))
      .join('\n');
    const everything = png.toString('latin1');
    for (const secret of secrets) {
      if (secret.length >= 8)
        assert.ok(!everything.includes(secret), `"${secret}" is in the PNG bytes`);
      assert.ok(!outsidePixels.includes(secret), `"${secret}" is in a PNG chunk`);
    }
    return png;
  }

  suiteSetup(async () => {
    await vscode.commands.executeCommand('churnmap.build');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  teardown(async () => {
    restore?.();
    restore = undefined;
    await vscode.workspace
      .getConfiguration('churnmap')
      .update('postcard.detail', undefined, vscode.ConfigurationTarget.Workspace);
  });

  test('districts only: a 1600×900 PNG under 1.5 MB, no paths, written only to the chosen file', async function () {
    this.timeout(40_000);
    const testApi = await api();
    const files = testApi.__analysis()?.files.map((f) => f.path) ?? [];
    assert.ok(files.includes('src/core/engine.js'));
    const target = vscode.Uri.file(join(dir, 'districts.png'));
    const { outcome, message } = await exportAs(testApi, { detail: 'districts', saveAs: target });
    assert.equal(outcome, 'saved');
    assert.equal(preselected, 'paths', 'the quick pick did not open on the setting');
    assert.equal(message.detail, 'districts');
    assert.ok(message.top.length > 0 && message.top.length <= 3);
    for (const t of message.top) assert.ok(!t.label.includes('/'), `a path was sent: ${t.label}`);
    const png = checkPng(target.fsPath, [...files, ...message.top.map((t) => t.label)]);
    console.log(
      `      postcard: ${String(png.length)} bytes (${(png.length / 1024 / 1024).toFixed(2)} MB)`,
    );
    assert.deepEqual(readdirSync(dir), ['districts.png']);
    assert.match(shown.at(-1) ?? '', /^Postcard saved \(\d+(\.\d)? (KB|MB)\)\.$/);
    assert.equal(
      vscode.workspace.getConfiguration('churnmap').get('postcard.detail'),
      'districts',
      'the choice was not remembered',
    );
  });

  test('no names: the webview gets #1 #2 #3 and nothing else', async function () {
    this.timeout(40_000);
    const testApi = await api();
    const target = vscode.Uri.file(join(dir, 'none.png'));
    const { message } = await exportAs(testApi, { detail: 'none', saveAs: target });
    assert.deepEqual(
      message.top.map((t) => t.label),
      message.top.map((t) => `#${String(t.rank)}`),
    );
    checkPng(target.fsPath, testApi.__analysis()?.files.map((f) => f.path) ?? []);
  });

  test('a cancelled save dialog writes nothing', async function () {
    this.timeout(40_000);
    const testApi = await api();
    const before = readdirSync(dir);
    const { outcome } = await exportAs(testApi, { detail: 'paths', saveAs: undefined });
    assert.equal(outcome, 'cancelled');
    assert.deepEqual(readdirSync(dir), before);
  });

  test('works with the 2D treemap showing', async function () {
    this.timeout(40_000);
    const testApi = await api();
    const changed = testApi.__city.nextMessage('viewChanged');
    await vscode.commands.executeCommand('churnmap.toggleTreemap');
    const mode = await changed;
    try {
      assert.ok(mode.type === 'viewChanged' && mode.mode === '2d');
      const target = vscode.Uri.file(join(dir, 'treemap.png'));
      const { outcome } = await exportAs(testApi, { detail: 'paths', saveAs: target });
      assert.equal(outcome, 'saved');
      const png = checkPng(target.fsPath, []);
      console.log(`      2D postcard: ${String(png.length)} bytes`);
    } finally {
      const back = testApi.__city.nextMessage('viewChanged');
      await vscode.commands.executeCommand('churnmap.toggleTreemap');
      await back;
    }
  });
});
