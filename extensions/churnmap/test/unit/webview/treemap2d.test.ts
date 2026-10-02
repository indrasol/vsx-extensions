import { describe, expect, it } from 'vitest';
import { layoutCity } from '../../../src/city/layout.js';
import type { Layout } from '../../../src/city/model.js';
import { contains, GridIndex } from '../../../webview/gridIndex.js';
import {
  basename,
  clampViewport,
  type Dims,
  ellipsize,
  fitViewport,
  focusRect,
  KEEP_VISIBLE,
  labelKind,
  MAX_ZOOM_2D,
  MIN_ZOOM_2D,
  panBy,
  scaleOf,
  toScreen,
  toWorld,
  zoomAt,
} from '../../../webview/viewport2d.js';

const LAYOUT: Layout = layoutCity([
  { path: 'src/core/engine.ts', loc: 800, score: 92 },
  { path: 'src/core/rules.ts', loc: 300, score: 70 },
  { path: 'src/api/handler.ts', loc: 400, score: 50 },
  { path: 'docs/guide.md', loc: 120, score: 0 },
  { path: 'README.md', loc: 10, score: 0 },
]);

const centre = (r: { x: number; y: number; w: number; h: number }): [number, number] => [
  r.x + r.w / 2,
  r.y + r.h / 2,
];

describe('GridIndex', () => {
  const index = new GridIndex(LAYOUT);

  it('finds every building at its centre, whatever the grid size', () => {
    for (const cells of [1, 3, 8, 64]) {
      const grid = new GridIndex(LAYOUT, cells);
      for (const b of LAYOUT.buildings) {
        const [x, y] = centre(b.rect);
        expect(grid.hit(x, y), `${b.path} @ ${String(cells)}`).toBe(b);
      }
    }
  });

  it('a building wins over the districts it stands in; else the deepest district wins', () => {
    const engine = LAYOUT.buildings[LAYOUT.byPath['src/core/engine.ts'] ?? -1];
    const core = LAYOUT.districts.find((d) => d.path === 'src/core');
    const src = LAYOUT.districts.find((d) => d.path === 'src');
    expect(engine && core && src).toBeTruthy();
    if (!engine || !core || !src) return;
    const [x, y] = centre(engine.rect);
    // The point is inside the root, src, src/core and the building: the building wins.
    expect(contains(core.rect, x, y) && contains(src.rect, x, y)).toBe(true);
    expect(index.hit(x, y)).toBe(engine);
    // In src/core's padding (inside core, outside every building), src/core wins over src and root.
    const hit = index.hit(core.rect.x + 0.5, core.rect.y + 0.5);
    expect(hit).toBe(core);
    // In src's padding, src wins over the root.
    expect(index.hit(src.rect.x + 0.5, src.rect.y + 0.5)).toBe(src);
  });

  it('returns null outside the layout', () => {
    expect(index.hit(-1, 10)).toBeNull();
    expect(index.hit(10, 1001)).toBeNull();
    expect(index.hit(Number.NaN, 0)).toBeNull();
  });
});

describe('viewport2d', () => {
  const d: Dims = { width: 800, height: 400, worldWidth: 1000, worldHeight: 1000 };

  it('fits the layout and maps both ways', () => {
    const vp = fitViewport(d);
    expect(vp).toEqual({ zoom: 1, cx: 500, cy: 500 });
    expect(scaleOf(vp, d)).toBe(0.4); // limited by the height
    expect(toScreen(vp, d, 500, 500)).toEqual([400, 200]);
    expect(toScreen(vp, d, 0, 0)).toEqual([200, 0]);
    const [wx, wy] = toWorld(vp, d, 123, 77);
    expect(toScreen(vp, d, wx, wy)).toEqual([123, 77]);
  });

  it('clamps zoom to [MIN, MAX] and keeps part of the layout in view', () => {
    expect(clampViewport({ zoom: 0.01, cx: 0, cy: 0 }, d)).toEqual({
      zoom: MIN_ZOOM_2D,
      cx: 0,
      cy: 0,
    });
    expect(clampViewport({ zoom: 1e6, cx: 500, cy: 500 }, d).zoom).toBe(MAX_ZOOM_2D);
    // At zoom 4 the visible area is 500 × 250 world units; a fifth of it must still show the
    // layout: the centre may go 150 units past the left edge and 75 past the bottom.
    expect(clampViewport({ zoom: 4, cx: -500, cy: 5000 }, d)).toEqual({
      zoom: 4,
      cx: -150,
      cy: 1075,
    });
    expect(clampViewport({ zoom: 4, cx: -50, cy: 500 }, d)).toEqual({ zoom: 4, cx: -50, cy: 500 });
    const nan = clampViewport({ zoom: Number.NaN, cx: Number.NaN, cy: 1 }, d);
    expect(nan).toEqual({ zoom: 1, cx: 500, cy: 1 });
  });

  it('never loses the layout, however far it is panned at any zoom', () => {
    for (const zoom of [MIN_ZOOM_2D, 0.5, 1, 4, MAX_ZOOM_2D]) {
      for (const [dx, dy] of [
        [1e7, 0],
        [-1e7, 0],
        [0, 1e7],
        [0, -1e7],
        [1e7, -1e7],
      ] as const) {
        const vp = panBy({ zoom, cx: 500, cy: 500 }, d, dx, dy);
        const [x0, y0] = toScreen(vp, d, 0, 0);
        const [x1, y1] = toScreen(vp, d, 1000, 1000);
        const shownW = Math.min(x1, d.width) - Math.max(x0, 0);
        const shownH = Math.min(y1, d.height) - Math.max(y0, 0);
        expect(shownW).toBeGreaterThanOrEqual(KEEP_VISIBLE * Math.min(d.width, x1 - x0) - 1e-6);
        expect(shownH).toBeGreaterThanOrEqual(KEEP_VISIBLE * Math.min(d.height, y1 - y0) - 1e-6);
      }
    }
  });

  it('fits the layout into a safe area, centred in it', () => {
    const safe = { x: 20, y: 70, w: 500, h: 300 };
    const vp = fitViewport(d, safe);
    const [x0, y0] = toScreen(vp, d, 0, 0);
    const [x1, y1] = toScreen(vp, d, 1000, 1000);
    expect(x0).toBeGreaterThanOrEqual(safe.x);
    expect(y0).toBeGreaterThanOrEqual(safe.y);
    expect(x1).toBeLessThanOrEqual(safe.x + safe.w);
    expect(y1).toBeLessThanOrEqual(safe.y + safe.h);
    expect((x0 + x1) / 2).toBeCloseTo(safe.x + safe.w / 2, 9);
    expect((y0 + y1) / 2).toBeCloseTo(safe.y + safe.h / 2, 9);
    // Limited by the height: 94 % of it.
    expect(y1 - y0).toBeCloseTo(300 * 0.94, 9);
    // It is a fixed point of the clamp (the fit is never undone by it).
    expect(clampViewport(vp, d)).toEqual(vp);
  });

  it('zooms about the pointer: the world point under it stays put', () => {
    // From zoom 2 (the whole width visible) to 4, where neither axis is clamped.
    const from = { zoom: 2, cx: 500, cy: 500 };
    const vp = zoomAt(from, d, 300, 150, 2);
    expect(vp.zoom).toBe(4);
    const before = toWorld(from, d, 300, 150);
    const after = toWorld(vp, d, 300, 150);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
    expect(vp).toEqual({ zoom: 4, cx: 437.5, cy: 468.75 });
    // From the fitted view too: the world point (250, 375) stays under the pointer.
    expect(zoomAt(fitViewport(d), d, 300, 150, 2)).toEqual({ zoom: 2, cx: 375, cy: 437.5 });
    // Zooming far out stops at the minimum.
    expect(zoomAt(vp, d, 0, 0, 0.001).zoom).toBe(MIN_ZOOM_2D);
  });

  it('pans by pixels and stops at the edges', () => {
    const vp = { zoom: 4, cx: 500, cy: 500 };
    expect(panBy(vp, d, 160, 0)).toEqual({ zoom: 4, cx: 400, cy: 500 }); // 160 px / 1.6 px per unit
    expect(panBy(vp, d, 1e6, -1e6)).toEqual({ zoom: 4, cx: -150, cy: 1075 });
    // The fitted view moves too (it used to be locked at zoom 1).
    expect(panBy(fitViewport(d), d, 100, 100)).toEqual({ zoom: 1, cx: 250, cy: 250 });
  });

  it('focusRect frames a building at about a third of the canvas', () => {
    const vp = focusRect(d, { x: 100, y: 100, w: 20, h: 10 });
    expect(vp.cx).toBe(110);
    expect(vp.cy).toBe(105);
    expect(scaleOf(vp, d) * 10 * 3).toBeCloseTo(400, 6); // the rect's height × 3 fills the height
    // With a safe area, the building lands at its centre.
    const safe = { x: 0, y: 100, w: 400, h: 300 };
    const inSafe = focusRect(d, { x: 100, y: 100, w: 20, h: 10 }, safe);
    const [sx, sy] = toScreen(inSafe, d, 110, 105);
    expect(sx).toBeCloseTo(200, 6);
    expect(sy).toBeCloseTo(250, 6);
  });
});

describe('labels', () => {
  it('file names from 60×14, rank numbers from 24×14, folder names from 60×16', () => {
    expect(labelKind(60, 14, 'building')).toBe(true);
    expect(labelKind(59, 14, 'building')).toBe(false);
    expect(labelKind(60, 13, 'building')).toBe(false);
    expect(labelKind(24, 14, 'rank')).toBe(true);
    expect(labelKind(23, 40, 'rank')).toBe(false);
    expect(labelKind(60, 16, 'district')).toBe(true);
    expect(labelKind(60, 15, 'district')).toBe(false);
  });

  it('shows the basename, ellipsised to fit', () => {
    expect(basename('src/core/engine.ts')).toBe('engine.ts');
    expect(basename('README.md')).toBe('README.md');
    expect(basename('vendor/big/…')).toBe('big/…');
    const width = (t: string): number => t.length * 7; // a fake monospace font
    expect(ellipsize('engine.ts', 100, width)).toBe('engine.ts');
    expect(ellipsize('a-very-long-file-name.ts', 70, width)).toBe('a-very-lo…');
    expect(width(ellipsize('a-very-long-file-name.ts', 70, width))).toBeLessThanOrEqual(70);
    expect(ellipsize('abc', 3, width)).toBe('');
  });
});
