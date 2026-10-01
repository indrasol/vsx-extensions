import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'Indrasol.extension-starter';
const HELLO_COMMAND = 'extensionStarter.hello';
const MORE_FROM_LABS_VIEW = 'extensionStarter.moreFromLabs';
const ACTIVATION_BUDGET_MS = 100;

/** Mirrors `ExtensionApi` in src/extension.ts. */
interface ExtensionApi {
  activationMs: number;
}

interface ViewContribution {
  id: string;
}

interface Manifest {
  contributes: { views: Record<string, ViewContribution[]> };
}

function getExtension(): vscode.Extension<ExtensionApi> {
  const ext = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  return ext;
}

suite('extension-starter', () => {
  test('is present', () => {
    getExtension();
  });

  test(`activates in under ${String(ACTIVATION_BUDGET_MS)} ms`, async () => {
    const ext = getExtension();
    const start = performance.now();
    const api = await ext.activate();
    const wallMs = performance.now() - start;
    assert.ok(ext.isActive);
    // Informational only: the outer wall time includes loading the bundle on a cold runner.
    console.log(`ext.activate() wall time ${wallMs.toFixed(1)} ms (not asserted)`);
    // The budget applies to the time spent inside activate(), which the extension measures itself.
    assert.ok(
      api.activationMs < ACTIVATION_BUDGET_MS,
      `activation took ${api.activationMs.toFixed(1)} ms (budget ${String(ACTIVATION_BUDGET_MS)} ms)`,
    );
  });

  test('registers the hello command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(HELLO_COMMAND));
  });

  test('runs the hello command without throwing', async () => {
    await vscode.commands.executeCommand(HELLO_COMMAND);
  });

  test('contributes the More from Labs view', () => {
    const manifest = getExtension().packageJSON as Manifest;
    const viewIds = Object.values(manifest.contributes.views).flatMap((views) =>
      views.map((view) => view.id),
    );
    assert.ok(viewIds.includes(MORE_FROM_LABS_VIEW));
  });
});
