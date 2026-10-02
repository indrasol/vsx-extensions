import {
  type Building,
  DEFAULT_LAYOUT_OPTIONS,
  type District,
  type Layout,
  type LayoutFile,
  type LayoutOptions,
  type Rect,
} from './model.js';
import { squarify } from './squarify.js';
import { buildTree, type FolderNode, foldTree, type TreeNode } from './tree.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundRect(r: Rect): Rect {
  return { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) };
}

/** Shrinks a rect by `d` on every side, never by more than a quarter of a side, so deep trees keep area. */
function inset(r: Rect, d: number): Rect {
  const dx = Math.min(d, r.w / 4);
  const dy = Math.min(d, r.h / 4);
  return { x: r.x + dx, y: r.y + dy, w: r.w - 2 * dx, h: r.h - 2 * dy };
}

/** Weight descending, then path ascending (code-unit order, never locale or insertion order). */
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.weight !== b.weight) return b.weight - a.weight;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Lays the files out as a city: folders are districts, files are buildings (squarified treemap,
 * weight = max(loc, 20)), height = LOC on a log (or linear) scale. Above `maxBuildings`, the
 * deepest, smallest folders fold into one building each. Pure and deterministic: the same files
 * in any order give byte-identical JSON.
 *
 * `ranks` maps a path to its hotspot rank; a folded leaf takes the best rank inside it.
 */
export function layoutCity(
  files: readonly LayoutFile[],
  options: Partial<LayoutOptions> = {},
  ranks: Readonly<Record<string, number>> = {},
): Layout {
  const opts: LayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const root = foldTree(buildTree(files), opts.maxBuildings);

  const districts: District[] = [];
  const buildings: Building[] = [];
  const byPath: Record<string, number> = {};
  let foldedFiles = 0;
  let maxLoc = 0;

  const rankOf = (path: string): number | undefined => {
    const r = ranks[path];
    return typeof r === 'number' ? r : undefined;
  };

  const place = (folder: FolderNode, rect: Rect, parent: District | undefined): void => {
    const district: District = {
      id: districts.length,
      path: folder.path,
      rect: roundRect(rect),
      depth: folder.depth,
      children: [],
      buildings: [],
    };
    districts.push(district);
    parent?.children.push(district.id);

    const children = [...folder.children].sort(compareNodes);
    const slots = squarify(
      children.map((c) => c.weight),
      inset(rect, opts.padding),
    );
    children.forEach((child, i) => {
      const slot = slots[i];
      if (!slot) return;
      if (child.kind === 'folder') {
        place(child, inset(slot, opts.districtGap / 2), district);
        return;
      }
      const building: Building = {
        id: buildings.length,
        path: child.path,
        rect: roundRect(inset(slot, opts.padding / 2)),
        height: 0,
        loc: child.loc,
        score: child.score,
      };
      if (child.heat !== undefined) building.heat = child.heat;
      if (child.kind === 'file') {
        if (child.position !== undefined) building.position = child.position;
        const rank = rankOf(child.path);
        if (rank !== undefined) building.rank = rank;
        if (child.commits !== undefined) building.commits = child.commits;
        if (child.why !== undefined) building.why = child.why;
        byPath[child.path] = building.id;
      } else {
        building.folded = { files: child.files, loc: child.loc };
        foldedFiles += child.files;
        let best: number | undefined;
        for (const path of child.paths) {
          byPath[path] = building.id;
          const rank = rankOf(path);
          if (rank !== undefined && (best === undefined || rank < best)) best = rank;
        }
        if (best !== undefined) building.rank = best;
      }
      maxLoc = Math.max(maxLoc, child.loc);
      buildings.push(building);
      district.buildings.push(building.id);
    });
  };

  place(root, { x: 0, y: 0, w: opts.width, h: opts.height }, undefined);

  const denominator = opts.heightScale === 'log' ? Math.log1p(maxLoc) : maxLoc;
  for (const b of buildings) {
    const value = opts.heightScale === 'log' ? Math.log1p(b.loc) : b.loc;
    b.height = denominator > 0 ? Math.round((value / denominator) * 10_000) / 10_000 : 0;
  }

  return {
    width: opts.width,
    height: opts.height,
    districts,
    buildings,
    byPath,
    stats: { files: files.length, folded: foldedFiles, maxLoc },
  };
}
