import { describe, expect, it } from 'vitest';
import {
  clampTarget,
  fitDirection,
  fitPose,
  HERO_BACK,
  projectNdc,
} from '../../../webview/camera.js';
import { PINCH_BOOST, wheelGesture } from '../../../webview/gesture.js';
import { wheelZoomFactor } from '../../../webview/interaction.js';
import {
  candidates,
  leaderLine,
  placePills,
  type PillInput,
} from '../../../webview/labelLayout.js';
import type { Vec3 } from '../../../webview/picking.js';
import {
  contains,
  largestFreeRect,
  overlaps,
  type Rect,
  SAFE_PAD,
  safeArea,
  toNdc,
} from '../../../webview/safeArea.js';

const FOV = 45;
const CITY_MIN: Vec3 = [-500, 0, -500];
const CITY_MAX: Vec3 = [500, 160, 500];

/** The HUD and the rail as they sit at each canvas width (rail open), CSS px. */
function overlaysAt(width: number, height: number, rail: boolean): { hud: Rect; panels: Rect[] } {
  const hud = { x: 10, y: 10, w: width - 20, h: width < 640 ? 76 : width < 900 ? 70 : 44 };
  const railW = Math.min(300, width - 20);
  const panels = rail ? [{ x: width - 10 - railW, y: hud.y + hud.h + 8, w: railW, h: 260 }] : [];
  // The legend, bottom left.
  panels.push({ x: 10, y: height - 10 - 64, w: Math.min(230, width - 20), h: 64 });
  return { hud, panels };
}

/** The city's 8 corners on screen for `pose`, as one bounding rect (CSS px). */
function screenBounds(
  pose: ReturnType<typeof fitPose>,
  width: number,
  height: number,
): Rect | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c: Vec3 = [
      i & 1 ? CITY_MAX[0] : CITY_MIN[0],
      i & 2 ? CITY_MAX[1] : CITY_MIN[1],
      i & 4 ? CITY_MAX[2] : CITY_MIN[2],
    ];
    const p = projectNdc(pose, c, FOV, width / height);
    if (!p) return undefined;
    const x = ((p.x + 1) / 2) * width;
    const y = ((1 - p.y) / 2) * height;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

describe('safe area', () => {
  it('is the canvas minus the padded overlays', () => {
    const r = largestFreeRect(1000, 600, [{ x: 0, y: 0, w: 1000, h: 60 }]);
    expect(r).toEqual({
      x: SAFE_PAD,
      y: 60 + SAFE_PAD,
      w: 1000 - 2 * SAFE_PAD,
      h: 600 - 60 - 2 * SAFE_PAD,
    });
  });

  it('picks the biggest free rect beside a side panel and never touches an overlay', () => {
    const hud = { x: 10, y: 10, w: 980, h: 44 };
    const rail = { x: 690, y: 62, w: 300, h: 400 };
    const card = { x: 10, y: 440, w: 320, h: 150 };
    const r = largestFreeRect(1000, 600, [hud, rail, card]);
    for (const o of [hud, rail, card]) expect(overlaps(r, o)).toBe(false);
    expect(r.x + r.w).toBeLessThanOrEqual(rail.x);
    expect(r.w * r.h).toBeGreaterThan(0.3 * 1000 * 600);
  });

  it('ignores the panels when they leave too little room (the HUD never)', () => {
    const hud = { x: 10, y: 10, w: 340, h: 76 };
    const wall = { x: 10, y: 94, w: 340, h: 480 };
    const r = safeArea(360, 640, hud, [wall]);
    expect(overlaps(r, hud)).toBe(false);
    expect(r.y).toBeGreaterThanOrEqual(hud.y + hud.h);
    expect(r.h).toBeGreaterThan(400);
    // With room for a small city below the wall, the wall is respected.
    const shorter = { ...wall, h: 380 };
    const below = safeArea(360, 640, hud, [shorter]);
    expect(overlaps(below, shorter)).toBe(false);
    expect(below.h).toBeGreaterThanOrEqual(90);
  });

  it('converts to normalised device coordinates', () => {
    expect(toNdc({ x: 0, y: 0, w: 800, h: 400 }, 800, 400)).toEqual({
      x0: -1,
      x1: 1,
      y0: -1,
      y1: 1,
    });
    expect(toNdc({ x: 400, y: 0, w: 400, h: 200 }, 800, 400)).toEqual({
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 1,
    });
  });
});

describe('fit to the safe area (3D)', () => {
  for (const width of [360, 900, 1400]) {
    for (const rail of [true, false]) {
      it(`puts the whole city inside the safe area at ${String(width)} px, rail ${rail ? 'open' : 'closed'}`, () => {
        const height = 700;
        const { hud, panels } = overlaysAt(width, height, rail);
        const safe = safeArea(width, height, hud, panels);
        for (const back of [
          HERO_BACK,
          fitDirection({ position: [0, 900, 10], target: [0, 0, 0] }),
        ]) {
          const pose = fitPose(
            CITY_MIN,
            CITY_MAX,
            back,
            FOV,
            width / height,
            toNdc(safe, width, height),
          );
          const city = screenBounds(pose, width, height);
          expect(city).toBeDefined();
          if (!city) return;
          expect(contains(safe, city)).toBe(true);
          // Not lost in a corner of it either: it fills most of the limiting side.
          expect(Math.max(city.w / safe.w, city.h / safe.h)).toBeGreaterThan(0.8);
        }
      });
    }
  }

  it('keeps the angle round the city, its elevation within limits', () => {
    const level = fitDirection({ position: [100, 1, 0], target: [0, 0, 0] });
    expect((Math.asin(level[1]) * 180) / Math.PI).toBeCloseTo(25, 6);
    expect(level[0]).toBeGreaterThan(0.8); // still looking from +x
    expect(fitDirection({ position: [0, 0, 0], target: [0, 0, 0] })).toEqual(HERO_BACK);
  });
});

describe('pan clamping (3D)', () => {
  it('lets the target move half the city past its edge when zoomed out', () => {
    expect(clampTarget([2000, 0, 0], CITY_MIN, CITY_MAX, 3000, FOV)).toEqual([1000, 0, 0]);
    expect(clampTarget([100, 50, -100], CITY_MIN, CITY_MAX, 3000, FOV)).toEqual([100, 50, -100]);
  });

  it('keeps the city on screen however close the camera is', () => {
    const t = clampTarget([2000, 0, -2000], CITY_MIN, CITY_MAX, 40, FOV);
    const halfView = 40 * Math.tan((FOV * Math.PI) / 360);
    expect(t[0] - CITY_MAX[0]).toBeLessThan(halfView);
    expect(CITY_MIN[2] - t[2]).toBeLessThan(halfView);
  });
});

describe('wheel gestures', () => {
  it('a pinch and a mouse wheel zoom; a two-finger trackpad drag pans', () => {
    expect(wheelGesture({ deltaX: 0, deltaY: 3, deltaMode: 0, ctrlKey: true })).toBe('zoom');
    expect(wheelGesture({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false })).toBe('zoom');
    expect(
      wheelGesture({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, wheelDeltaY: -120 }),
    ).toBe('zoom');
    // macOS mouse wheel: an odd delta whose legacy value is not −3×.
    expect(
      wheelGesture({
        deltaX: 0,
        deltaY: 4.000244140625,
        deltaMode: 0,
        ctrlKey: false,
        wheelDeltaY: -12,
      }),
    ).toBe('zoom');
    expect(
      wheelGesture({ deltaX: 0, deltaY: 7, deltaMode: 0, ctrlKey: false, wheelDeltaY: -21 }),
    ).toBe('pan');
    expect(wheelGesture({ deltaX: 5, deltaY: 2, deltaMode: 0, ctrlKey: false })).toBe('pan');
    expect(wheelGesture({ deltaX: 0, deltaY: 40, deltaMode: 0, ctrlKey: false })).toBe('zoom');
  });

  it('zooms in for negative deltas and boosts a pinch', () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelZoomFactor(3, 1, false)).toBeCloseTo(wheelZoomFactor(48, 0, false), 12);
    expect(Math.log(wheelZoomFactor(-2, 0, true))).toBeCloseTo(
      Math.log(wheelZoomFactor(-2, 0, false)) * PINCH_BOOST,
      12,
    );
  });
});

describe('label placement', () => {
  const BOUNDS: Rect = { x: 0, y: 0, w: 1000, h: 700 };
  const pill = (rank: number, x: number, y: number, w = 150): PillInput => ({
    rank,
    x,
    y,
    w,
    h: 22,
    badgeW: 30,
  });
  const box = (p: { left: number; top: number; w: number; h: number }): Rect => ({
    x: p.left,
    y: p.top,
    w: p.w,
    h: p.h,
  });

  it('five pills on one anchor: none overlaps, and #1 keeps its place', () => {
    const pills = [5, 3, 1, 4, 2].map((rank) => pill(rank, 500, 400, 120 + rank * 10));
    const out = placePills(pills, BOUNDS, []);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]);
    const shown = out.filter((p) => p.mode !== 'hidden');
    expect(shown).toHaveLength(5);
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i];
        const b = shown[j];
        if (a && b)
          expect(overlaps(box(a), box(b)), `#${String(a.rank)} / #${String(b.rank)}`).toBe(false);
      }
    }
    expect(out[0]).toMatchObject({
      mode: 'full',
      moved: false,
      left: 500 - 130 / 2,
      top: 400 - 22,
    });
    expect(out.slice(1).every((p) => p.moved)).toBe(true);
  });

  it('shrinks a crowded pill to its badge beside it, never covering a higher rank', () => {
    // A low strip: two rows of full pills fit; the rest shrink to badges beside them.
    const strip: Rect = { x: 300, y: 330, w: 400, h: 70 };
    const out = placePills(
      [1, 2, 3, 4, 5].map((rank) => pill(rank, 400, 400, 150)),
      strip,
      [],
    );
    expect(out.map((p) => p.mode).slice(0, 3)).toEqual(['full', 'full', 'badge']);
    expect(out[0]?.moved).toBe(false);
    const shown = out.filter((p) => p.mode !== 'hidden');
    for (let i = 0; i < shown.length; i++) {
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i];
        const b = shown[j];
        if (a && b) expect(overlaps(box(a), box(b))).toBe(false);
      }
    }
    for (const p of shown) expect(contains(strip, box(p))).toBe(true);
  });

  it('hides a pill with no free spot at all', () => {
    const strip: Rect = { x: 380, y: 375, w: 40, h: 25 };
    const out = placePills([pill(1, 400, 400, 30), pill(2, 400, 400, 30)], strip, []);
    expect(out.map((p) => p.mode)).toEqual(['full', 'hidden']);
  });

  it('never goes on an overlay (HUD, rail, legend, card) or off the canvas', () => {
    const hud: Rect = { x: 0, y: 0, w: 1000, h: 60 };
    const rail: Rect = { x: 700, y: 60, w: 300, h: 400 };
    const pills = [
      pill(1, 500, 70),
      pill(2, 720, 300),
      pill(3, 990, 600),
      pill(4, 20, 30),
      pill(5, 500, 72),
    ];
    const out = placePills(pills, BOUNDS, [hud, rail]);
    for (const p of out) {
      if (p.mode === 'hidden') continue;
      expect(overlaps(box(p), hud)).toBe(false);
      expect(overlaps(box(p), rail)).toBe(false);
      expect(contains(BOUNDS, box(p))).toBe(true);
    }
    // #1 just under the HUD moves down; #2 under the rail has nowhere to go.
    expect(out[0]?.mode).toBe('full');
    expect(out[1]?.mode).toBe('hidden');
  });

  it('tries the anchor first, then up, up-right, up-left and down', () => {
    const c = candidates(100, 100, 40, 20);
    expect(c[0]).toEqual({ x: 80, y: 80, w: 40, h: 20 });
    expect(c[1]?.y).toBeLessThan(80);
    expect(c[2]?.x).toBeGreaterThan(100);
    expect((c[3]?.x ?? 0) + 40).toBeLessThan(100);
    expect(c[4]?.y).toBeGreaterThan(100);
  });

  it('draws the leader to the nearest point of the moved pill', () => {
    expect(leaderLine(100, 100, { x: 80, y: 50, w: 40, h: 20 })).toEqual({
      x: 100,
      y: 100,
      length: 30,
      angle: -Math.PI / 2,
    });
  });
});
