import type { WhyCode } from '../analysis/model.js';
import type { LayoutFile } from './model.js';

/** Files below this LOC still get a visible footprint. */
export const MIN_FILE_WEIGHT = 20;

export function fileWeight(loc: number): number {
  return Math.max(loc, MIN_FILE_WEIGHT);
}

export interface FileLeaf {
  kind: 'file';
  path: string;
  loc: number;
  score: number;
  heat?: number;
  position?: number;
  weight: number;
  commits?: number;
  why?: WhyCode;
}

/** A folder replaced by one synthetic leaf because the city had too many buildings. */
export interface FoldedLeaf {
  kind: 'folded';
  /** `folder + '/…'`. */
  path: string;
  folder: string;
  files: number;
  loc: number;
  /** The highest score inside the folder. */
  score: number;
  /** The highest heat inside the folder (none when nothing inside ranks). */
  heat?: number;
  weight: number;
  /** Every file path inside, so `byPath` can still resolve them. */
  paths: string[];
}

export interface FolderNode {
  kind: 'folder';
  /** `''` for the root, else the repository-relative folder path. */
  path: string;
  depth: number;
  children: TreeNode[];
  /** Totals over the whole subtree. */
  loc: number;
  files: number;
  maxScore: number;
  /** The highest heat in the subtree, -1 when nothing ranks. */
  maxHeat: number;
  weight: number;
  /** Buildings the subtree currently draws (a folded leaf counts 1). */
  leaves: number;
}

export type TreeNode = FolderNode | FileLeaf | FoldedLeaf;

function newFolder(path: string, depth: number): FolderNode {
  return {
    kind: 'folder',
    path,
    depth,
    children: [],
    loc: 0,
    files: 0,
    maxScore: 0,
    maxHeat: -1,
    weight: 0,
    leaves: 0,
  };
}

/** Folder tree with per-node totals. Children keep insertion order here; the layout sorts them. */
export function buildTree(files: readonly LayoutFile[]): FolderNode {
  const root = newFolder('', 0);
  const folders = new Map<string, FolderNode>([['', root]]);

  const folderFor = (path: string): FolderNode => {
    const existing = folders.get(path);
    if (existing) return existing;
    const cut = path.lastIndexOf('/');
    const parent = folderFor(cut < 0 ? '' : path.slice(0, cut));
    const folder = newFolder(path, parent.depth + 1);
    parent.children.push(folder);
    folders.set(path, folder);
    return folder;
  };

  for (const file of files) {
    const cut = file.path.lastIndexOf('/');
    folderFor(cut < 0 ? '' : file.path.slice(0, cut)).children.push({
      kind: 'file',
      path: file.path,
      loc: file.loc,
      score: file.score,
      ...(file.heat === undefined ? {} : { heat: file.heat }),
      ...(file.position === undefined ? {} : { position: file.position }),
      weight: fileWeight(file.loc),
      ...(file.commits === undefined ? {} : { commits: file.commits }),
      ...(file.why === undefined ? {} : { why: file.why }),
    });
  }
  total(root);
  return root;
}

function total(folder: FolderNode): void {
  folder.loc = 0;
  folder.files = 0;
  folder.maxScore = 0;
  folder.maxHeat = -1;
  folder.weight = 0;
  folder.leaves = 0;
  for (const child of folder.children) {
    if (child.kind === 'folder') {
      total(child);
      folder.files += child.files;
      folder.maxScore = Math.max(folder.maxScore, child.maxScore);
      folder.maxHeat = Math.max(folder.maxHeat, child.maxHeat);
      folder.leaves += child.leaves;
    } else {
      folder.files += child.kind === 'file' ? 1 : child.files;
      folder.maxScore = Math.max(folder.maxScore, child.score);
      folder.maxHeat = Math.max(folder.maxHeat, child.heat ?? -1);
      folder.leaves += 1;
    }
    folder.loc += child.loc;
    folder.weight += child.weight;
  }
}

function collectPaths(node: TreeNode, into: string[]): void {
  if (node.kind === 'file') into.push(node.path);
  else if (node.kind === 'folded') into.push(...node.paths);
  else for (const child of node.children) collectPaths(child, into);
}

function compareFoldOrder(a: FolderNode, b: FolderNode): number {
  if (a.depth !== b.depth) return b.depth - a.depth;
  if (a.files !== b.files) return a.files - b.files;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * While the tree draws more than `maxBuildings` leaves, fold folders into one synthetic leaf each:
 * deepest first, then fewest files, then path (so the result never depends on input order).
 * Deeper folders fold before their parents, so a parent that folds later absorbs them. The root is
 * never folded: a root holding more direct files than the cap stays over it.
 * Mutates and returns `root`.
 */
export function foldTree(root: FolderNode, maxBuildings: number): FolderNode {
  if (root.leaves <= maxBuildings) return root;

  const parents = new Map<FolderNode, FolderNode>();
  const candidates: FolderNode[] = [];
  const walk = (folder: FolderNode): void => {
    for (const child of folder.children) {
      if (child.kind !== 'folder') continue;
      parents.set(child, folder);
      candidates.push(child);
      walk(child);
    }
  };
  walk(root);
  candidates.sort(compareFoldOrder);

  for (const folder of candidates) {
    if (root.leaves <= maxBuildings) break;
    if (folder.leaves <= 1) continue;
    const parent = parents.get(folder);
    if (!parent) continue;
    const paths: string[] = [];
    collectPaths(folder, paths);
    const leaf: FoldedLeaf = {
      kind: 'folded',
      path: `${folder.path}/…`,
      folder: folder.path,
      files: folder.files,
      loc: folder.loc,
      score: folder.maxScore,
      ...(folder.maxHeat >= 0 ? { heat: folder.maxHeat } : {}),
      weight: folder.weight,
      paths,
    };
    parent.children[parent.children.indexOf(folder)] = leaf;
    const saved = folder.leaves - 1;
    for (let p: FolderNode | undefined = parent; p; p = parents.get(p)) p.leaves -= saved;
  }
  return root;
}
