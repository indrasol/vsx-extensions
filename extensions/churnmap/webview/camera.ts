import type { Vec3 } from './picking.js';

/** Camera fly-to duration (the README demo storyboard: the camera flies to the red tower). */
export const FLY_MS = 600;

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** The pose `t` (0–1, eased) of the way from `from` to `to`. */
export function interpolatePose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const e = easeInOutCubic(t);
  return {
    position: lerp3(from.position, to.position, e),
    target: lerp3(from.target, to.target, e),
  };
}

/**
 * Where to put the camera to look at a box: aimed at the box's upper middle, from the direction
 * the camera looks now, at a distance that frames the box (clamped to [80, 1500]).
 */
export function focusPose(min: Vec3, max: Vec3, current: CameraPose): CameraPose {
  const target: Vec3 = [
    (min[0] + max[0]) / 2,
    min[1] + (max[1] - min[1]) * 0.6,
    (min[2] + max[2]) / 2,
  ];
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const distance = Math.min(1500, Math.max(80, size * 3));
  let dx = current.position[0] - current.target[0];
  let dy = current.position[1] - current.target[1];
  let dz = current.position[2] - current.target[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) {
    dx = 0.5;
    dy = 0.7;
    dz = 0.5;
  }
  const n = Math.hypot(dx, dy, dz);
  return {
    target,
    position: [
      target[0] + (dx / n) * distance,
      target[1] + (dy / n) * distance,
      target[2] + (dz / n) * distance,
    ],
  };
}

/** Test-friendly tween: the pose at `elapsedMs`, and whether the flight is over. */
export function poseAt(
  from: CameraPose,
  to: CameraPose,
  elapsedMs: number,
  durationMs: number,
): { pose: CameraPose; done: boolean } {
  if (durationMs <= 0 || elapsedMs >= durationMs) return { pose: to, done: true };
  return { pose: interpolatePose(from, to, elapsedMs / durationMs), done: false };
}

/** The postcard's camera angle (as in the README demo: the camera looks down on the red tower). */
export const HERO_ELEVATION_DEG = 35;
export const HERO_AZIMUTH_DEG = 40;
/** Room around the city for the postcard's text. */
const HERO_MARGIN = 1.12;

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** The camera's right, up and forward axes when it looks along `forward` (world up is +y). */
export function viewAxes(forward: Vec3): { right: Vec3; up: Vec3; forward: Vec3 } {
  const f = normalize(forward);
  const right = normalize(cross(f, [0, 1, 0]));
  return { right, up: cross(right, f), forward: f };
}

/**
 * The postcard pose: 35° above the horizon, aimed a third of the way from the city's centre to
 * `focus` (the rank-1 building), and just far enough back that every corner of the city's box
 * `[min, max]` is inside a `fovDeg` (vertical) × `aspect` frame, with a margin for the text.
 */
export function heroPose(
  min: Vec3,
  max: Vec3,
  focus: Vec3 | undefined,
  fovDeg: number,
  aspect: number,
): CameraPose {
  const centre: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const target = focus ? lerp3(centre, focus, 1 / 3) : centre;
  const el = (HERO_ELEVATION_DEG * Math.PI) / 180;
  const az = (HERO_AZIMUTH_DEG * Math.PI) / 180;
  const back: Vec3 = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  const { right, up, forward } = viewAxes([-back[0], -back[1], -back[2]]);
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  // A corner at offset q from the target is in frame from distance d when
  // |q·right| ≤ (d + q·forward)·tanH and |q·up| ≤ (d + q·forward)·tanV.
  let distance = 1;
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      i & 1 ? max[0] : min[0],
      i & 2 ? max[1] : min[1],
      i & 4 ? max[2] : min[2],
    ];
    const q = sub(corner, target);
    const depth = dot(q, forward);
    distance = Math.max(
      distance,
      (Math.abs(dot(q, right)) * HERO_MARGIN) / tanH - depth,
      (Math.abs(dot(q, up)) * HERO_MARGIN) / tanV - depth,
    );
  }
  return {
    target,
    position: [
      target[0] + back[0] * distance,
      target[1] + back[1] * distance,
      target[2] + back[2] * distance,
    ],
  };
}

/** The unit vector from the target towards the camera at `elevationDeg` and `azimuthDeg`. */
export function backVector(elevationDeg: number, azimuthDeg: number): Vec3 {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
}

/** The hero angle (the default view): 35° above the horizon, 40° round. */
export const HERO_BACK: Vec3 = backVector(HERO_ELEVATION_DEG, HERO_AZIMUTH_DEG);
/** Fit keeps the camera's angle round the city, but not lower or higher than this. */
export const FIT_ELEVATION_DEG = [25, 80] as const;

/** The direction a fit looks from: the current one, its elevation kept within `FIT_ELEVATION_DEG`. */
export function fitDirection(current: CameraPose): Vec3 {
  const d = sub(current.position, current.target);
  if (Math.hypot(d[0], d[1], d[2]) < 1e-9) return HERO_BACK;
  const n = normalize(d);
  const elevation = (Math.asin(Math.max(-1, Math.min(1, n[1]))) * 180) / Math.PI;
  const azimuth =
    Math.hypot(n[0], n[2]) < 1e-6 ? HERO_AZIMUTH_DEG : (Math.atan2(n[0], n[2]) * 180) / Math.PI;
  const [lo, hi] = FIT_ELEVATION_DEG;
  return backVector(Math.min(hi, Math.max(lo, elevation)), azimuth);
}

/** A screen region in normalised device coordinates (x right, y up, −1…1). */
export interface NdcRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Room around the city inside the safe area (the box fills at most this share of it). */
const FIT_MARGIN = 0.92;

/**
 * The closest camera, looking along `-back`, from which every corner of the box `[min, max]`
 * projects inside `safe` (a `fovDeg` vertical × `aspect` frame), centred in it. The camera keeps
 * its orientation and slides: in its own axes, each corner gives two linear limits on the
 * sideways position for a given depth, so the closest depth with room on both axes is found by
 * bisection and the position is the middle of what is left. The orbit target is the point on the
 * view axis level with the box's centre.
 */
export function fitPose(
  min: Vec3,
  max: Vec3,
  back: Vec3,
  fovDeg: number,
  aspect: number,
  safe: NdcRect,
): CameraPose {
  const { right, up, forward } = viewAxes([-back[0], -back[1], -back[2]]);
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  const tanH = tanV * Math.max(1e-3, aspect);
  // Shrink the region about its centre for the margin.
  const mx = (safe.x0 + safe.x1) / 2;
  const my = (safe.y0 + safe.y1) / 2;
  const hx = (Math.max(1e-3, safe.x1 - safe.x0) / 2) * FIT_MARGIN;
  const hy = (Math.max(1e-3, safe.y1 - safe.y0) / 2) * FIT_MARGIN;
  const x0 = mx - hx;
  const x1 = mx + hx;
  const y0 = my - hy;
  const y1 = my + hy;
  const corners: { r: number; u: number; f: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const c: Vec3 = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
    corners.push({ r: dot(c, right), u: dot(c, up), f: dot(c, forward) });
  }
  const nearest = Math.min(...corners.map((c) => c.f));
  const size = Math.max(1, max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  // For camera depth pf (along forward), corner depth is f − pf; its NDC x is (r − pr)/(depth·tanH).
  const range = (pf: number, axis: 'r' | 'u', lo: number, hi: number, tan: number) => {
    let low = -Infinity;
    let high = Infinity;
    for (const c of corners) {
      const depth = c.f - pf;
      low = Math.max(low, c[axis] - hi * tan * depth);
      high = Math.min(high, c[axis] - lo * tan * depth);
    }
    return { low, high };
  };
  const fits = (pf: number): boolean => {
    const a = range(pf, 'r', x0, x1, tanH);
    const b = range(pf, 'u', y0, y1, tanV);
    return a.low <= a.high && b.low <= b.high;
  };
  let near = nearest - 1e-3; // too close (a corner at the camera)
  let far = nearest - size * 200;
  if (!fits(far)) far = nearest - size * 2000;
  for (let i = 0; i < 60; i++) {
    const mid = (near + far) / 2;
    if (fits(mid)) far = mid;
    else near = mid;
  }
  const pf = far;
  const a = range(pf, 'r', x0, x1, tanH);
  const b = range(pf, 'u', y0, y1, tanV);
  const pr = (a.low + a.high) / 2;
  const pu = (b.low + b.high) / 2;
  const position: Vec3 = [
    right[0] * pr + up[0] * pu + forward[0] * pf,
    right[1] * pr + up[1] * pu + forward[1] * pf,
    right[2] * pr + up[2] * pu + forward[2] * pf,
  ];
  const centre: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const distance = Math.max(1, dot(centre, forward) - pf);
  return {
    position,
    target: [
      position[0] + forward[0] * distance,
      position[1] + forward[1] * distance,
      position[2] + forward[2] * distance,
    ],
  };
}

/**
 * The orbit target kept near the city: inside its box `[min, max]` grown by a margin that is half
 * the city's size, but never more than most of the half-view at `distance` (so however close the
 * camera is, some of the city stays on screen and it can never be lost).
 */
export function clampTarget(
  target: Vec3,
  min: Vec3,
  max: Vec3,
  distance: number,
  fovDeg: number,
): Vec3 {
  const size = Math.max(1, max[0] - min[0], max[2] - min[2]);
  const halfView = distance * Math.tan((fovDeg * Math.PI) / 360);
  const margin = Math.min(size * 0.5, halfView * 0.8);
  const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(hi + margin, Math.max(lo - margin, v));
  return [
    clamp(target[0], min[0], max[0]),
    clamp(target[1], min[1], max[1]),
    clamp(target[2], min[2], max[2]),
  ];
}

/** Where `p` lands in normalised device coordinates for a camera at `pose` (behind: undefined). */
export function projectNdc(
  pose: CameraPose,
  p: Vec3,
  fovDeg: number,
  aspect: number,
): { x: number; y: number } | undefined {
  const { right, up, forward } = viewAxes(sub(pose.target, pose.position));
  const q = sub(p, pose.position);
  const depth = dot(q, forward);
  if (depth <= 0) return undefined;
  const tanV = Math.tan((fovDeg * Math.PI) / 360);
  return { x: dot(q, right) / (depth * tanV * aspect), y: dot(q, up) / (depth * tanV) };
}
