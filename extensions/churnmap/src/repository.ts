import { promises as fs } from 'node:fs';
import * as vscode from 'vscode';
import { normalizeRoot } from './analysis/cache.js';
import { isMostlyNonCode } from './analysis/classify.js';
import { type Discovery, discoverRepositories, type RepoCandidate } from './analysis/discover.js';
import { prompts } from './prompts.js';
import {
  chooseRepository,
  type ChoiceReason,
  findCandidate,
  PICKER_SEEN_KEY,
  pickItems,
  recommend,
  REPOSITORY_KEY,
} from './repoChoice.js';

/** Where a build runs: the repository folder (or, with no candidate, the first workspace folder). */
export interface Target {
  cwd: string;
  candidate?: RepoCandidate | undefined;
  reason: ChoiceReason | 'picked' | 'current';
}

export interface RepositoryDeps {
  context: vscode.ExtensionContext;
  /** `churnmap.exclude`, so excluded folders are not walked. */
  exclude(): string[];
  /** `git ls-files` for a candidate (trusted workspaces only; the umbrella test). */
  trackedFiles(root: string): Promise<string[]>;
}

/** The file of the active text editor, when it is on disk. */
export function activeFile(): string | undefined {
  const uri = vscode.window.activeTextEditor?.document.uri;
  return uri?.scheme === 'file' ? uri.fsPath : undefined;
}

/**
 * Finds the workspace's repositories (filesystem reads only) and decides which one a build
 * analyses: the active file's, the remembered one, or the user's pick.
 */
export class Repositories {
  constructor(private readonly deps: RepositoryDeps) {}

  private folders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  }

  /** Every candidate repository; no git process (ADR-0012), so it is safe before trust. */
  discover(): Promise<Discovery> {
    return discoverRepositories(this.folders(), undefined, { exclude: this.deps.exclude() });
  }

  remembered(): string | undefined {
    const value: unknown = this.deps.context.workspaceState.get(REPOSITORY_KEY);
    return typeof value === 'string' ? value : undefined;
  }

  /** Whether the repository question has been shown in this workspace. */
  pickerSeen(): boolean {
    return this.deps.context.workspaceState.get(PICKER_SEEN_KEY) === true;
  }

  private async remember(root: string): Promise<void> {
    await this.deps.context.workspaceState.update(REPOSITORY_KEY, root);
  }

  /** An umbrella: ≥ 70 % of its tracked files are not code. Runs `git ls-files` (trusted only). */
  private isUmbrella = async (c: RepoCandidate): Promise<boolean> =>
    isMostlyNonCode(await this.deps.trackedFiles(c.root));

  /**
   * The repository a build should analyse. `current` keeps the repository already analysed
   * (rebuilds for another window or rank setting). Undefined when there is no folder, or the
   * user dismissed the question.
   */
  async resolve(opts: { current?: string | undefined } = {}): Promise<Target | undefined> {
    const folders = this.folders();
    const first = folders[0];
    if (first === undefined) return undefined;
    const { candidates } = await this.discover();
    if (opts.current !== undefined) {
      const kept = await matchRoot(candidates, opts.current);
      if (kept) return { cwd: kept.root, candidate: kept, reason: 'current' };
    }
    const choice = await chooseRepository(candidates, {
      activeFile: activeFile(),
      remembered: this.remembered(),
      isUmbrella: this.isUmbrella,
    });
    if (!choice.candidate) return { cwd: first, reason: 'none' };
    if (!choice.ask)
      return { cwd: choice.candidate.root, candidate: choice.candidate, reason: choice.reason };
    const picked = await this.ask(candidates, choice.candidate, undefined);
    return picked && { cwd: picked.root, candidate: picked, reason: 'picked' };
  }

  /** Churnmap: Select repository…: the same question at any time. */
  async select(current: string | undefined): Promise<RepoCandidate | undefined> {
    const { candidates } = await this.discover();
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage(
        'Churnmap: no git repository was found in this workspace (searched 3 folders deep).',
      );
      return undefined;
    }
    const recommended = await recommend(candidates, this.isUmbrella);
    return this.ask(candidates, recommended, current);
  }

  private async ask(
    candidates: readonly RepoCandidate[],
    recommended: RepoCandidate | undefined,
    current: string | undefined,
  ): Promise<RepoCandidate | undefined> {
    const currentCandidate =
      current === undefined ? undefined : await matchRoot(candidates, current);
    const items = pickItems(candidates, { recommended, current: currentCandidate?.root });
    await this.deps.context.workspaceState.update(PICKER_SEEN_KEY, true);
    const picked = await prompts.pick(items, {
      title: 'Churnmap: repository',
      placeHolder: 'Which repository should Churnmap analyse?',
      active: items[0],
    });
    const candidate = findCandidate(candidates, picked?.root);
    if (candidate) await this.remember(candidate.root);
    return candidate;
  }

  /**
   * Folders to try for a warm start, best first: the active file's repository, the remembered
   * one, then every other candidate (the first with a cached analysis wins). Filesystem only.
   */
  async warmStartFolders(): Promise<string[]> {
    const { candidates } = await this.discover();
    const first = this.folders()[0];
    if (candidates.length === 0) return first === undefined ? [] : [first];
    const choice = await chooseRepository(candidates, {
      activeFile: activeFile(),
      remembered: this.remembered(),
      // No git before a build: nothing is an umbrella here, and nobody is asked.
      isUmbrella: () => Promise.resolve(false),
    });
    if (!choice.ask && choice.candidate) return [choice.candidate.root];
    return candidates.map((c) => c.root);
  }
}

/** The candidate for `root` as git spells it (a real path; the candidate may be a symlinked one). */
export async function matchRoot(
  candidates: readonly RepoCandidate[],
  root: string,
): Promise<RepoCandidate | undefined> {
  const direct = findCandidate(candidates, root);
  if (direct) return direct;
  const key = normalizeRoot(root);
  for (const c of candidates) {
    const real = await fs.realpath(c.root).catch(() => c.root);
    if (normalizeRoot(real) === key) return c;
  }
  return undefined;
}
