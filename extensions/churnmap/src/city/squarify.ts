import type { Rect } from './model.js';

/** The worst aspect ratio of a row with the given total and extremes laid along `side`. */
function worst(sum: number, min: number, max: number, side: number): number {
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * Squarified treemap (Bruls, Huizing & van Wijk, 2000). `weights` must be sorted descending and
 * positive; returns one rect per weight, in the same order, tiling `rect` exactly (unrounded).
 * Each row is laid along the shorter side of the space that is left, and grows while adding the
 * next item does not make its worst aspect ratio worse.
 */
export function squarify(weights: readonly number[], rect: Rect): Rect[] {
  const n = weights.length;
  const out: Rect[] = new Array<Rect>(n);
  let total = 0;
  for (const w of weights) total += w;
  if (n === 0) return out;
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) {
    for (let i = 0; i < n; i++) out[i] = { x: rect.x, y: rect.y, w: 0, h: 0 };
    return out;
  }
  const scale = (rect.w * rect.h) / total;
  let { x, y, w, h } = rect;
  let i = 0;
  while (i < n) {
    const side = Math.min(w, h);
    const first = (weights[i] ?? 0) * scale;
    let sum = first;
    let min = first;
    let max = first;
    let current = worst(sum, min, max, side);
    let j = i + 1;
    while (j < n) {
      const area = (weights[j] ?? 0) * scale;
      const next = worst(sum + area, Math.min(min, area), Math.max(max, area), side);
      if (next > current) break;
      sum += area;
      min = Math.min(min, area);
      max = Math.max(max, area);
      current = next;
      j++;
    }
    // The last row takes whatever is left, so float error never leaves a gap.
    const last = j === n;
    if (w >= h) {
      // A column on the left, as tall as the space.
      const colW = last ? w : sum / h;
      let yy = y;
      for (let k = i; k < j; k++) {
        const itemH = k === j - 1 ? y + h - yy : ((weights[k] ?? 0) * scale) / colW;
        out[k] = { x, y: yy, w: colW, h: itemH };
        yy += itemH;
      }
      x += colW;
      w -= colW;
    } else {
      // A row along the top, as wide as the space.
      const rowH = last ? h : sum / w;
      let xx = x;
      for (let k = i; k < j; k++) {
        const itemW = k === j - 1 ? x + w - xx : ((weights[k] ?? 0) * scale) / rowH;
        out[k] = { x: xx, y, w: itemW, h: rowH };
        xx += itemW;
      }
      y += rowH;
      h -= rowH;
    }
    i = j;
  }
  return out;
}
