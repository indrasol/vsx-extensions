import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import type { AnalysisStore } from '../analysis/store.js';
import { COMMANDS } from '../commands.js';
import { isWarningRank, rankText, rankTooltip, repoRelative, repoRoots } from './format.js';

export const RANK_ITEM_ID = 'churnmap.rank';
const WARNING_BACKGROUND = 'statusBarItem.warningBackground';

/** What a status-bar item shows (read by integration tests through the test API). */
export interface ItemState {
  visible: boolean;
  text: string;
  warning: boolean;
  /** The argument the click passes (a repository-relative path), when there is one. */
  argument?: string;
}

export const HIDDEN: ItemState = { visible: false, text: '', warning: false };

export function showStatusBarSetting(): boolean {
  return vscode.workspace.getConfiguration('churnmap').get<boolean>('showStatusBar') !== false;
}

/**
 * `$(flame) Hotspot #3` for the active file when it is in the (non-ignored) top 20; hidden for
 * anything else, including untitled files and files outside the repository. Click → the file in
 * the Hotspots view. The item exists only while `churnmap.showStatusBar` is on.
 */
export class RankStatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem | undefined;
  private shown: ItemState = HIDDEN;
  private roots: { of: string; roots: Promise<string[]> } | undefined;
  private updates = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly store: AnalysisStore) {
    const refresh = (): void => {
      void this.update();
    };
    const storeSub = store.onDidChange(refresh);
    this.disposables.push(
      storeSub,
      vscode.window.onDidChangeActiveTextEditor(refresh),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('churnmap.showStatusBar')) refresh();
      }),
    );
    refresh();
  }

  /** The roots an editor path may be spelled under (symlinked folders), resolved once per root. */
  private rootsFor(repoRoot: string): Promise<string[]> {
    if (this.roots?.of !== repoRoot) {
      const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      this.roots = { of: repoRoot, roots: repoRoots(repoRoot, folders, (p) => fs.realpath(p)) };
    }
    return this.roots.roots;
  }

  async update(): Promise<void> {
    const run = ++this.updates;
    if (!showStatusBarSetting()) {
      this.item?.dispose();
      this.item = undefined;
      this.shown = HIDDEN;
      return;
    }
    const result = this.store.get();
    const document = vscode.window.activeTextEditor?.document;
    if (!result || document?.uri.scheme !== 'file') {
      this.hide();
      return;
    }
    const roots = await this.rootsFor(result.repoRoot);
    if (run !== this.updates) return; // a newer update is on its way
    const path = repoRelative(roots, document.uri.fsPath);
    const hotspot = path === undefined ? undefined : result.top.find((h) => h.file.path === path);
    if (!hotspot) {
      this.hide();
      return;
    }
    this.item ??= vscode.window.createStatusBarItem(
      RANK_ITEM_ID,
      vscode.StatusBarAlignment.Right,
      50,
    );
    const item = this.item;
    const warning = isWarningRank(hotspot.rank);
    item.name = 'Churnmap: hotspot rank';
    item.text = rankText(hotspot.rank, hotspot.file.band ?? 'hotspot');
    item.tooltip = new vscode.MarkdownString(rankTooltip(hotspot));
    item.accessibilityInformation = {
      label: `Hotspot rank ${String(hotspot.rank)}: ${hotspot.file.path}. Show it in the Hotspots view.`,
    };
    item.backgroundColor = warning ? new vscode.ThemeColor(WARNING_BACKGROUND) : undefined;
    item.command = {
      command: COMMANDS.showHotspots,
      title: 'Show in the Hotspots view',
      arguments: [hotspot.file.path],
    };
    item.show();
    this.shown = { visible: true, text: item.text, warning, argument: hotspot.file.path };
  }

  private hide(): void {
    this.item?.hide();
    this.shown = HIDDEN;
  }

  state(): ItemState {
    return this.shown;
  }

  dispose(): void {
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
    this.item?.dispose();
    this.item = undefined;
  }
}
