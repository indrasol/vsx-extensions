import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { AnalysisStore } from '../analysis/store.js';
import { COMMANDS } from '../commands.js';
import { repoRelative, repoRoots } from '../daily/format.js';
import { isAnalysisAllowed } from '../trust.js';
import { NUDGE_TOP, NUDGE_VISIBLE_MS, NudgeClock } from './nudgeClock.js';

export const NUDGE_ITEM_ID = 'churnmap.nudge';
export const NUDGE_TEXT = '$(sync) Rebuild to see if this hotspot cooled';

/**
 * The loop nudge: after a top-20 hotspot is saved, a status-bar hint (never a notification) offers
 * a rebuild for 20 s, at most once per file every 10 minutes. Trusted workspaces only.
 */
export class CoolDownNudge implements vscode.Disposable {
  private item: vscode.StatusBarItem | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly clock = new NudgeClock();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: AnalysisStore) {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        void this.onSave(doc).catch(() => undefined);
      }),
    );
  }

  private async onSave(doc: vscode.TextDocument): Promise<void> {
    const result = this.store.get();
    if (!isAnalysisAllowed() || !result || doc.uri.scheme !== 'file') return;
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const roots = await repoRoots(result.repoRoot, folders, (p) => fs.realpath(p));
    const path = repoRelative(roots, doc.uri.fsPath);
    if (path === undefined) return;
    const hotspot = result.top.slice(0, NUDGE_TOP).find((h) => h.file.path === path);
    if (!hotspot || !this.clock.take(path, Date.now())) return;
    this.show(hotspot.file.path);
  }

  private show(path: string): void {
    this.item ??= vscode.window.createStatusBarItem(
      NUDGE_ITEM_ID,
      vscode.StatusBarAlignment.Right,
      48,
    );
    const item = this.item;
    item.name = 'Churnmap: rebuild after editing a hotspot';
    item.text = NUDGE_TEXT;
    item.tooltip = `You saved ${path}. Rebuild the city to see whether its score went down.`;
    item.accessibilityInformation = {
      label: `You saved hotspot ${path}. Rebuild the city to see whether it cooled down.`,
    };
    item.command = { command: COMMANDS.build, title: 'Rebuild the city' };
    item.show();
    if (this.hideTimer !== undefined) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.item?.hide();
    }, NUDGE_VISIBLE_MS);
  }

  dispose(): void {
    if (this.hideTimer !== undefined) clearTimeout(this.hideTimer);
    this.item?.dispose();
    this.item = undefined;
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
  }
}
