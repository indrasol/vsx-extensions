/**
 * Where the top-5 name pills go so none hides another: pure, so overlapping anchors are
 * unit-tested. Pills are placed by rank (#1 first), so a lower rank can never hide a higher one.
 * Each tries its anchor, then short moves up, up-right, up-left and down (joined to the anchor by
 * a leader line); a pill with no free spot shrinks to its rank badge (`#5`, the name on hover),
 * which may also slide just beside a pill already placed, and a badge with no free spot is not
 * drawn. Nothing is ever placed on an overlay (the HUD, the rail, the legend, the card) or past
 * the canvas edge.
 */
import { overlaps, type Rect } from './safeArea.js';

/** Space between pills, and between a moved pill and its anchor, CSS px. */
export const PILL_GAP = 4;
/** How many rows a pill may move away from its anchor (keeps the leader line short). */
export const MAX_STEPS = 2;
/** A badge may also slide beside a pill in its row, up to this far from its anchor, CSS px. */
export const MAX_LEADER = 100;

export interface PillInput {
  rank: number;
  /** The anchor on screen (the pill's bottom centre when it is not moved), CSS px. */
  x: number;
  y: number;
  /** The full pill's size, and the rank badge's on its own. */
  w: number;
  h: number;
  badgeW: number;
}

export type PillMode = 'full' | 'badge' | 'hidden';

export interface PillPlacement {
  rank: number;
  mode: PillMode;
  /** The pill's top-left corner; meaningless when hidden. */
  left: number;
  top: number;
  w: number;
  h: number;
  /** The pill was moved off its anchor: draw a leader from the anchor to it. */
  moved: boolean;
}

/** The candidate boxes for a pill of `w` × `h` at anchor (x, y), nearest first. */
export function candidates(x: number, y: number, w: number, h: number): Rect[] {
  const out: Rect[] = [{ x: x - w / 2, y: y - h, w, h }];
  const row = h + PILL_GAP;
  for (let k = 1; k <= MAX_STEPS; k++) {
    const up = y - h - k * row;
    out.push(
      { x: x - w / 2, y: up, w, h },
      { x: x + PILL_GAP, y: up, w, h },
      { x: x - PILL_GAP - w, y: up, w, h },
      { x: x - w / 2, y: y + PILL_GAP + (k - 1) * row, w, h },
    );
  }
  return out;
}

/** How far the nearest point of `r` is from (x, y). */
function reach(x: number, y: number, r: Rect): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/**
 * The badge's extra boxes: just left or right of each box already `taken`, in the rows a pill
 * may use, within `MAX_LEADER` of the anchor, nearest first.
 */
function besides(x: number, y: number, w: number, h: number, taken: readonly Rect[]): Rect[] {
  const row = h + PILL_GAP;
  const rows = [y - h];
  for (let k = 1; k <= MAX_STEPS; k++) rows.push(y - h - k * row, y + PILL_GAP + (k - 1) * row);
  const out: Rect[] = [];
  for (const top of rows) {
    for (const t of taken) {
      out.push({ x: t.x + t.w + PILL_GAP, y: top, w, h }, { x: t.x - PILL_GAP - w, y: top, w, h });
    }
  }
  return out
    .map((r) => ({ r, d: reach(x, y, r) }))
    .filter((c) => c.d <= MAX_LEADER)
    .sort((a, b) => a.d - b.d)
    .map((c) => c.r);
}

/**
 * Places every pill (in rank order) on the first candidate box inside `bounds` that touches
 * neither an obstacle nor a pill already placed; full first, then as a badge, else hidden.
 */
export function placePills(
  pills: readonly PillInput[],
  bounds: Rect,
  obstacles: readonly Rect[],
): PillPlacement[] {
  const taken: Rect[] = [];
  const inside = (r: Rect): boolean =>
    r.x >= bounds.x &&
    r.y >= bounds.y &&
    r.x + r.w <= bounds.x + bounds.w &&
    r.y + r.h <= bounds.y + bounds.h;
  const free = (r: Rect): boolean =>
    inside(r) && !obstacles.some((o) => overlaps(o, r)) && !taken.some((t) => overlaps(t, r));
  const out: PillPlacement[] = [];
  for (const pill of [...pills].sort((a, b) => a.rank - b.rank)) {
    let placed: PillPlacement | undefined;
    for (const [mode, w] of [
      ['full', pill.w],
      ['badge', pill.badgeW],
    ] as const) {
      const boxes = candidates(pill.x, pill.y, w, pill.h);
      if (mode === 'badge') boxes.push(...besides(pill.x, pill.y, w, pill.h, taken));
      const index = boxes.findIndex(free);
      const box = boxes[index];
      if (!box) continue;
      placed = {
        rank: pill.rank,
        mode,
        left: box.x,
        top: box.y,
        w: box.w,
        h: box.h,
        moved: index > 0,
      };
      taken.push(box);
      break;
    }
    out.push(
      placed ?? { rank: pill.rank, mode: 'hidden', left: 0, top: 0, w: 0, h: 0, moved: false },
    );
  }
  return out;
}

/** The leader from the anchor to the nearest point of the pill's box: start, length, angle. */
export function leaderLine(
  x: number,
  y: number,
  box: Rect,
): { x: number; y: number; length: number; angle: number } {
  const tx = Math.min(box.x + box.w, Math.max(box.x, x));
  const ty = Math.min(box.y + box.h, Math.max(box.y, y));
  return { x, y, length: Math.hypot(tx - x, ty - y), angle: Math.atan2(ty - y, tx - x) };
}
