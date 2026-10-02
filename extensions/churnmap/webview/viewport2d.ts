/**
 * The 2D treemap's viewport: pure math, so zoom and pan clamping are unit-tested. World units are
 * the layout's (0–width, 0–height); screen units are CSS pixels of the canvas.
 */

export const MAX_ZOOM_2D = 64;
/** Zoomed out this far, the whole layout is a fifth of the canvas (room to fit a small safe area). */
export const MIN_ZOOM_2D = 0.2;
/**
 * However far it is panned, at least this share of the visible width (or of the layout, when
 * that is smaller) still shows the layout, so it can never be lost.
 */
export const KEEP_VISIBLE = 0.2;

export interface Viewport {
  /** 1 = the whole layout fits the canvas. */
  zoom: number;
  /** The world point at the canvas centre. */
  cx: number;
  cy: number;
}

export interface Dims {
  /** Canvas size, CSS px. */
  width: number;
  height: number;
  /** Layout size, world units. */
  worldWidth: number;
  worldHeight: number;
}

/** A canvas region, CSS px from the canvas's top-left corner. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Room around the layout inside the safe area (it fills at most this share of it). */
const FIT_MARGIN = 0.94;

/**
 * The whole layout, centred in `safe` (the canvas minus the HUD and the panels; the whole canvas
 * when not given) with a small margin.
 */
export function fitViewport(d: Dims, safe?: ScreenRect): Viewport {
  const area = safe ?? { x: 0, y: 0, w: d.width, h: d.height };
  const base = scaleOf({ zoom: 1, cx: 0, cy: 0 }, d);
  const want =
    Math.min(
      Math.max(1, area.w) / Math.max(d.worldWidth, 1e-9),
      Math.max(1, area.h) / Math.max(d.worldHeight, 1e-9),
    ) * (safe ? FIT_MARGIN : 1);
  const zoom = Math.min(MAX_ZOOM_2D, Math.max(MIN_ZOOM_2D, want / base));
  const s = base * zoom;
  return {
    zoom,
    cx: d.worldWidth / 2 - (area.x + area.w / 2 - d.width / 2) / s,
    cy: d.worldHeight / 2 - (area.y + area.h / 2 - d.height / 2) / s,
  };
}

/** CSS pixels per world unit. */
export function scaleOf(vp: Viewport, d: Dims): number {
  const fit = Math.min(
    d.width / Math.max(d.worldWidth, 1e-9),
    d.height / Math.max(d.worldHeight, 1e-9),
  );
  return fit * vp.zoom;
}

export function toScreen(vp: Viewport, d: Dims, x: number, y: number): [number, number] {
  const s = scaleOf(vp, d);
  return [(x - vp.cx) * s + d.width / 2, (y - vp.cy) * s + d.height / 2];
}

export function toWorld(vp: Viewport, d: Dims, sx: number, sy: number): [number, number] {
  const s = scaleOf(vp, d);
  return [(sx - d.width / 2) / s + vp.cx, (sy - d.height / 2) / s + vp.cy];
}

/**
 * Zoom within [MIN_ZOOM_2D, MAX_ZOOM_2D]; the centre may move past the layout's edge, but only
 * until `KEEP_VISIBLE` of the view still shows the layout.
 */
export function clampViewport(vp: Viewport, d: Dims): Viewport {
  const zoom = Math.min(MAX_ZOOM_2D, Math.max(MIN_ZOOM_2D, Number.isFinite(vp.zoom) ? vp.zoom : 1));
  const s = scaleOf({ ...vp, zoom }, d);
  const clampAxis = (c: number, visible: number, world: number): number => {
    const keep = KEEP_VISIBLE * Math.min(visible, world);
    const lo = keep - visible / 2;
    const hi = world + visible / 2 - keep;
    return Math.min(hi, Math.max(lo, Number.isFinite(c) ? c : world / 2));
  };
  return {
    zoom,
    cx: clampAxis(vp.cx, d.width / s, d.worldWidth),
    cy: clampAxis(vp.cy, d.height / s, d.worldHeight),
  };
}

/** Zooms by `factor` keeping the world point under (sx, sy) fixed (then clamps). */
export function zoomAt(vp: Viewport, d: Dims, sx: number, sy: number, factor: number): Viewport {
  const [wx, wy] = toWorld(vp, d, sx, sy);
  const zoom = Math.min(MAX_ZOOM_2D, Math.max(MIN_ZOOM_2D, vp.zoom * factor));
  const s = scaleOf({ ...vp, zoom }, d);
  return clampViewport(
    { zoom, cx: wx - (sx - d.width / 2) / s, cy: wy - (sy - d.height / 2) / s },
    d,
  );
}

/** Moves the content by (dx, dy) CSS pixels (then clamps). */
export function panBy(vp: Viewport, d: Dims, dx: number, dy: number): Viewport {
  const s = scaleOf(vp, d);
  return clampViewport({ ...vp, cx: vp.cx - dx / s, cy: vp.cy - dy / s }, d);
}

/** Frames a world rect so it fills about a third of `safe` (the canvas), centred in it. */
export function focusRect(
  d: Dims,
  rect: { x: number; y: number; w: number; h: number },
  safe?: ScreenRect,
): Viewport {
  const area = safe ?? { x: 0, y: 0, w: d.width, h: d.height };
  const fit = Math.min(d.width / d.worldWidth, d.height / d.worldHeight);
  const want = Math.min(area.w / Math.max(rect.w * 3, 1e-9), area.h / Math.max(rect.h * 3, 1e-9));
  const zoom = Math.min(MAX_ZOOM_2D, Math.max(MIN_ZOOM_2D, want / fit));
  const s = fit * zoom;
  return clampViewport(
    {
      zoom,
      cx: rect.x + rect.w / 2 - (area.x + area.w / 2 - d.width / 2) / s,
      cy: rect.y + rect.h / 2 - (area.y + area.h / 2 - d.height / 2) / s,
    },
    d,
  );
}

/** Label rules (CSS px): file names from 60×14, rank numbers from 24×14, folder names from 60×16. */
export const LABEL_MIN = { building: [60, 14], rank: [24, 14], district: [60, 16] } as const;

export function labelKind(w: number, h: number, kind: 'building' | 'rank' | 'district'): boolean {
  const [minW, minH] = LABEL_MIN[kind];
  return w >= minW && h >= minH;
}

/** The last path segment (a folded leaf's trailing `/…` is kept, e.g. `vendor/…`). */
export function basename(path: string): string {
  const parts = path.split('/');
  const last = parts.at(-1) ?? path;
  return last === '…' && parts.length >= 2 ? `${parts.at(-2) ?? ''}/…` : last;
}

/** Cuts `text` with an ellipsis until `measure(text)` fits `maxWidth` (binary search). */
export function ellipsize(text: string, maxWidth: number, measure: (t: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${text.slice(0, mid)}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? '' : `${text.slice(0, lo)}…`;
}
