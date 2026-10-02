/**
 * Morphing between two cities, keyed by path: a window switch (or a rebuild on a new HEAD) moves
 * each building from how it looked to how it looks now, instead of redrawing from scratch. Pure,
 * so added, removed and changed files are unit-tested.
 */

/** How one building is drawn: footprint centre and size (world units), base, height, colour. */
export interface Visual {
  path: string;
  x: number;
  z: number;
  w: number;
  d: number;
  base: number;
  height: number;
  /** sRGB 0–255. */
  colour: readonly [number, number, number];
  /** Drawn in the translucent "glass" mesh (not ranked). */
  glass: boolean;
}

export type TweenKind = 'added' | 'removed' | 'changed' | 'same';

export interface TweenEntry {
  kind: TweenKind;
  from: Visual;
  to: Visual;
  /** Index into the new buildings, or -1 for a removed one. */
  index: number;
}

function same(a: Visual, b: Visual): boolean {
  return (
    a.x === b.x &&
    a.z === b.z &&
    a.w === b.w &&
    a.d === b.d &&
    a.base === b.base &&
    a.height === b.height &&
    a.glass === b.glass &&
    a.colour[0] === b.colour[0] &&
    a.colour[1] === b.colour[1] &&
    a.colour[2] === b.colour[2]
  );
}

/**
 * One entry per new building, in order (an added one rises from height 0 on its own footprint),
 * then one per removed building (it sinks to height 0 where it stood).
 */
export function planTween(previous: readonly Visual[], next: readonly Visual[]): TweenEntry[] {
  const before = new Map(previous.map((v) => [v.path, v]));
  const entries: TweenEntry[] = next.map((to, index) => {
    const from = before.get(to.path);
    if (!from) return { kind: 'added', from: { ...to, height: 0 }, to, index };
    return { kind: same(from, to) ? 'same' : 'changed', from, to, index };
  });
  const kept = new Set(next.map((v) => v.path));
  for (const from of previous) {
    if (!kept.has(from.path))
      entries.push({ kind: 'removed', from, to: { ...from, height: 0 }, index: -1 });
  }
  return entries;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The visual `t` (0–1) of the way through. A building that changes mesh (glass ↔ solid) takes its
 * destination mesh at once, and its colour carries the change; a removed one stays where it was.
 */
export function interpolate(entry: TweenEntry, t: number): Visual {
  const { from, to } = entry;
  if (t <= 0) return entry.kind === 'removed' ? from : { ...from, glass: to.glass };
  if (t >= 1) return to;
  return {
    path: to.path,
    x: lerp(from.x, to.x, t),
    z: lerp(from.z, to.z, t),
    w: lerp(from.w, to.w, t),
    d: lerp(from.d, to.d, t),
    base: lerp(from.base, to.base, t),
    height: lerp(from.height, to.height, t),
    colour: [
      lerp(from.colour[0], to.colour[0], t),
      lerp(from.colour[1], to.colour[1], t),
      lerp(from.colour[2], to.colour[2], t),
    ],
    glass: entry.kind === 'removed' ? from.glass : to.glass,
  };
}

/** Counts by kind, for logs and tests. */
export function summarize(entries: readonly TweenEntry[]): Record<TweenKind, number> {
  const out: Record<TweenKind, number> = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const e of entries) out[e.kind] += 1;
  return out;
}
