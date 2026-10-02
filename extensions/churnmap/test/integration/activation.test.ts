import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension.js';

const EXTENSION_ID = 'Indrasol.churnmap';
const ACTIVATION_BUDGET_MS = 100;
const ACTIVATION_WAIT_MS = 10_000;

/** What the extension looked like before any suite ran a command. */
let observed: { active: boolean; api: TestApi | undefined } | undefined;

// A root-level hook runs before every suite in every test file, whatever order mocha loads the
// files in. The extension must already be active through its `workspaceContains:.git` event, not
// through a command or a call to `activate()` from a test.
suiteSetup(async () => {
  const ext = vscode.extensions.getExtension<TestApi | undefined>(EXTENSION_ID);
  assert.ok(ext, `${EXTENSION_ID} is not installed`);
  const deadline = Date.now() + ACTIVATION_WAIT_MS;
  while (!ext.isActive && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  observed = { active: ext.isActive, api: ext.isActive ? ext.exports : undefined };
});

suite('activation', () => {
  test('activates on workspaceContains:.git before any command runs', () => {
    assert.ok(observed?.active, 'the extension did not activate on its activation event');
  });

  test(`activate() itself finishes within ${String(ACTIVATION_BUDGET_MS)} ms`, () => {
    const api = observed?.api;
    assert.ok(api, 'the test API is only returned in test mode');
    const ms = api.__activationMs;
    console.log(`      activation: ${ms.toFixed(1)} ms (VS Code ${vscode.version})`);
    assert.ok(ms > 0, 'activation time was not measured');
    assert.ok(
      ms < ACTIVATION_BUDGET_MS,
      `activation took ${ms.toFixed(1)} ms (budget ${String(ACTIVATION_BUDGET_MS)} ms)`,
    );
  });
});
