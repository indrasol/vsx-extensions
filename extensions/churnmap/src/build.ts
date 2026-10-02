import type { Logger } from '@indrasol/labs-core';
import * as vscode from 'vscode';
import { AnalysisCache } from './analysis/cache.js';
import { isRankMode, type RankMode } from './analysis/classify.js';
import type { RepoCandidate } from './analysis/discover.js';
import { listTrackedFiles } from './analysis/files.js';
import { GitError, prepareHooksDir, resolveGit } from './analysis/gitProcess.js';
import { type AnalysisResult, isWindow, type Window, WINDOWS } from './analysis/model.js';
import { type AnalysisSettings, runAnalysis } from './analysis/pipeline.js';
import { createWorkerPool } from './analysis/pool.js';
import { recordLastRepo } from './analysis/repoIndex.js';
import { DEFAULT_FIX_KEYWORDS } from './analysis/score.js';
import type { AnalysisStore } from './analysis/store.js';
import { COMMANDS } from './commands.js';
import { prompts } from './prompts.js';
import {
  isMostlyDocumentation,
  MOSTLY_DOCS_MESSAGE,
  mostlyDocsActions,
  RANK_ALL_ACTION,
  SELECT_REPOSITORY_ACTION,
} from './repoChoice.js';
import { Repositories } from './repository.js';

/** What the last build produced; read by integration tests through the test hook. */
export interface BuildSummary {
  cached: boolean;
  ms: number;
  window: Window;
  commitCount: number;
  hotspots: number;
  message: string;
  /** The analysed repository's root (as git reports it). */
  repoRoot: string;
  /** True when the empty state ("mostly documentation") was shown instead of the summary. */
  mostlyDocs: boolean;
}

/** Which repository a build analyses. */
export interface BuildOptions {
  /** Skip the cache read. */
  force?: boolean;
  /**
   * `auto` (Build): the active file's repository, the remembered one, or ask. `current`: keep
   * the repository already analysed (a rebuild for another window or rank). Or a picked one.
   */
  target?: 'auto' | 'current' | RepoCandidate;
}

const OPEN_SETTINGS = 'Open settings';

/** The `git.path` setting may be a string or a list of candidates. */
export function configuredGitPath(): string | undefined {
  const value: unknown = vscode.workspace.getConfiguration('git').get('path');
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === 'string');
  return undefined;
}

export function configuredWindow(): Window {
  const value: unknown = vscode.workspace.getConfiguration('churnmap').get('window');
  return isWindow(value) ? value : 90;
}

export function configuredSettings(): AnalysisSettings {
  const config = vscode.workspace.getConfiguration('churnmap');
  const exclude: unknown = config.get('exclude');
  const maxFiles: unknown = config.get('maxFiles');
  const fixKeywords: unknown = config.get('fixKeywords');
  const rank: unknown = config.get('rank');
  return {
    exclude: Array.isArray(exclude)
      ? exclude.filter((g): g is string => typeof g === 'string')
      : [],
    maxFiles: typeof maxFiles === 'number' && maxFiles >= 1 ? Math.floor(maxFiles) : 20_000,
    fixKeywords: typeof fixKeywords === 'string' ? fixKeywords : DEFAULT_FIX_KEYWORDS,
    rank: configuredRank(rank),
  };
}

/** `churnmap.rank`: `code` unless set to `all`. */
export function configuredRank(
  value: unknown = vscode.workspace.getConfiguration('churnmap').get('rank'),
): RankMode {
  return isRankMode(value) ? value : 'code';
}

/** Shows a GitError's fix; "Open settings" for a missing git. Never modal. */
export function showGitError(err: GitError): void {
  if (err.kind === 'aborted') return;
  if (err.kind === 'not-found') {
    void vscode.window.showErrorMessage(err.userMessage, OPEN_SETTINGS).then((choice) => {
      if (choice === OPEN_SETTINGS) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'git.path');
      }
    });
    return;
  }
  void vscode.window.showErrorMessage(err.userMessage);
}

/** Runs analyses for the chosen repository and publishes results to the store. */
export class Builder {
  /** git is resolved once per session and per `git.path` value, and only when needed. */
  private git: { configured: string | undefined; gitPath: string; version: string } | undefined;
  readonly repositories: Repositories;
  /** Called after every successful build (cached or not); errors are logged, never shown. */
  onBuilt: ((result: AnalysisResult) => Promise<unknown>) | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger,
    private readonly store: AnalysisStore,
  ) {
    this.repositories = new Repositories({
      context,
      exclude: () => configuredSettings().exclude,
      trackedFiles: async (root) => {
        const git = await this.resolveGitOnce();
        return listTrackedFiles(git.gitPath, root, await prepareHooksDir(this.storageDir));
      },
    });
  }

  private get storageDir(): string {
    return this.context.globalStorageUri.fsPath;
  }

  private async resolveGitOnce(): Promise<{ gitPath: string; version: string }> {
    const configured = configuredGitPath();
    if (this.git && this.git.configured === configured) return this.git;
    const git = await resolveGit(configured);
    if (!git.ok) {
      throw new GitError(
        'not-found',
        git.reason === 'not-executable'
          ? 'The "git.path" setting does not point to a working git executable, and no git was found on PATH.'
          : 'Churnmap needs git, and it was not found. Install git, or set the "git.path" setting to the git executable.',
      );
    }
    this.git = { configured, gitPath: git.gitPath, version: git.version };
    this.logger.info(`Using git ${git.version} at ${git.gitPath}`);
    return this.git;
  }

  /** Churnmap: Build city. The caller has checked Workspace Trust. */
  async build(opts: BuildOptions = {}): Promise<BuildSummary | undefined> {
    const { force = false, target = 'auto' } = opts;
    if (!vscode.workspace.workspaceFolders?.length) {
      void vscode.window.showInformationMessage(
        'Churnmap: open a folder with a git repository first.',
      );
      return undefined;
    }
    let cwd: string;
    try {
      if (typeof target === 'object') {
        cwd = target.root;
      } else {
        const resolved = await this.repositories.resolve({
          current: target === 'current' ? this.store.raw()?.repoRoot : undefined,
        });
        if (!resolved) return undefined; // the user dismissed the repository question
        cwd = resolved.cwd;
        this.logger.info(`Repository: ${cwd} (${resolved.reason})`);
      }
    } catch (err) {
      if (err instanceof GitError) {
        this.logger.warn(`Build stopped: ${err.kind} (${err.message})`);
        showGitError(err);
        return undefined;
      }
      throw err;
    }
    const window = configuredWindow();
    const settings = configuredSettings();

    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Churnmap', cancellable: true },
      async (progress, token) => {
        const controller = new AbortController();
        const cancel = token.onCancellationRequested(() => {
          controller.abort();
        });
        const start = performance.now();
        try {
          const hooksDir = await prepareHooksDir(this.storageDir);
          const { result, cached } = await runAnalysis(
            {
              gitPath: () => this.resolveGitOnce(),
              hooksDir,
              storageDir: this.storageDir,
              cwd,
              settings,
              logger: this.logger,
              pool: createWorkerPool(),
            },
            {
              window,
              force,
              signal: controller.signal,
              onProgress: (message) => {
                progress.report({ message });
              },
            },
          );
          this.store.set(result);
          // The MCP server reads which repository this workspace analyses (cache/index.json).
          await recordLastRepo(
            this.storageDir,
            (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
            result.repoRoot,
          ).catch((err: unknown) => {
            this.logger.warn(
              `Could not record the repository: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
          await this.onBuilt?.(result).catch((err: unknown) => {
            this.logger.warn(
              `After-build step failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
          const ms = Math.round(performance.now() - start);
          this.logger.info(
            `Build ${cached ? 'from cache' : 'done'} in ${String(ms)} ms: ${JSON.stringify(result.timings)}`,
          );
          if (!cached) this.showBanners(result);
          const mostlyDocs = isMostlyDocumentation(result.files, settings.rank ?? 'code');
          const message = mostlyDocs
            ? MOSTLY_DOCS_MESSAGE
            : `Churnmap: ${String(result.top.length)} hotspots from ${String(result.commitCount)} commits · ${String(ms)} ms${cached ? ' (cached)' : ''}`;
          if (mostlyDocs) this.showMostlyDocs();
          else void vscode.window.showInformationMessage(message);
          return {
            cached,
            ms,
            window,
            commitCount: result.commitCount,
            hotspots: result.top.length,
            message,
            repoRoot: result.repoRoot,
            mostlyDocs,
          };
        } catch (err) {
          if (err instanceof GitError) {
            this.logger.warn(`Build stopped: ${err.kind} (${err.message})`);
            showGitError(err);
            return undefined;
          }
          this.logger.error(err, 'Build failed');
          void vscode.window.showErrorMessage(
            'Churnmap: the build failed. See the Churnmap output for details.',
          );
          return undefined;
        } finally {
          cancel.dispose();
        }
      },
    );
  }

  /**
   * The empty state: fewer than 3 code files rank here. Offers another repository, and, once the
   * user has seen the repository question, ranking every file (saved for this workspace only,
   * then a rebuild of the same repository; the HUD and the Hotspots view then say so).
   */
  private showMostlyDocs(): void {
    void prompts
      .info(MOSTLY_DOCS_MESSAGE, ...mostlyDocsActions(this.repositories.pickerSeen()))
      .then(async (choice) => {
        if (choice === SELECT_REPOSITORY_ACTION) {
          await vscode.commands.executeCommand(COMMANDS.selectRepository);
        } else if (choice === RANK_ALL_ACTION) {
          await this.setRank('all');
        }
      });
  }

  /**
   * Saves `churnmap.rank` for this workspace (never the user settings: a workspace of notes must
   * not change how every other repository ranks), then rebuilds the same repository.
   */
  async setRank(rank: RankMode): Promise<BuildSummary | undefined> {
    if (!vscode.workspace.workspaceFolders?.length) return undefined;
    await vscode.workspace
      .getConfiguration('churnmap')
      .update('rank', rank, vscode.ConfigurationTarget.Workspace);
    return this.build({ target: 'current' });
  }

  /** Churnmap: Select repository…: asks, remembers the answer and returns it. */
  selectRepository(): Promise<RepoCandidate | undefined> {
    return this.repositories.select(this.store.raw()?.repoRoot);
  }

  private showBanners(result: AnalysisResult): void {
    if (result.shallow) {
      void vscode.window.showInformationMessage(
        'This clone is shallow; history before the cut-off is not visible.',
      );
    }
    if (result.capped) {
      void vscode.window.showInformationMessage(
        `Only the first ${String(configuredSettings().maxFiles)} files are analysed (churnmap.maxFiles).`,
      );
    }
  }

  /**
   * Churnmap: Set time window. Takes the window as an argument (keybindings, tests) or asks with
   * a quick pick, saves it (workspace scope when a folder is open), then rebuilds.
   */
  async setWindow(
    arg?: unknown,
    onChosen?: (window: Window) => void,
  ): Promise<BuildSummary | undefined> {
    let window: Window | undefined = isWindow(arg) ? arg : undefined;
    if (window === undefined) {
      const current = configuredWindow();
      const pick = await vscode.window.showQuickPick(
        WINDOWS.map((days) => ({
          label: `Last ${String(days)} days`,
          description: days === current ? 'current' : '',
          days,
        })),
        { title: 'Churnmap: time window', placeHolder: 'How much git history to analyse' },
      );
      window = pick?.days;
    }
    if (window === undefined) return undefined;
    onChosen?.(window);
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration('churnmap').update('window', window, target);
    return this.build({ target: 'current' });
  }

  /** Churnmap: Clear cache. */
  async clearCache(): Promise<void> {
    await new AnalysisCache(this.storageDir).clear();
    this.store.set(undefined);
    void vscode.window.showInformationMessage(
      'Churnmap: cache cleared. Ignored hotspots are kept; use “Un-ignore hotspot…” to rank them again.',
    );
  }
}
