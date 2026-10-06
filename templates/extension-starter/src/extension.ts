import { createLogger, registerMoreFromLabsView } from '@indrasol/labs-core';
import * as vscode from 'vscode';
import { greeting } from './hello.js';

const moduleLoadedAt = performance.now();

export const HELLO_COMMAND = 'extensionStarter.hello';
export const MORE_FROM_LABS_VIEW = 'extensionStarter.moreFromLabs';

/** Returned from `activate()`. Test-only: the integration test asserts the activation budget on it. */
export interface ExtensionApi {
  /** Time spent inside `activate()`, from its first line to the end of registration, in ms. */
  readonly activationMs: number;
}

/** Keep activation under 100 ms: no I/O and no `await` before everything is registered. */
export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const activateStartedAt = performance.now();
  const logger = createLogger('Labs Starter');
  context.subscriptions.push(logger);

  context.subscriptions.push(
    vscode.commands.registerCommand(HELLO_COMMAND, () => {
      void vscode.window.showInformationMessage(greeting());
    }),
  );

  registerMoreFromLabsView(context, {
    viewId: MORE_FROM_LABS_VIEW,
    currentExtensionId: context.extension.id,
    campaign: 'extension-starter',
  });

  const activationMs = performance.now() - activateStartedAt;

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    logger.info(`Activated in ${(performance.now() - moduleLoadedAt).toFixed(1)} ms`);
  }

  return { activationMs };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
