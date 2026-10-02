/**
 * Which repository Churnmap analyses when a workspace holds more than one (nested clones under an
 * umbrella folder, or a multi-root workspace). Pure: the caller supplies the candidates (from
 * `discoverRepositories`), the active file, the remembered choice and an umbrella test, so every
 * rule is unit-tested. The VS Code side lives in `repository.ts`.
 */
import * as path from 'node:path';
import { normalizeRoot } from './analysis/cache.js';
import type { RankMode } from './analysis/classify.js';
import type { RepoCandidate } from './analysis/discover.js';
import type { FileScore } from './analysis/model.js';

/** workspaceState key: the repository the user picked for this workspace (its root path). */
export const REPOSITORY_KEY = 'churnmap.repository';

export type ChoiceReason =
  /** The active editor's file is inside it (the deepest match). */
  | 'active'
  /** The user picked it before in this workspace. */
  | 'remembered'
  /** The only candidate. */
  | 'only'
  /** Several candidates and nothing to go on: the first that is not an umbrella of docs. */
  | 'recommended'
  /** No candidate: fall back to the first workspace folder (git finds the root above it). */
  | 'none';

export interface Choice {
  candidate: RepoCandidate | undefined;
  reason: ChoiceReason;
  /** True when the user should be asked (several candidates, nothing active or remembered). */
  ask: boolean;
}

export interface ChoiceContext {
  /** The active editor's file (absolute), if any. */
  activeFile?: string | undefined;
  /** The remembered root, if any. */
  remembered?: string | undefined;
  /**
   * True when a candidate is mostly documentation (≥ 70 % of its tracked files are not code).
   * Asked about the active file's repository when there are others, and, when the rules above
   * do not decide, about each candidate in order, stopping at the first false.
   */
  isUmbrella: (candidate: RepoCandidate) => Promise<boolean>;
}

function inside(root: string, file: string): boolean {
  const r = normalizeRoot(root);
  const f = normalizeRoot(file);
  return f === r || f.startsWith(`${r}/`);
}

/** The deepest candidate whose folder contains `file`. */
export function deepestContaining(
  candidates: readonly RepoCandidate[],
  file: string,
): RepoCandidate | undefined {
  let best: RepoCandidate | undefined;
  for (const c of candidates) {
    if (!inside(c.root, file)) continue;
    if (!best || normalizeRoot(c.root).length > normalizeRoot(best.root).length) best = c;
  }
  return best;
}

export function findCandidate(
  candidates: readonly RepoCandidate[],
  root: string | undefined,
): RepoCandidate | undefined {
  if (root === undefined) return undefined;
  const key = normalizeRoot(root);
  return candidates.find((c) => normalizeRoot(c.root) === key);
}

/** The first candidate that is not an umbrella, else the first candidate. */
export async function recommend(
  candidates: readonly RepoCandidate[],
  isUmbrella: (c: RepoCandidate) => Promise<boolean>,
): Promise<RepoCandidate | undefined> {
  for (const c of candidates) {
    if (!(await isUmbrella(c).catch(() => false))) return c;
  }
  return candidates[0];
}

/**
 * The auto rule: the active file's deepest repository, else the remembered one, else the only
 * one, else the recommended one (and ask). An umbrella of notes is never picked automatically
 * for its active file while another repository exists (a doc open in the umbrella would
 * otherwise analyse the notes and hide the code); the question is asked instead.
 */
export async function chooseRepository(
  candidates: readonly RepoCandidate[],
  ctx: ChoiceContext,
): Promise<Choice> {
  if (candidates.length === 0) return { candidate: undefined, reason: 'none', ask: false };
  const active =
    ctx.activeFile === undefined ? undefined : deepestContaining(candidates, ctx.activeFile);
  if (active && !(candidates.length > 1 && (await ctx.isUmbrella(active).catch(() => false)))) {
    return { candidate: active, reason: 'active', ask: false };
  }
  const remembered = findCandidate(candidates, ctx.remembered);
  if (remembered) return { candidate: remembered, reason: 'remembered', ask: false };
  if (candidates.length === 1) return { candidate: candidates[0], reason: 'only', ask: false };
  return {
    candidate: await recommend(candidates, ctx.isUmbrella),
    reason: 'recommended',
    ask: true,
  };
}

export interface RepoPickItem {
  label: string;
  description: string;
  detail: string;
  root: string;
}

/** The quick pick rows: the recommended one first and marked, each with where it is. */
export function pickItems(
  candidates: readonly RepoCandidate[],
  opts: { recommended?: RepoCandidate | undefined; current?: string | undefined },
): RepoPickItem[] {
  const recommendedKey =
    opts.recommended === undefined ? undefined : normalizeRoot(opts.recommended.root);
  const currentKey = opts.current === undefined ? undefined : normalizeRoot(opts.current);
  const rows = candidates.map((c) => {
    const key = normalizeRoot(c.root);
    const where = c.isNested
      ? `${relativeTo(c.workspaceFolder, c.root)} · nested repository`
      : `${c.name} · workspace folder`;
    const tags = [
      ...(key === recommendedKey ? ['recommended'] : []),
      ...(key === currentKey ? ['current'] : []),
    ];
    return { label: c.name, description: tags.join(' · '), detail: where, root: c.root };
  });
  // Stable: the recommended row moves to the top, the rest keep discovery order.
  return [
    ...rows.filter((r) => normalizeRoot(r.root) === recommendedKey),
    ...rows.filter((r) => normalizeRoot(r.root) !== recommendedKey),
  ];
}

/** `root` relative to `folder`, forward slashes (the folder's own name when they are the same). */
export function relativeTo(folder: string, root: string): string {
  const rel = path.relative(folder, root).replace(/\\/g, '/');
  return rel === '' ? path.basename(root) : rel;
}

/** workspaceState key: the repository question has been shown in this workspace. */
export const PICKER_SEEN_KEY = 'churnmap.repositoryPickerSeen';

/**
 * The empty state's buttons. "Rank all files" (which ranks notes and docs as hotspots) is offered
 * only once the user has seen the repository question, so picking a code repository comes first.
 */
export function mostlyDocsActions(pickerSeen: boolean): string[] {
  return pickerSeen ? [SELECT_REPOSITORY_ACTION, RANK_ALL_ACTION] : [SELECT_REPOSITORY_ACTION];
}

export { RANK_ALL_LABEL } from './city/protocol.js';

/** Fewer eligible code files than this, and the empty state explains why. */
export const MIN_CODE_FILES = 3;

export const MOSTLY_DOCS_MESSAGE =
  'This repository is mostly documentation. Churnmap ranks source code by default. Pick a code repository, or set churnmap.rank to all.';
export const SELECT_REPOSITORY_ACTION = 'Select repository…';
export const RANK_ALL_ACTION = 'Rank all files';

/** With `rank: code`, true when fewer than `MIN_CODE_FILES` files are eligible in the window. */
export function isMostlyDocumentation(
  files: readonly Pick<FileScore, 'eligible'>[],
  rank: RankMode,
): boolean {
  return rank === 'code' && files.filter((f) => f.eligible).length < MIN_CODE_FILES;
}
