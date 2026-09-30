import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'Indrasol.extension-starter';
const HELLO_COMMAND = 'extensionStarter.hello';
const MORE_FROM_LABS_VIEW = 'extensionStarter.moreFromLabs';
const ACTIVATION_BUDGET_MS = 100;

interface ViewContribution {
  id: string;
}

interface Manifest {
  contributes: { views: Record<string, ViewContribution[]> };
}

function getExtension(): vscode.Extension<unknown> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
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
    await ext.activate();
    const elapsed = performance.now() - start;
    assert.ok(ext.isActive);
    assert.ok(
      elapsed < ACTIVATION_BUDGET_MS,
      `activation took ${elapsed.toFixed(1)} ms (budget ${String(ACTIVATION_BUDGET_MS)} ms)`,
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
