import * as vscode from 'vscode';

/** Shown when analysis is requested in an untrusted workspace (ADR-0012). */
export const UNTRUSTED_MESSAGE = 'Trust this workspace to analyse it.';
const MANAGE_TRUST = 'Manage Workspace Trust';

/** Analysis runs git and reads files, so it is allowed only in a trusted workspace. */
export function isAnalysisAllowed(): boolean {
  return vscode.workspace.isTrusted;
}

/** Calls `listener` when the user trusts the workspace, so disabled features can come alive. */
export function onAnalysisAllowed(listener: () => void): vscode.Disposable {
  return vscode.workspace.onDidGrantWorkspaceTrust(listener);
}

/** Tells the user why analysis did not run and offers the trust editor. Never modal. */
export function showUntrustedMessage(): void {
  void vscode.window.showWarningMessage(UNTRUSTED_MESSAGE, MANAGE_TRUST).then((choice) => {
    if (choice === MANAGE_TRUST) void vscode.commands.executeCommand('workbench.trust.manage');
  });
}
