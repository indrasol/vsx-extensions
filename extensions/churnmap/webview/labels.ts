import { type PaletteOptions, luminance, rampColour, rgbCss } from '../src/city/palette.js';
import { el } from './dom.js';
import { leaderLine, type PillMode, placePills } from './labelLayout.js';
import type { Vec3 } from './picking.js';
import type { Rect } from './safeArea.js';
import { middleTruncate } from './text.js';

/** Floating pills for the top five hotspots. */
export const LABELLED_RANKS = 5;
/** District names shown at once, at most. */
export const MAX_DISTRICT_LABELS = 12;
/** Occlusion and pill placement are re-checked at most this often (10 per second). */
export const OCCLUSION_MS = 100;
/** Characters of a file name on a pill before it is cut in the middle. */
export const PILL_CHARS = 28;

export interface LabelAnchor {
  key: string;
  text: string;
  /** World position the label points at (a building's roof, a district's plate). */
  pos: Vec3;
  rank?: number;
  /** The building's score (the pill's badge takes its colour). */
  score?: number;
  /** The building the label belongs to (for the occlusion ray). */
  building?: number;
}

export interface DistrictInfo {
  path: string;
  depth: number;
  area: number;
}

/**
 * Which districts get a ground label: the top-level folders (else the next level down when there
 * are fewer than three), biggest first, at most `max`.
 */
export function pickDistrictLabels(
  districts: readonly DistrictInfo[],
  max = MAX_DISTRICT_LABELS,
): DistrictInfo[] {
  const level = (depth: number): DistrictInfo[] => districts.filter((d) => d.depth === depth);
  let chosen = level(1);
  if (chosen.length < 3) chosen = [...chosen, ...level(2)];
  return [...chosen].sort((a, b) => b.area - a.area || (a.path < b.path ? -1 : 1)).slice(0, max);
}

/** Opacity for a label `distance` from the camera: 1 up to `near`, 0 from `far`, smooth between. */
export function distanceFade(distance: number, near: number, far: number): number {
  if (distance <= near) return 1;
  if (distance >= far) return 0;
  const t = (distance - near) / (far - near);
  return 1 - t * t * (3 - 2 * t);
}

export interface Projection {
  x: number;
  y: number;
  /** Behind the camera or outside the view. */
  hidden: boolean;
  /** Distance from the camera, world units. */
  distance: number;
}

export interface FrameInput {
  project(p: Vec3): Projection;
  /** True when something else stands between the camera and the anchor. */
  occluded(anchor: LabelAnchor): boolean;
  /** Camera to orbit target, world units: decides when district names show. */
  zoom: number;
  /** The city's size, world units (fade distances scale with it). */
  size: number;
  now: number;
  /** The canvas, CSS px: pills stay inside it. */
  bounds: Rect;
  /** The HUD, rail, legend and card: pills never go on them. */
  obstacles: readonly Rect[];
}

interface Placed {
  anchor: LabelAnchor;
  node: HTMLElement;
  occluded: boolean;
}

interface Pill extends Placed {
  leader: HTMLElement;
  /** The full pill's and the badge's size, measured once it is first drawn. */
  size?: { w: number; h: number; badgeW: number };
  /** The last placement: how it is drawn and where, relative to its anchor. */
  mode: PillMode;
  dx: number;
  dy: number;
  moved: boolean;
}

/**
 * DOM labels over the 3D city, projected from world positions each rendered frame (no frames, no
 * work). Everything is `textContent`; positions are CSSOM transforms.
 */
export class FloatingLabels {
  readonly layer = el('div', 'labels');
  private pills: Pill[] = [];
  private districts: Placed[] = [];
  private lastOcclusion = -Infinity;
  /** Which pills were shown at the last placement (a change places them again at once). */
  private placedKeys = '';
  private enabled = true;
  /** Labels drawn in the last frame (test stats). */
  shown = 0;

  constructor(parent: HTMLElement) {
    this.layer.setAttribute('aria-hidden', 'true');
    parent.append(this.layer);
  }

  setAnchors(
    buildings: readonly LabelAnchor[],
    districts: readonly LabelAnchor[],
    palette: PaletteOptions,
  ): void {
    this.pills = buildings.map((anchor) => {
      const node = el('div', 'pill');
      if (anchor.rank !== undefined && anchor.score !== undefined) {
        const badge = el('span', 'pill-rank num', `#${String(anchor.rank)}`);
        const colour = rampColour(anchor.score, palette);
        badge.style.backgroundColor = rgbCss(colour);
        badge.style.color = luminance(colour) > 0.35 ? '#10141a' : '#ffffff';
        node.append(badge);
      }
      node.append(el('span', 'pill-name path', middleTruncate(anchor.text, PILL_CHARS)));
      return {
        anchor,
        node,
        leader: el('div', 'pill-leader'),
        occluded: false,
        mode: 'full',
        dx: 0,
        dy: 0,
        moved: false,
      };
    });
    this.districts = districts.map((anchor) => ({
      anchor,
      node: el('div', 'district-label', anchor.text),
      occluded: false,
    }));
    this.layer.replaceChildren(
      ...this.districts.map((d) => d.node),
      ...this.pills.map((p) => p.leader),
      ...this.pills.map((p) => p.node),
    );
    this.lastOcclusion = -Infinity;
    this.placedKeys = '';
    for (const p of [...this.pills, ...this.districts]) p.node.hidden = true;
    for (const p of this.pills) p.leader.hidden = true;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.layer.hidden = !on;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Positions every label for the frame just rendered. */
  update(frame: FrameInput): void {
    if (!this.enabled) {
      this.shown = 0;
      return;
    }
    const due = frame.now - this.lastOcclusion >= OCCLUSION_MS;
    if (due) {
      this.lastOcclusion = frame.now;
      for (const p of this.pills) p.occluded = frame.occluded(p.anchor);
    }
    const near = frame.size * 2.2;
    const far = frame.size * 3.6;
    let shown = 0;
    const visible: { pill: Pill; x: number; y: number; opacity: number }[] = [];
    for (const p of this.pills) {
      const at = frame.project(p.anchor.pos);
      const opacity = distanceFade(at.distance, near, far);
      if (at.hidden || p.occluded || opacity <= 0.02) {
        p.node.hidden = true;
        p.leader.hidden = true;
        continue;
      }
      visible.push({ pill: p, x: at.x, y: at.y, opacity });
    }
    const keys = visible.map((v) => v.pill.anchor.key).join('\n');
    if (due || keys !== this.placedKeys) {
      this.placedKeys = keys;
      this.place(visible, frame);
    }
    for (const { pill: p, x, y, opacity } of visible) {
      const hide = p.mode === 'hidden';
      p.node.hidden = hide;
      p.leader.hidden = hide || !p.moved;
      if (hide) continue;
      shown += 1;
      const left = x + p.dx;
      const top = y + p.dy;
      p.node.style.opacity = opacity.toFixed(3);
      p.node.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      if (p.moved && p.size) {
        const w = p.mode === 'badge' ? p.size.badgeW : p.size.w;
        const line = leaderLine(x, y, { x: left, y: top, w, h: p.size.h });
        p.leader.style.opacity = opacity.toFixed(3);
        p.leader.style.width = `${line.length.toFixed(1)}px`;
        p.leader.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${line.angle.toFixed(4)}rad)`;
      }
    }
    const zoomedOut = frame.zoom > frame.size * 0.9;
    for (const d of this.districts) {
      const at = frame.project(d.anchor.pos);
      const hide = !zoomedOut || at.hidden;
      d.node.hidden = hide;
      if (hide) continue;
      shown += 1;
      d.node.style.opacity = distanceFade(at.distance, near * 1.2, far * 1.4).toFixed(3);
      d.node.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
    this.shown = shown;
  }

  /**
   * Lays the shown pills out (rank order, no overlaps, clear of the overlays) and remembers each
   * one's mode and offset from its anchor until the next placement.
   */
  private place(visible: readonly { pill: Pill; x: number; y: number }[], frame: FrameInput): void {
    for (const { pill } of visible) {
      if (pill.size) continue;
      // Measured once, drawn in full (the badge is the first child).
      pill.node.hidden = false;
      pill.node.classList.remove('compact');
      const badge = pill.node.firstElementChild;
      const badgeW = badge instanceof HTMLElement ? badge.offsetWidth + 8 : 32;
      const size = { w: pill.node.offsetWidth, h: pill.node.offsetHeight, badgeW };
      // Not laid out yet (the layer is hidden): measure again next time.
      if (size.w > 0 && size.h > 0) pill.size = size;
    }
    const placements = placePills(
      visible.map(({ pill, x, y }) => ({
        rank: pill.anchor.rank ?? 0,
        x,
        y,
        w: pill.size?.w ?? 0,
        h: pill.size?.h ?? 0,
        badgeW: pill.size?.badgeW ?? 0,
      })),
      frame.bounds,
      frame.obstacles,
    );
    visible.forEach(({ pill, x, y }) => {
      const at = placements.find((q) => q.rank === (pill.anchor.rank ?? 0));
      pill.mode = at?.mode ?? 'hidden';
      pill.dx = (at?.left ?? 0) - x;
      pill.dy = (at?.top ?? 0) - y;
      pill.moved = at?.moved ?? false;
      const compact = pill.mode === 'badge';
      pill.node.classList.toggle('compact', compact);
      // A badge's full name is on hover.
      if (compact) pill.node.title = `#${String(pill.anchor.rank ?? '')} ${pill.anchor.key}`;
      else pill.node.removeAttribute('title');
    });
  }

  /** Test mode: how many pills are drawn as a badge only. */
  get compactShown(): number {
    return this.pills.filter((p) => !p.node.hidden && p.mode === 'badge').length;
  }

  hideAll(): void {
    for (const p of [...this.pills, ...this.districts]) p.node.hidden = true;
    for (const p of this.pills) p.leader.hidden = true;
    this.shown = 0;
  }
}
