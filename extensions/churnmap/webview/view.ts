import type { Building, District } from '../src/city/model.js';
import type { AnalysisMessage, ViewMode } from '../src/city/protocol.js';
import type { Rect } from './safeArea.js';
import type { ThemeColours } from './theme.js';

export type { AnalysisMessage };

/** Keyboard navigation, in abstract steps; each view maps them to its own camera. */
export type NavAction =
  | { kind: 'orbit'; dx: number; dy: number }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'zoom'; direction: 1 | -1 };

/**
 * What draws over the canvas (CSS px from its top-left corner): the HUD, the rail, the legend and
 * a pinned card, and the safe area left between them, where the city is fitted and labels go.
 */
export interface Overlays {
  width: number;
  height: number;
  safe: Rect;
  obstacles: Rect[];
}

/** The postcard's fixed look: theme colours and a vertical backdrop gradient (top, bottom). */
export interface PostcardLook {
  theme: ThemeColours;
  gradient: readonly [string, string];
}

export interface RenderStats {
  buildings: number;
  /** Milliseconds from receiving the data to the end of the first frame. */
  ms: number;
}

/**
 * A way of drawing the city's `Layout`: the three.js city (`ThreeView`) or the Canvas 2D treemap
 * (`TreemapView`). Hover, click, selection and keyboard live once, in `interaction.ts`, and work
 * against this interface, so both views behave the same.
 */
export interface CityView {
  readonly mode: ViewMode;
  /** The view's canvas: focusable, and the target of every pointer event. */
  readonly element: HTMLCanvasElement;
  /** Shows the view inside `root` (only one view is mounted at a time). */
  mount(root: HTMLElement): void;
  unmount(): void;
  /** The data this view last drew, so a switch redraws only when it is stale. */
  readonly data: AnalysisMessage | undefined;
  setData(message: AnalysisMessage, receivedAt?: number): RenderStats;
  setTheme(theme: ThemeColours): void;
  setHighContrast(on: boolean): void;
  /** Highlights the selected building (null clears). */
  select(path: string | null): void;
  /** Highlights the building under the pointer (null clears). */
  setHover(id: number | null): void;
  /** The building (else deepest district) at canvas point (x, y), CSS px. */
  hitTest(x: number, y: number): Building | District | null;
  /**
   * Where a building's centre (3D: the middle of its roof) is on the canvas now, CSS px; undefined
   * when it is not drawn or off screen. Tests click there.
   */
  pointOf(path: string): { x: number; y: number } | undefined;
  /** Brings a building into view (3D: 600 ms fly-to; 2D: zoom to it). False if not drawn. */
  focusCamera(path: string): boolean;
  navigate(action: NavAction): void;
  /**
   * The overlays moved (resize, collapse, close, a panel dragged): remembered for the next fit
   * and for label placement. Never re-fits by itself (the user may have panned).
   */
  setOverlays(overlays: Overlays): void;
  /**
   * Fits the whole city into the safe area (3D: camera distance and target; 2D: scale and
   * offset): first render, repository switch, F, Home, the HUD's ⤢ Fit.
   */
  fitToView(animate: boolean): void;
  /** Test mode: the city's bounding box on screen now, CSS px (undefined with no data). */
  projectedBounds(): Rect | undefined;
  /** Views without their own drag handling (the 2D treemap) pan here. */
  dragBy?(dx: number, dy: number): void;
  /** Views without their own wheel handling zoom here, about (x, y), by `factor`. */
  zoomAt?(x: number, y: number, factor: number): void;
  /** Draws the whole city into `ctx` (width × height CSS px) for the postcard; no text. */
  capture(ctx: CanvasRenderingContext2D, width: number, height: number, look: PostcardLook): void;
  /** Test-mode counters. */
  stats(): Record<string, number | boolean>;
  /** Test mode: a short benchmark, returned as counters. */
  bench(frames: number): Promise<Record<string, number | boolean>>;
  dispose(): void;
}
