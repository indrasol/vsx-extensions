import type { Building, District } from '../src/city/model.js';
import {
  backgroundGradient,
  glassColour,
  GLASS_OPACITY,
  heatOf,
  isGlass,
  luminance,
  mixRgb,
  type PaletteVariant,
  rampColour,
  type RGB,
  rgbCss,
  variantOf,
} from '../src/city/palette.js';
import type { AnalysisMessage } from '../src/city/protocol.js';
import { codeFont, UI_FONT } from './fonts.js';
import { GridIndex } from './gridIndex.js';
import type { Rect } from './safeArea.js';
import { middleTruncateToWidth } from './text.js';
import type { ThemeColours } from './theme.js';
import type { CityView, NavAction, Overlays, PostcardLook, RenderStats } from './view.js';
import {
  basename,
  clampViewport,
  type Dims,
  fitViewport,
  focusRect,
  labelKind,
  panBy,
  scaleOf,
  toScreen,
  toWorld,
  type Viewport,
  zoomAt,
} from './viewport2d.js';

const GLOW_RANKS = 20;
const KEY_PAN_PX = 60;
const KEY_ZOOM = 1.25;
const FONT_PX = 11;
/** Rects at least this big on screen get 3 px rounded corners (smaller ones are plain). */
const ROUND_MIN_PX = 6;
const HEADER_PX = 16;

interface PaintOptions {
  /** Device pixels per CSS pixel. */
  ratio: number;
  /** Where the drawing starts on the context, CSS px. */
  offset?: { x: number; y: number };
  /** The whole canvas (CSS px), for the backdrop, when it is bigger than the drawing area. */
  canvasSize?: { width: number; height: number };
  theme: ThemeColours | undefined;
  variant: PaletteVariant;
  highContrast: boolean;
  /** Buildings grouped by CSS fill, so each colour is one path. */
  groups: readonly FillGroup[];
  /** Paint the backdrop gradient first. */
  background: boolean;
  /** Folder and file names (off for the postcard, which shows no names). */
  names: boolean;
  hoverId: number | null;
  selectedId: number | null;
}

interface FillGroup {
  fill: string;
  ids: number[];
}

/** Buildings grouped by fill (heat to half a point), glass in its own group. */
function groupFills(
  buildings: readonly Building[],
  opts: { variant: PaletteVariant; highContrast: boolean },
): FillGroup[] {
  const glass = rgbCss(glassColour(opts.variant), GLASS_OPACITY);
  const groups = new Map<string, number[]>();
  for (const b of buildings) {
    const fill = isGlass(b) ? glass : rgbCss(rampColour(Math.round(heatOf(b) * 2) / 2, opts));
    const ids = groups.get(fill);
    if (ids) ids.push(b.id);
    else groups.set(fill, [b.id]);
  }
  // Glass first, so solid colours sit on top at shared edges.
  return [...groups]
    .map(([fill, ids]) => ({ fill, ids }))
    .sort((a, b) => (a.fill === glass ? -1 : b.fill === glass ? 1 : 0));
}

/**
 * The flat view of the same `Layout`: districts as nested rounded plates with header strips,
 * buildings as rounded rects in the city's palette (unranked ones as glass), rank pills on the
 * top 20. Canvas 2D, drawn on demand only (data, theme, hover, zoom/pan, resize).
 */
export class TreemapView implements CityView {
  readonly mode = '2d' as const;
  readonly element: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private current: AnalysisMessage | undefined;
  private index: GridIndex | undefined;
  private vp: Viewport = { zoom: 1, cx: 500, cy: 500 };
  private theme: ThemeColours | undefined;
  private highContrast = false;
  private groups: FillGroup[] = [];
  /** Each building's district, and each district's parent (-1 at the root). */
  private districtOf = new Int32Array(0);
  private parentOf = new Int32Array(0);
  private hoverId: number | null = null;
  private selectedId: number | null = null;
  /** The HUD, panels and safe area (from the page). */
  private overlays: Overlays | undefined;
  /** The repository last drawn: a different one is fitted to the view again. */
  private repoKey: string | undefined;
  private frameRequested = false;
  private pixelRatio = Math.min(window.devicePixelRatio, 2);
  private readonly resize: ResizeObserver;
  private fontFamily = 'ui-monospace, monospace';
  /** Test-mode counters. */
  lastDrawMs = 0;
  draws = 0;

  /** Throws when the 2D context is unavailable. */
  constructor() {
    this.element = document.createElement('canvas');
    this.element.id = 'treemap';
    this.element.tabIndex = 0;
    this.element.hidden = true;
    this.element.setAttribute('aria-label', 'Churnmap treemap');
    this.element.setAttribute('aria-describedby', 'city-help');
    const ctx = this.element.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.resize = new ResizeObserver(() => {
      this.fit();
    });
  }

  get data(): AnalysisMessage | undefined {
    return this.current;
  }

  mount(root: HTMLElement): void {
    if (this.element.parentElement !== root) {
      // After the 3D canvas, so the focus order stays HUD → view → list.
      const anchor = document.getElementById('city-help');
      root.insertBefore(this.element, anchor?.parentElement === root ? anchor : null);
    }
    this.element.hidden = false;
    this.resize.observe(root);
    this.fit();
    this.drawNow();
  }

  unmount(): void {
    this.element.hidden = true;
    this.resize.disconnect();
  }

  private get useHighContrast(): boolean {
    return this.highContrast || this.theme?.kind === 'hc';
  }

  /** The whole canvas: the safe area decides where the layout is fitted, not an inset. */
  private dims(): Dims {
    const layout = this.current?.layout;
    return {
      width: Math.max(1, this.element.clientWidth),
      height: Math.max(1, this.element.clientHeight),
      worldWidth: layout?.width ?? 1000,
      worldHeight: layout?.height ?? 1000,
    };
  }

  /** The safe area the page last reported, else the canvas below a typical HUD. */
  private safeRect(): Rect {
    const d = this.dims();
    const o = this.overlays;
    if (o && o.width === d.width && o.height === d.height && o.safe.w > 0 && o.safe.h > 0) {
      return o.safe;
    }
    const top = Math.min(62, d.height / 3);
    return { x: 12, y: top, w: Math.max(1, d.width - 24), h: Math.max(1, d.height - top - 12) };
  }

  setOverlays(overlays: Overlays): void {
    this.overlays = overlays;
  }

  fitToView(): void {
    this.vp = fitViewport(this.dims(), this.safeRect());
    this.requestDraw();
  }

  projectedBounds(): Rect | undefined {
    const layout = this.current?.layout;
    if (!layout) return undefined;
    const d = this.dims();
    const [x0, y0] = toScreen(this.vp, d, 0, 0);
    const [x1, y1] = toScreen(this.vp, d, layout.width, layout.height);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Test mode: the viewport (zoom and the world point at the canvas centre). */
  get viewport(): Viewport {
    return this.vp;
  }

  private fit(): void {
    const w = Math.max(1, this.element.clientWidth);
    const h = Math.max(1, this.element.clientHeight);
    this.element.width = Math.round(w * this.pixelRatio);
    this.element.height = Math.round(h * this.pixelRatio);
    this.vp = clampViewport(this.vp, this.dims());
    this.requestDraw();
  }

  setData(message: AnalysisMessage, receivedAt = performance.now()): RenderStats {
    this.current = message;
    this.index = new GridIndex(message.layout);
    const { layout } = message;
    this.districtOf = new Int32Array(layout.buildings.length).fill(-1);
    this.parentOf = new Int32Array(layout.districts.length).fill(-1);
    for (const d of layout.districts) {
      for (const id of d.buildings) this.districtOf[id] = d.id;
      for (const c of d.children) this.parentOf[c] = d.id;
    }
    this.hoverId = null;
    this.selectedId = null;
    // First data or another repository: fitted to the safe area. A new window on the same one
    // keeps the user's pan and zoom.
    const repoKey = message.repoPath ?? message.repoName;
    if (repoKey !== this.repoKey) this.vp = fitViewport(this.dims(), this.safeRect());
    else this.vp = clampViewport(this.vp, this.dims());
    this.repoKey = repoKey;
    this.computeFills();
    if (!this.element.hidden) this.drawNow();
    return { buildings: message.layout.buildings.length, ms: performance.now() - receivedAt };
  }

  setTheme(theme: ThemeColours): void {
    this.theme = theme;
    this.fontFamily = codeFont();
    this.computeFills();
    this.requestDraw();
  }

  setHighContrast(on: boolean): void {
    this.highContrast = on;
    this.computeFills();
    this.requestDraw();
  }

  private get variant(): PaletteVariant {
    return variantOf(this.theme?.kind ?? 'dark');
  }

  private computeFills(): void {
    this.groups = groupFills(this.current?.layout.buildings ?? [], {
      variant: this.variant,
      highContrast: this.useHighContrast,
    });
  }

  select(path: string | null): void {
    const id = path === null ? undefined : this.current?.layout.byPath[path];
    this.selectedId = id ?? null;
    this.requestDraw();
  }

  setHover(id: number | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.requestDraw();
  }

  hitTest(x: number, y: number): Building | District | null {
    if (!this.index) return null;
    const [wx, wy] = toWorld(this.vp, this.dims(), x, y);
    return this.index.hit(wx, wy);
  }

  pointOf(path: string): { x: number; y: number } | undefined {
    const id = this.current?.layout.byPath[path];
    const building = id === undefined ? undefined : this.current?.layout.buildings[id];
    if (!building) return undefined;
    const { rect } = building;
    const [x, y] = toScreen(this.vp, this.dims(), rect.x + rect.w / 2, rect.y + rect.h / 2);
    return { x, y };
  }

  focusCamera(path: string): boolean {
    const id = this.current?.layout.byPath[path];
    const building = id === undefined ? undefined : this.current?.layout.buildings[id];
    if (!building) return false;
    this.vp = focusRect(this.dims(), building.rect, this.safeRect());
    this.requestDraw();
    return true;
  }

  navigate(action: NavAction): void {
    const d = this.dims();
    if (action.kind === 'zoom') {
      this.vp = zoomAt(
        this.vp,
        d,
        d.width / 2,
        d.height / 2,
        action.direction > 0 ? KEY_ZOOM : 1 / KEY_ZOOM,
      );
    } else {
      // In 2D, orbit keys pan too: the arrow says where the view moves.
      this.vp = panBy(this.vp, d, -action.dx * KEY_PAN_PX, -action.dy * KEY_PAN_PX);
    }
    this.requestDraw();
  }

  dragBy(dx: number, dy: number): void {
    this.vp = panBy(this.vp, this.dims(), dx, dy);
    this.requestDraw();
  }

  zoomAt(x: number, y: number, factor: number): void {
    this.vp = zoomAt(this.vp, this.dims(), x, y, factor);
    this.requestDraw();
  }

  private requestDraw(): void {
    if (this.frameRequested || this.element.hidden) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.drawNow();
    });
  }

  /** Draws everything once; culls rects outside the canvas. */
  drawNow(): void {
    const start = performance.now();
    this.paint(this.ctx, this.dims(), this.vp, {
      ratio: this.pixelRatio,
      canvasSize: {
        width: Math.max(1, this.element.clientWidth),
        height: Math.max(1, this.element.clientHeight),
      },
      theme: this.theme,
      variant: this.variant,
      highContrast: this.useHighContrast,
      groups: this.groups,
      background: true,
      names: true,
      hoverId: this.hoverId,
      selectedId: this.selectedId,
    });
    this.finishDraw(start);
  }

  /**
   * The postcard: the whole layout fitted into `width` × `height` at 1×, in the postcard's colours,
   * on the caller's backdrop. No file or folder names.
   */
  capture(ctx: CanvasRenderingContext2D, width: number, height: number, look: PostcardLook): void {
    const layout = this.current?.layout;
    if (!layout) return;
    // Keep clear of the postcard's text: the title band on top, the top-3 cards at the bottom.
    const inset = { x: 0.06 * width, y: 0.16 * height };
    const bottom = 0.32 * height;
    const dims: Dims = {
      width: width - 2 * inset.x,
      height: height - inset.y - bottom,
      worldWidth: layout.width,
      worldHeight: layout.height,
    };
    const variant = variantOf(look.theme.kind);
    this.paint(ctx, dims, fitViewport(dims), {
      ratio: 1,
      offset: inset,
      theme: look.theme,
      variant,
      highContrast: false,
      groups: groupFills(layout.buildings, { variant, highContrast: false }),
      background: false,
      names: false,
      hoverId: null,
      selectedId: null,
    });
  }

  private paint(ctx: CanvasRenderingContext2D, d: Dims, vp: Viewport, opts: PaintOptions): void {
    const { theme } = opts;
    const background: RGB = theme?.background ?? [30, 30, 30];
    const foreground: RGB = theme?.foreground ?? [212, 212, 212];
    const focus: RGB = theme?.focus ?? [0, 127, 212];
    const hc = opts.highContrast;
    const offset = opts.offset ?? { x: 0, y: 0 };
    if (opts.background) {
      const size = opts.canvasSize ?? { width: d.width, height: d.height };
      ctx.setTransform(opts.ratio, 0, 0, opts.ratio, 0, 0);
      const [top, bottom] = backgroundGradient(background, foreground);
      const gradient = ctx.createLinearGradient(0, 0, 0, size.height);
      gradient.addColorStop(0, rgbCss(top));
      gradient.addColorStop(1, rgbCss(bottom));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size.width, size.height);
    }
    ctx.setTransform(opts.ratio, 0, 0, opts.ratio, offset.x * opts.ratio, offset.y * opts.ratio);
    const layout = this.current?.layout;
    if (!layout) return;
    const s = scaleOf(vp, d);
    const ox = d.width / 2 - vp.cx * s;
    const oy = d.height / 2 - vp.cy * s;
    const visible = (x: number, y: number, w: number, h: number): boolean =>
      x + w >= 0 && y + h >= 0 && x <= d.width && y <= d.height;
    const shape = (x: number, y: number, w: number, h: number, r: number): void => {
      if (w >= ROUND_MIN_PX && h >= ROUND_MIN_PX)
        ctx.roundRect(x, y, w, h, Math.min(r, w / 4, h / 4));
      else ctx.rect(x, y, Math.max(w, 0.5), Math.max(h, 0.5));
    };

    // Districts, one path per depth: depth-tinted plates and a hairline border.
    const byDepth = new Map<number, District[]>();
    for (const district of layout.districts) {
      const list = byDepth.get(district.depth) ?? [];
      list.push(district);
      byDepth.set(district.depth, list);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgbCss(mixRgb(background, foreground, hc ? 0.6 : 0.16));
    for (const [depth, districts] of [...byDepth].sort((a, b) => a[0] - b[0])) {
      ctx.fillStyle = rgbCss(mixRgb(background, foreground, 0.05 + 0.03 * Math.min(depth, 5)));
      ctx.beginPath();
      for (const district of districts) {
        const { x, y, w, h } = district.rect;
        const sx = x * s + ox;
        const sy = y * s + oy;
        if (!visible(sx, sy, w * s, h * s)) continue;
        shape(sx, sy, w * s, h * s, 5);
      }
      ctx.fill();
      ctx.stroke();
    }

    // Buildings: one path per fill colour, 3 px corners where they are big enough to show.
    for (const group of opts.groups) {
      ctx.fillStyle = group.fill;
      ctx.beginPath();
      for (const id of group.ids) {
        const b = layout.buildings[id];
        if (!b) continue;
        const sx = b.rect.x * s + ox;
        const sy = b.rect.y * s + oy;
        const w = b.rect.w * s;
        const h = b.rect.h * s;
        if (!visible(sx, sy, w, h)) continue;
        shape(sx, sy, w, h, 3);
      }
      ctx.fill();
    }
    const hovered = opts.hoverId === null ? undefined : layout.buildings[opts.hoverId];
    if (hovered) {
      const sx = hovered.rect.x * s + ox;
      const sy = hovered.rect.y * s + oy;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.beginPath();
      shape(sx, sy, hovered.rect.w * s, hovered.rect.h * s, 3);
      ctx.fill();
    }

    ctx.textBaseline = 'middle';
    const measure = (t: string): number => ctx.measureText(t).width;

    // District header strips with the folder name, where there is room. Labels of buildings
    // just under a strip move below it.
    const stripTop = new Map<number, number>();
    if (opts.names) {
      ctx.font = `600 ${String(FONT_PX)}px ${UI_FONT}`;
      const strip = rgbCss(mixRgb(background, foreground, 0.16), 0.92);
      const ink = rgbCss(mixRgb(background, foreground, 0.85));
      for (const district of layout.districts) {
        if (district.depth === 0) continue;
        const w = district.rect.w * s;
        const h = district.rect.h * s;
        const sx = district.rect.x * s + ox;
        const sy = district.rect.y * s + oy;
        if (w < 70 || h < 80 || !visible(sx, sy, w, h)) continue;
        stripTop.set(district.id, sy);
        ctx.fillStyle = strip;
        ctx.beginPath();
        ctx.roundRect(sx, sy, w, HEADER_PX, [5, 5, 0, 0]);
        ctx.fill();
        const text = middleTruncateToWidth(`${basename(district.path)}/`, w - 12, measure);
        if (text) {
          ctx.fillStyle = ink;
          ctx.fillText(text, sx + 6, sy + HEADER_PX / 2 + 0.5);
        }
      }
    }

    // Rank pills on the top 20, file names, hover and selection.
    for (const b of layout.buildings) {
      const sx = b.rect.x * s + ox;
      const sy = b.rect.y * s + oy;
      const w = b.rect.w * s;
      const h = b.rect.h * s;
      if (!visible(sx, sy, w, h)) continue;
      const ranked = b.rank !== undefined && b.rank <= GLOW_RANKS && !isGlass(b);
      const fill = isGlass(b) ? glassColour(opts.variant) : rampColour(heatOf(b), opts);
      const ink = luminance(fill) > 0.35 ? '#10141a' : '#ffffff';
      let top = sy;
      for (let d = this.districtOf[b.id] ?? -1; d >= 0; d = this.parentOf[d] ?? -1) {
        const t = stripTop.get(d);
        if (t !== undefined && sy < t + HEADER_PX + 1) top = Math.max(top, t + HEADER_PX + 1);
      }
      if (top + 16 > sy + h) top = sy + h; // no room left under the strip: no label
      let x = sx + 4;
      const room = sy + h - top;
      if (ranked && room >= 16 && labelKind(w, h, 'rank')) {
        const rank = `#${String(b.rank)}`;
        ctx.font = `600 ${String(FONT_PX - 1)}px ${UI_FONT}`;
        const pw = measure(rank) + 8;
        const colour = rampColour(heatOf(b), opts);
        ctx.fillStyle = rgbCss(colour);
        ctx.beginPath();
        ctx.roundRect(sx + 3, top + 3, pw, 14, 7);
        ctx.fill();
        if (!hc) {
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.fillStyle = luminance(colour) > 0.35 ? '#10141a' : '#ffffff';
        ctx.fillText(rank, sx + 7, top + 10.5);
        x = sx + 3 + pw + 4;
      }
      if (opts.names && room >= 16 && labelKind(w, h, 'building')) {
        ctx.font = `${String(FONT_PX)}px ${this.fontFamily}`;
        const text = middleTruncateToWidth(basename(b.path), sx + w - 4 - x, measure);
        if (text) {
          ctx.fillStyle = ink;
          ctx.fillText(text, x, top + 10.5);
        }
      }
      if (b.id === opts.selectedId || b.id === opts.hoverId) {
        ctx.lineWidth = b.id === opts.selectedId ? 3 : 2;
        ctx.strokeStyle = rgbCss(b.id === opts.selectedId ? focus : foreground);
        ctx.beginPath();
        shape(sx, sy, w, h, 3);
        ctx.stroke();
      }
    }
  }

  private finishDraw(start: number): void {
    this.lastDrawMs = performance.now() - start;
    this.draws += 1;
  }

  stats(): Record<string, number | boolean> {
    return {
      draws: this.draws,
      lastDrawMs: Math.round(this.lastDrawMs * 100) / 100,
      buildings: this.current?.layout.buildings.length ?? 0,
      zoom: Math.round(this.vp.zoom * 100) / 100,
      viewCx: Math.round(this.vp.cx * 100) / 100,
      viewCy: Math.round(this.vp.cy * 100) / 100,
      animating: false,
    };
  }

  /** Test mode: draws the whole layout `frames` times at 1× pixel ratio and times each draw. */
  bench(frames: number): Promise<Record<string, number | boolean>> {
    const saved = this.pixelRatio;
    const savedVp = this.vp;
    this.pixelRatio = 1;
    this.vp = fitViewport(this.dims());
    this.fit();
    const times: number[] = [];
    const size = { width: this.element.width, height: this.element.height };
    for (let i = 0; i < frames; i++) {
      this.drawNow();
      times.push(this.lastDrawMs);
    }
    this.pixelRatio = saved;
    this.vp = savedVp;
    this.fit();
    const round = (n: number): number => Math.round(n * 100) / 100;
    return Promise.resolve({
      ...this.stats(),
      benchDraws: frames,
      draw1xMeanMs: round(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)),
      draw1xMaxMs: round(Math.max(0, ...times)),
      width1x: size.width,
      height1x: size.height,
    });
  }

  dispose(): void {
    this.resize.disconnect();
    this.element.remove();
  }
}
