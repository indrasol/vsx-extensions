import { promises as fs } from 'node:fs';
import type { Logger } from '@indrasol/labs-core';
import * as vscode from 'vscode';
import { normalizeRoot } from '../analysis/cache.js';
import type { Hotspot } from '../analysis/model.js';
import type { AnalysisStore } from '../analysis/store.js';
import { COMMANDS } from '../commands.js';
import { prompts } from '../prompts.js';
import { wholeScore } from '../panel/hotspotTree.js';
import { throttle } from '../shared/throttle.js';
import { changedHotspots, scmAccessibilityLabel, scmText } from './format.js';
import { HIDDEN, type ItemState } from './statusBar.js';

export const SCM_ITEM_ID = 'churnmap.scm';
/** At most one update of the warning per interval (the last change always lands). */
export const SCM_INTERVAL_MS = 2000;
const WARNING_BACKGROUND = 'statusBarItem.warningBackground';

// The part of the built-in Git extension's API (`vscode.git`, version 1) that is used here.
export interface GitChange {
  readonly uri: vscode.Uri;
}
export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: {
    readonly indexChanges: readonly GitChange[];
    readonly workingTreeChanges: readonly GitChange[];
    readonly onDidChange: vscode.Event<void>;
  };
}
export interface GitApi {
  readonly repositories: readonly GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
}
interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitApi;
}

/** The built-in Git extension's API; undefined when it is missing or turned off (`git.enabled`). */
export async function builtInGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) return undefined;
  const git = extension.isActive ? extension.exports : await extension.activate();
  return git.enabled ? git.getAPI(1) : undefined;
}

export function warnOnStagedSetting(): boolean {
  return (
    vscode.workspace.getConfiguration('churnmap').get<boolean>('warnOnStagedHotspots') !== false
  );
}

/**
 * `$(warning) N hotspots in your changes`: the non-ignored top-20 files among the repository's
 * staged and working-tree changes, read from the built-in Git extension (Churnmap starts no
 * process for it). Updated at most every 2 s; hidden when N = 0. Never a notification.
 */
export class ScmWatch implements vscode.Disposable {
  private item: vscode.StatusBarItem | undefined;
  private shown: ItemState = HIDDEN;
  private hits: Hotspot[] = [];
  private started = false;
  private api: GitApi | undefined;
  private repo: GitRepository | undefined;
  /** The analysed root `repo` was matched against; a new root (Select repository…) re-matches. */
  private repoFor: string | undefined;
  /** The subscription to `repo`'s changes (replaced when the analysed repository changes). */
  private repoWatch: vscode.Disposable | undefined;
  private watching: vscode.Disposable[] = [];
  private unavailableLogged = false;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly schedule = throttle(() => {
    this.update();
  }, SCM_INTERVAL_MS);

  constructor(
    private readonly store: AnalysisStore,
    private readonly logger: Logger,
    private readonly gitApi: () => Promise<GitApi | undefined> = builtInGitApi,
  ) {
    const storeSub = store.onDidChange(() => {
      this.onStoreChanged();
    });
    this.disposables.push(
      storeSub,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('churnmap.warnOnStagedHotspots')) return;
        if (warnOnStagedSetting()) this.onStoreChanged();
        else this.stop();
      }),
    );
  }

  /** Starts on the first result (warm start or build); later results re-check the changes. */
  private onStoreChanged(): void {
    if (!warnOnStagedSetting() || !this.store.get()) {
      this.schedule();
      return;
    }
    if (!this.started) {
      this.started = true;
      void this.start();
    } else {
      this.followRepository();
    }
    this.schedule();
  }

  /** The status bar follows the chosen repository: a new root drops the old match and re-matches. */
  private followRepository(): void {
    const root = this.store.get()?.repoRoot;
    if (!this.api || root === undefined || this.repoFor === root) return;
    this.repo = undefined;
    this.repoFor = undefined;
    this.repoWatch?.dispose();
    this.repoWatch = undefined;
    for (const repo of this.api.repositories) void this.consider(repo);
  }

  private async start(): Promise<void> {
    let api: GitApi | undefined;
    try {
      api = await this.gitApi();
    } catch {
      api = undefined;
    }
    if (!this.started) return; // turned off meanwhile
    if (!api) {
      if (!this.unavailableLogged) {
        this.unavailableLogged = true;
        this.logger.info('Built-in Git extension not available; SCM warnings off.');
      }
      return;
    }
    this.api = api;
    this.watching.push(
      api.onDidOpenRepository((repo) => {
        void this.consider(repo);
      }),
    );
    for (const repo of api.repositories) await this.consider(repo);
    // The analysis may have moved to another repository while the API was starting.
    this.followRepository();
  }

  /** Watches the Git repository whose root is the analysed repository's root. */
  private async consider(repo: GitRepository): Promise<void> {
    const repoRoot = this.store.get()?.repoRoot;
    if (this.repo || repoRoot === undefined) return;
    const real = await fs.realpath(repo.rootUri.fsPath).catch(() => repo.rootUri.fsPath);
    // Another repository may have matched while the path was resolved.
    if (this.watchingRepo() || normalizeRoot(real) !== normalizeRoot(repoRoot)) return;
    this.repo = repo;
    this.repoFor = repoRoot;
    this.repoWatch = repo.state.onDidChange(() => {
      this.schedule();
    });
    this.schedule();
  }

  private watchingRepo(): boolean {
    return this.repo !== undefined;
  }

  private update(): void {
    const top = this.store.get()?.top ?? [];
    const repo = this.repo;
    this.hits =
      repo && warnOnStagedSetting()
        ? changedHotspots(
            repo.rootUri.fsPath,
            [...repo.state.indexChanges, ...repo.state.workingTreeChanges].map((c) => c.uri.fsPath),
            top,
          )
        : [];
    if (this.hits.length === 0) {
      this.item?.hide();
      this.shown = HIDDEN;
      return;
    }
    this.item ??= vscode.window.createStatusBarItem(
      SCM_ITEM_ID,
      vscode.StatusBarAlignment.Right,
      49,
    );
    const item = this.item;
    item.name = 'Churnmap: hotspots in your changes';
    item.text = scmText(this.hits.length);
    item.tooltip = `Your changes touch: ${this.hits.map((h) => `#${String(h.rank)} ${h.file.path}`).join(', ')}`;
    item.accessibilityInformation = { label: scmAccessibilityLabel(this.hits.length) };
    item.backgroundColor = new vscode.ThemeColor(WARNING_BACKGROUND);
    item.command = {
      command: COMMANDS.showChangedHotspots,
      title: 'Show the hotspots you changed',
    };
    item.show();
    this.shown = { visible: true, text: item.text, warning: true };
  }

  /** The hotspots in the current changes, in rank order. */
  changed(): readonly Hotspot[] {
    return this.hits;
  }

  state(): ItemState {
    return this.shown;
  }

  private stop(): void {
    this.started = false;
    this.api = undefined;
    this.repo = undefined;
    this.repoFor = undefined;
    this.repoWatch?.dispose();
    this.repoWatch = undefined;
    this.schedule.cancel();
    while (this.watching.length > 0) this.watching.pop()?.dispose();
    this.item?.dispose();
    this.item = undefined;
    this.hits = [];
    this.shown = HIDDEN;
  }

  dispose(): void {
    this.stop();
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
  }
}

export const REVIEW_CHANGES_LABEL = '$(sparkle) Create AI prompt to review these changes';

/**
 * Churnmap: the hotspots in your changes (the SCM item's click): pick one to open it, or create an AI prompt to
 * review the changes to all of them (`onReview`).
 */
export async function showChangedHotspots(
  scm: ScmWatch,
  onReview?: (hits: readonly Hotspot[]) => unknown,
): Promise<void> {
  const hits = scm.changed();
  if (hits.length === 0) return;
  const items: { label: string; description: string; detail: string; path?: string }[] = hits.map(
    (h) => ({
      label: h.file.path,
      description: `#${String(h.rank)} · score ${wholeScore(h.file.score)}`,
      detail: h.reasons[0]?.text ?? '',
      path: h.file.path,
    }),
  );
  if (onReview) {
    items.push({
      label: REVIEW_CHANGES_LABEL,
      description: `${String(hits.length)} ${hits.length === 1 ? 'hotspot' : 'hotspots'}`,
      detail: 'A ready-to-paste prompt for your AI agent: review these files with extra care',
    });
  }
  const picked = await prompts.pick(items, {
    title: 'Churnmap: hotspots in your changes',
    placeHolder: 'Open a changed hotspot, or create an AI prompt to review them',
  });
  if (!picked) return;
  if (picked.path === undefined) await onReview?.(hits);
  else await vscode.commands.executeCommand(COMMANDS.openFile, picked.path);
}
