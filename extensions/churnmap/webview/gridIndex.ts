import type { Building, District, Layout, Rect } from '../src/city/model.js';

/**
 * A uniform grid over the layout for 2D hit-testing: each cell lists the buildings and districts
 * that overlap it, so a hover looks at a handful of rects instead of all of them.
 */
export class GridIndex {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellW: number;
  private readonly cellH: number;
  private readonly buildingCells: number[][];
  private readonly districtCells: number[][];

  constructor(
    private readonly layout: Layout,
    cells = Math.max(8, Math.min(128, Math.ceil(Math.sqrt(layout.buildings.length / 2)))),
  ) {
    this.cols = cells;
    this.rows = cells;
    this.cellW = Math.max(layout.width, 1e-9) / cells;
    this.cellH = Math.max(layout.height, 1e-9) / cells;
    this.buildingCells = Array.from({ length: cells * cells }, () => []);
    this.districtCells = Array.from({ length: cells * cells }, () => []);
    for (const b of layout.buildings) this.insert(this.buildingCells, b.id, b.rect);
    for (const d of layout.districts) this.insert(this.districtCells, d.id, d.rect);
  }

  private insert(cells: number[][], id: number, r: Rect): void {
    const c0 = this.col(r.x);
    const c1 = this.col(r.x + r.w);
    const r0 = this.row(r.y);
    const r1 = this.row(r.y + r.h);
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) cells[row * this.cols + col]?.push(id);
    }
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellW)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellH)));
  }

  /**
   * The building at world point (x, y), else the deepest district containing it, else null.
   * A building always wins over the district it stands in.
   */
  hit(x: number, y: number): Building | District | null {
    const { layout } = this;
    if (!(x >= 0 && y >= 0 && x <= layout.width && y <= layout.height)) return null;
    const cell = this.row(y) * this.cols + this.col(x);
    for (const id of this.buildingCells[cell] ?? []) {
      const b = layout.buildings[id];
      if (b && contains(b.rect, x, y)) return b;
    }
    let best: District | null = null;
    for (const id of this.districtCells[cell] ?? []) {
      const d = layout.districts[id];
      if (d && contains(d.rect, x, y) && (best === null || d.depth > best.depth)) best = d;
    }
    return best;
  }
}

export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
}
