import { describe, expect, it } from 'vitest';
import {
  type CameraPose,
  easeInOutCubic,
  FLY_MS,
  focusPose,
  HERO_ELEVATION_DEG,
  heroPose,
  interpolatePose,
  poseAt,
  viewAxes,
} from '../../../webview/camera.js';
import type { Vec3 } from '../../../webview/picking.js';

const FROM: CameraPose = { position: [0, 100, 100], target: [0, 0, 0] };
const TO: CameraPose = { position: [100, 50, 0], target: [50, 10, -50] };

describe('camera fly-to', () => {
  it('eases in and out', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
    expect(easeInOutCubic(0.75)).toBeGreaterThan(0.75);
  });

  it('interpolates both position and target', () => {
    expect(interpolatePose(FROM, TO, 0)).toEqual(FROM);
    expect(interpolatePose(FROM, TO, 1)).toEqual(TO);
    expect(interpolatePose(FROM, TO, 0.5)).toEqual({
      position: [50, 75, 50],
      target: [25, 5, -25],
    });
  });

  it('poseAt finishes at the duration and is instant for 0 ms (reduced motion)', () => {
    expect(FLY_MS).toBe(600);
    expect(poseAt(FROM, TO, 300, FLY_MS)).toEqual({
      pose: interpolatePose(FROM, TO, 0.5),
      done: false,
    });
    expect(poseAt(FROM, TO, 600, FLY_MS)).toEqual({ pose: TO, done: true });
    expect(poseAt(FROM, TO, 0, 0)).toEqual({ pose: TO, done: true });
  });

  it('focusPose aims at the box and keeps the viewing direction', () => {
    const pose = focusPose([0, 0, 0], [10, 40, 10], FROM);
    expect(pose.target).toEqual([5, 24, 5]);
    const dir = pose.position.map((v, i) => v - (pose.target[i] ?? 0));
    const len = Math.hypot(...dir);
    expect(len).toBeCloseTo(120, 6); // 3 × the largest side (40)
    // Same direction as FROM's (0, 100, 100) offset.
    expect(dir[0]).toBeCloseTo(0, 6);
    expect((dir[1] ?? 0) / (dir[2] ?? 1)).toBeCloseTo(1, 6);
    // Distance is clamped for tiny and huge boxes; a degenerate camera still works.
    const tiny = focusPose([0, 0, 0], [1, 1, 1], { position: [5, 5, 5], target: [5, 5, 5] });
    expect(Math.hypot(...tiny.position.map((v, i) => v - (tiny.target[i] ?? 0)))).toBeCloseTo(
      80,
      6,
    );
    const huge = focusPose([0, 0, 0], [2000, 10, 10], FROM);
    expect(Math.hypot(...huge.position.map((v, i) => v - (huge.target[i] ?? 0)))).toBeCloseTo(
      1500,
      6,
    );
  });
});

describe('postcard hero pose', () => {
  const min: Vec3 = [-500, 0, -400];
  const max: Vec3 = [500, 160, 400];
  const fov = 45;
  const aspect = 16 / 9;

  /** Where a point lands on screen, in normalised device coordinates (−1…1 inside the frame). */
  function project(pose: CameraPose, p: Vec3): [number, number] {
    const f: Vec3 = [
      pose.target[0] - pose.position[0],
      pose.target[1] - pose.position[1],
      pose.target[2] - pose.position[2],
    ];
    const { right, up, forward } = viewAxes(f);
    const q: Vec3 = [p[0] - pose.position[0], p[1] - pose.position[1], p[2] - pose.position[2]];
    const depth = q[0] * forward[0] + q[1] * forward[1] + q[2] * forward[2];
    const tanV = Math.tan((fov * Math.PI) / 360);
    const x = (q[0] * right[0] + q[1] * right[1] + q[2] * right[2]) / (depth * tanV * aspect);
    const y = (q[0] * up[0] + q[1] * up[1] + q[2] * up[2]) / (depth * tanV);
    return [x, y];
  }

  it('looks down at 35° and keeps every corner of the city in frame, with a margin', () => {
    const focus: Vec3 = [400, 80, 300]; // a tower near a corner
    const pose = heroPose(min, max, focus, fov, aspect);
    const d: Vec3 = [
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    ];
    const elevation = (Math.asin(d[1] / Math.hypot(...d)) * 180) / Math.PI;
    expect(elevation).toBeCloseTo(HERO_ELEVATION_DEG, 6);
    let widest = 0;
    for (let i = 0; i < 8; i++) {
      const corner: Vec3 = [
        i & 1 ? max[0] : min[0],
        i & 2 ? max[1] : min[1],
        i & 4 ? max[2] : min[2],
      ];
      const [x, y] = project(pose, corner);
      expect(Math.abs(x)).toBeLessThanOrEqual(1 / 1.12 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(1 / 1.12 + 1e-9);
      widest = Math.max(widest, Math.abs(x), Math.abs(y));
    }
    // Tight: some corner touches the margin, so the city fills the frame.
    expect(widest).toBeCloseTo(1 / 1.12, 6);
  });

  it('aims a third of the way from the centre to the focus building', () => {
    expect(heroPose(min, max, [300, 80, 0], fov, aspect).target).toEqual([100, 80, 0]);
    expect(heroPose(min, max, undefined, fov, aspect).target).toEqual([0, 80, 0]);
  });
});
