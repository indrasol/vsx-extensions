import { describe, expect, it } from 'vitest';
import type { Rect } from '../../../src/city/model.js';
import { squarify } from '../../../src/city/squarify.js';

const r2 = (r: Rect | undefined): number[] => {
  if (!r) return [];
  return [r.x, r.y, r.w, r.h].map((n) => Math.round(n * 100) / 100);
};

describe('squarify', () => {
  it("matches the paper's example: 6,6,4,3,2,2,1 in a 6×4 box", () => {
    // Bruls, Huizing & van Wijk (2000), Fig. 3, by hand (area = weight):
    // 1. side 4: [6] worst 8/3, [6,6] worst 4/3 (better), [6,6,4] worst 4 (worse) → column w 3.
    // 2. 3×4 left, side 3: [4] 2.25, [4,3] 49/27 ≈ 1.81, [4,3,2] 4.5 → row h 7/3 along the top.
    // 3. 3×5/3 left, side 5/3: [2] 1.389, [2,2] 2.88 → column w 1.2.
    // 4. 1.8×5/3 left, side 5/3: [2] 1.389, [2,1] 3.24 → column w 1.2; then [1] fills 0.6×5/3.
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], { x: 0, y: 0, w: 6, h: 4 });
    expect(rects.map(r2)).toEqual([
      [0, 0, 3, 2],
      [0, 2, 3, 2],
      [3, 0, 1.71, 2.33],
      [4.71, 0, 1.29, 2.33],
      [3, 2.33, 1.2, 1.67],
      [4.2, 2.33, 1.2, 1.67],
      [5.4, 2.33, 0.6, 1.67],
    ]);
    const aspects = rects.map((r) => Math.max(r.w / r.h, r.h / r.w));
    expect(Math.max(...aspects)).toBeLessThan(3);
  });

  it('tiles the box exactly: areas are proportional and sum to the box', () => {
    const weights = [50, 30, 10, 5, 3, 1, 1];
    const box = { x: 10, y: 20, w: 300, h: 100 };
    const rects = squarify(weights, box);
    const total = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(total).toBeCloseTo(30_000, 6);
    rects.forEach((r, i) => {
      expect(r.w * r.h).toBeCloseTo(((weights[i] ?? 0) / 100) * 30_000, 6);
      expect(r.x).toBeGreaterThanOrEqual(box.x - 1e-9);
      expect(r.y).toBeGreaterThanOrEqual(box.y - 1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(box.x + box.w + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(box.y + box.h + 1e-9);
    });
  });

  it('handles empty input, zero weights and an empty box', () => {
    expect(squarify([], { x: 0, y: 0, w: 1, h: 1 })).toEqual([]);
    expect(squarify([0, 0], { x: 1, y: 2, w: 5, h: 5 })).toEqual([
      { x: 1, y: 2, w: 0, h: 0 },
      { x: 1, y: 2, w: 0, h: 0 },
    ]);
    expect(squarify([1], { x: 0, y: 0, w: 0, h: 5 })).toEqual([{ x: 0, y: 0, w: 0, h: 0 }]);
    expect(squarify([4], { x: 0, y: 0, w: 2, h: 3 })).toEqual([{ x: 0, y: 0, w: 2, h: 3 }]);
  });
});
