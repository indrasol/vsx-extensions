/**
 * The part of the canvas the city can be framed in: the canvas minus the HUD, the insights rail,
 * the legend and a pinned card. Pure, so the fit and the label placement are unit-tested.
 * Rects are CSS px relative to the canvas's top-left corner.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Room kept between the city and an overlay or the canvas edge, CSS px. */
export const SAFE_PAD = 12;
/**
 * A free rect smaller than this (CSS px) is not worth framing the city in (a tiny canvas with
 * every panel open); the panels are then ignored, the HUD never is.
 */
export const MIN_SAFE = { w: 120, h: 90 } as const;

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** True when `inner` lies inside `outer` (to within `eps`). */
export function contains(outer: Rect, inner: Rect, eps = 0.5): boolean {
  return (
    inner.x >= outer.x - eps &&
    inner.y >= outer.y - eps &&
    inner.x + inner.w <= outer.x + outer.w + eps &&
    inner.y + inner.h <= outer.y + outer.h + eps
  );
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

/**
 * The biggest rect inside `width` × `height` (inset by `pad`) that touches none of `obstacles`
 * (each grown by `pad`). Every candidate edge is the canvas edge or an obstacle edge, so a few
 * obstacles mean a few hundred candidates at most.
 */
export function largestFreeRect(
  width: number,
  height: number,
  obstacles: readonly Rect[],
  pad = SAFE_PAD,
): Rect {
  const bounds: Rect = {
    x: pad,
    y: pad,
    w: Math.max(0, width - 2 * pad),
    h: Math.max(0, height - 2 * pad),
  };
  const blocks = obstacles.filter((o) => o.w > 0 && o.h > 0).map((o) => grow(o, pad));
  const xs = new Set([bounds.x, bounds.x + bounds.w]);
  const ys = new Set([bounds.y, bounds.y + bounds.h]);
  for (const b of blocks) {
    for (const x of [b.x, b.x + b.w]) if (x > bounds.x && x < bounds.x + bounds.w) xs.add(x);
    for (const y of [b.y, b.y + b.h]) if (y > bounds.y && y < bounds.y + bounds.h) ys.add(y);
  }
  const sx = [...xs].sort((a, b) => a - b);
  const sy = [...ys].sort((a, b) => a - b);
  let best: Rect = { x: bounds.x, y: bounds.y, w: 0, h: 0 };
  for (let i = 0; i < sx.length; i++) {
    for (let j = i + 1; j < sx.length; j++) {
      for (let k = 0; k < sy.length; k++) {
        for (let l = k + 1; l < sy.length; l++) {
          const x0 = sx[i] ?? 0;
          const y0 = sy[k] ?? 0;
          const r = { x: x0, y: y0, w: (sx[j] ?? 0) - x0, h: (sy[l] ?? 0) - y0 };
          if (r.w * r.h <= best.w * best.h) continue;
          if (blocks.some((b) => overlaps(b, r))) continue;
          best = r;
        }
      }
    }
  }
  return best;
}

/**
 * The safe area: the biggest free rect beside the HUD and the panels. When the panels leave less
 * than `MIN_SAFE` (a narrow canvas with every panel open), as few of them as possible are
 * ignored (the biggest rect wins among equals); the HUD never is.
 */
export function safeArea(
  width: number,
  height: number,
  hud: Rect | undefined,
  panels: readonly Rect[],
  pad = SAFE_PAD,
): Rect {
  const fixed = hud ? [hud] : [];
  const roomy = (r: Rect): boolean => r.w >= MIN_SAFE.w && r.h >= MIN_SAFE.h;
  const subsets = Array.from({ length: 2 ** panels.length }, (_, mask) =>
    panels.filter((_, i) => (mask & (1 << i)) === 0),
  );
  for (let ignored = 0; ignored < panels.length; ignored++) {
    let best: Rect | undefined;
    for (const kept of subsets) {
      if (kept.length !== panels.length - ignored) continue;
      const r = largestFreeRect(width, height, [...fixed, ...kept], pad);
      if (roomy(r) && (!best || r.w * r.h > best.w * best.h)) best = r;
    }
    if (best) return best;
  }
  return largestFreeRect(width, height, fixed, pad);
}

/** A canvas rect as normalised device coordinates (x right, y up, both −1…1). */
export function toNdc(
  r: Rect,
  width: number,
  height: number,
): { x0: number; x1: number; y0: number; y1: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return {
    x0: (2 * r.x) / w - 1,
    x1: (2 * (r.x + r.w)) / w - 1,
    y0: 1 - (2 * (r.y + r.h)) / h,
    y1: 1 - (2 * r.y) / h,
  };
}
