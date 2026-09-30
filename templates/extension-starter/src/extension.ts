import { createLogger, registerMoreFromLabsView } from '@indrasol/labs-core';
import * as vscode from 'vscode';
import { greeting } from './hello.js';
import { createTelemetry } from './telemetry.js';

const moduleLoadedAt = performance.now();

export const HELLO_COMMAND = 'extensionStarter.hello';
export const MORE_FROM_LABS_VIEW = 'labsMoreFromLabs';

/** Keep activation under 100 ms: no I/O and no `await` before everything is registered. */
export function activate(context: vscode.ExtensionContext): void {
  const logger = createLogger('Labs Starter');
  const telemetry = createTelemetry(context);
  context.subscriptions.push(logger, telemetry);

  context.subscriptions.push(
    vscode.commands.registerCommand(HELLO_COMMAND, () => {
      telemetry.commandExecuted(HELLO_COMMAND);
      void vscode.window.showInformationMessage(greeting());
    }),
  );

  registerMoreFromLabsView(context, {
    viewId: MORE_FROM_LABS_VIEW,
    currentExtensionId: context.extension.id,
    campaign: 'extension-starter',
  });

  telemetry.activated();

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    logger.info(`Activated in ${(performance.now() - moduleLoadedAt).toFixed(1)} ms`);
  }
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
