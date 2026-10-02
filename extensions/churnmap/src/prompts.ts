import * as vscode from 'vscode';

export interface PickOptions<T> {
  title: string;
  placeHolder: string;
  /** The item the list opens on (the remembered choice). */
  active?: T | undefined;
}

/**
 * Every question Churnmap asks the user, in one place so integration tests can answer them
 * (`override`, reachable only through the test-mode API) instead of automating the UI.
 */
export interface Prompts {
  inputBox(options: vscode.InputBoxOptions): Thenable<string | undefined>;
  pick<T extends vscode.QuickPickItem>(
    items: T[],
    options: PickOptions<T>,
  ): Thenable<T | undefined>;
  pickMany<T extends vscode.QuickPickItem>(
    items: T[],
    options: PickOptions<T>,
  ): Thenable<readonly T[] | undefined>;
  /** An information toast with buttons; resolves with the one pressed. */
  info(message: string, ...actions: string[]): Thenable<string | undefined>;
  saveDialog(options: vscode.SaveDialogOptions): Thenable<vscode.Uri | undefined>;
}

function pick<T extends vscode.QuickPickItem>(
  items: T[],
  options: PickOptions<T>,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<T>();
    quickPick.title = options.title;
    quickPick.placeholder = options.placeHolder;
    quickPick.items = items;
    if (options.active) quickPick.activeItems = [options.active];
    let chosen: T | undefined;
    quickPick.onDidAccept(() => {
      chosen = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(chosen);
    });
    quickPick.show();
  });
}

const defaults: Prompts = {
  inputBox: (options) => vscode.window.showInputBox(options),
  pick,
  pickMany: (items, options) =>
    vscode.window.showQuickPick(items, {
      title: options.title,
      placeHolder: options.placeHolder,
      canPickMany: true,
    }),
  info: (message, ...actions) => vscode.window.showInformationMessage(message, ...actions),
  saveDialog: (options) => vscode.window.showSaveDialog(options),
};

/** The prompts in use: the real UI unless a test has overridden some of them. */
export const prompts: Prompts = { ...defaults };

/** Test mode only: replaces some prompts; returns a function that restores the real ones. */
export function overridePrompts(overrides: Partial<Prompts>): () => void {
  Object.assign(prompts, overrides);
  return () => {
    Object.assign(prompts, defaults);
  };
}
