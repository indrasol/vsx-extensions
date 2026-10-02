/**
 * Ray picking against axis-aligned boxes, without three.js: the city's buildings are unrotated
 * boxes, so a slab test over a flat table is exact and much cheaper than raycasting the
 * InstancedMesh triangle by triangle.
 */

export type Vec3 = readonly [number, number, number];

export interface Ray {
  origin: Vec3;
  /** Need not be normalised; distances are in units of its length. */
  direction: Vec3;
}

/** Six numbers per box: minX, minY, minZ, maxX, maxY, maxZ. */
export const BOX_STRIDE = 6;

export type BoxTable = ArrayLike<number>;

/** Distance along the ray to box `index`, or Infinity when the ray misses it (slab method). */
export function rayBoxDistance(ray: Ray, table: BoxTable, index: number): number {
  const o = index * BOX_STRIDE;
  let tMin = 0;
  let tMax = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const origin = ray.origin[axis] ?? 0;
    const dir = ray.direction[axis] ?? 0;
    const min = table[o + axis] ?? 0;
    const max = table[o + axis + 3] ?? 0;
    if (Math.abs(dir) < 1e-12) {
      if (origin < min || origin > max) return Infinity;
      continue;
    }
    let t1 = (min - origin) / dir;
    let t2 = (max - origin) / dir;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return Infinity;
  }
  return tMin;
}

export interface Pick {
  index: number;
  distance: number;
}

/** The nearest box the ray hits (ties → lower index), or null. */
export function pickNearest(ray: Ray, table: BoxTable): Pick | null {
  const count = Math.floor(table.length / BOX_STRIDE);
  let best: Pick | null = null;
  for (let i = 0; i < count; i++) {
    const d = rayBoxDistance(ray, table, i);
    if (d < (best?.distance ?? Infinity)) best = { index: i, distance: d };
  }
  return best;
}
