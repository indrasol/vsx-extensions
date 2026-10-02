import type { WhyCode } from '../analysis/model.js';

/**
 * City geometry types, shared by the extension host, the three.js city and the 2D treemap.
 * Browser-safe: nothing under `src/city/` imports `vscode` or `node:` modules
 * (tsconfig.webview.json proves it), and every value is plain JSON so it can be posted to the
 * webview unchanged.
 */

/** An axis-aligned rectangle in layout units; `x`/`y` is the top-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A file (or, above the building cap, a folded folder) drawn as one building. */
export interface Building {
  /** Index into `Layout.buildings`, assigned in traversal order. */
  id: number;
  /** Repository-relative path; a folded leaf is `folder + '/…'`. */
  path: string;
  rect: Rect;
  /** 0–1, normalised against the tallest building. */
  height: number;
  loc: number;
  /** Hotspot score, 0–100. A folded leaf carries the highest score inside it. */
  score: number;
  /**
   * Colour position on the ramp, 0–100 (relative band + score within it; `analysis/bands.ts`).
   * Missing on unranked files. A folded leaf carries the highest heat inside it.
   */
  heat?: number;
  /** Place among all ranked files (1-based); the district card names the riskiest file by it. */
  position?: number;
  /** Hotspot rank (1-based) when the file is in the ranked top list. */
  rank?: number;
  /** Set on synthetic leaves that stand for a whole folder. */
  folded?: { files: number; loc: number };
  /** Commits in the window (files only). */
  commits?: number;
  /** Why the file is not ranked; unranked files are drawn as glass. */
  why?: WhyCode;
}

/** A folder drawn as a district plate. */
export interface District {
  /** Index into `Layout.districts`; the root district (path `''`) is 0. */
  id: number;
  path: string;
  rect: Rect;
  /** 0 for the root. */
  depth: number;
  /** Child district ids, in layout order. */
  children: number[];
  /** Building ids placed directly in this district, in layout order. */
  buildings: number[];
}

export interface Layout {
  width: number;
  height: number;
  districts: District[];
  buildings: Building[];
  /** Every input file path → the building that shows it (a folded file maps to its folder leaf). */
  byPath: Record<string, number>;
  stats: {
    /** Input files. */
    files: number;
    /** Input files drawn inside folded leaves. */
    folded: number;
    /** LOC of the tallest building. */
    maxLoc: number;
  };
}

export interface LayoutOptions {
  width: number;
  height: number;
  /** Space between a district's edge and its contents, and around each building. */
  padding: number;
  /** Space between sibling districts. */
  districtGap: number;
  /** Smallest footprint side the renderers draw; smaller rects are still emitted (renderers clamp). */
  minBuilding: number;
  /** Above this many buildings, the deepest, smallest folders are folded into one leaf each. */
  maxBuildings: number;
  heightScale: 'log' | 'linear';
}

export const DEFAULT_LAYOUT_OPTIONS: Readonly<LayoutOptions> = {
  width: 1000,
  height: 1000,
  padding: 2,
  districtGap: 6,
  minBuilding: 3,
  maxBuildings: 10_000,
  heightScale: 'log',
};

/** The file fields the layout needs; `FileScore` from the analysis satisfies it. */
export interface LayoutFile {
  path: string;
  loc: number;
  score: number;
  heat?: number;
  position?: number;
  commits?: number;
  why?: WhyCode;
}
