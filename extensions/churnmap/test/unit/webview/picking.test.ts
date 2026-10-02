import { describe, expect, it } from 'vitest';
import { pickNearest, type Ray, rayBoxDistance } from '../../../webview/picking.js';

// A fake instance table: three unit-ish boxes along x, one tall tower behind another.
//            minX minY minZ maxX maxY maxZ
const TABLE = [
  0,
  0,
  0,
  10,
  10,
  10, // 0: near box
  0,
  0,
  20,
  10,
  50,
  30, // 1: tall tower behind box 0 (further along +z)
  40,
  0,
  0,
  50,
  5,
  10, // 2: low box to the side
];

const down = (x: number, z: number): Ray => ({ origin: [x, 100, z], direction: [0, -1, 0] });

describe('rayBoxDistance', () => {
  it('hits from above at the box top', () => {
    expect(rayBoxDistance(down(5, 5), TABLE, 0)).toBe(90);
    expect(rayBoxDistance(down(5, 25), TABLE, 1)).toBe(50);
  });

  it('misses beside the box and behind the origin', () => {
    expect(rayBoxDistance(down(15, 5), TABLE, 0)).toBe(Infinity);
    const away: Ray = { origin: [5, 100, 5], direction: [0, 1, 0] };
    expect(rayBoxDistance(away, TABLE, 0)).toBe(Infinity);
  });

  it('handles axis-parallel rays inside and outside a slab', () => {
    const along: Ray = { origin: [-10, 5, 5], direction: [1, 0, 0] };
    expect(rayBoxDistance(along, TABLE, 0)).toBe(10);
    const outside: Ray = { origin: [-10, 20, 5], direction: [1, 0, 0] };
    expect(rayBoxDistance(outside, TABLE, 0)).toBe(Infinity);
  });

  it('is 0 when the origin is inside the box', () => {
    expect(rayBoxDistance({ origin: [5, 5, 5], direction: [0, 0, 1] }, TABLE, 0)).toBe(0);
  });
});

describe('pickNearest', () => {
  it('returns the nearest instance along the ray', () => {
    // Looking along +z at height 8: box 0 (z 0..10) is in front of the tower (z 20..30).
    const ray: Ray = { origin: [5, 8, -100], direction: [0, 0, 1] };
    expect(pickNearest(ray, TABLE)).toEqual({ index: 0, distance: 100 });
    // At height 30 only the tower is tall enough.
    expect(pickNearest({ origin: [5, 30, -100], direction: [0, 0, 1] }, TABLE)).toEqual({
      index: 1,
      distance: 120,
    });
  });

  it('works on a Float32Array and returns null on a miss', () => {
    const table = Float32Array.from(TABLE);
    expect(pickNearest(down(45, 5), table)?.index).toBe(2);
    expect(pickNearest(down(100, 100), table)).toBeNull();
    expect(pickNearest(down(0, 0), [])).toBeNull();
  });

  it('works with an oblique camera ray', () => {
    // From (−50, 60, 5) towards (5, 5, 5): enters box 0 through its top-left edge region.
    const ray: Ray = { origin: [-50, 60, 5], direction: [55, -55, 0] };
    const hit = pickNearest(ray, TABLE);
    expect(hit?.index).toBe(0);
    expect(hit?.distance).toBeCloseTo(50 / 55, 6);
  });
});
