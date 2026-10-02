/**
 * Where the pinned card, the insights rail and the legend sit. Each docks in a corner of the city;
 * panels in the same corner stack (never on top of each other), top corners start below the HUD
 * (however tall it wraps), and a panel can never leave the canvas. A panel moves by dragging its
 * header (it snaps to the nearest corner on release) or, with the header focused, by the arrow
 * keys (Enter moves it to the next corner clockwise). The host remembers every panel's corner,
 * collapsed and closed state per workspace.
 */
import {
  type Corner,
  CORNERS,
  DEFAULT_PANELS,
  PANEL_IDS,
  type PanelId,
  type PanelPrefs,
  type PanelState,
} from '../src/city/protocol.js';

/** Space between a panel and the canvas edge, the HUD or another panel. */
export const DOCK_MARGIN = 10;
export const DOCK_GAP = 8;
/** Stacking order inside a corner, nearest the edge first. */
export const STACK_ORDER: readonly PanelId[] = ['legend', 'rail', 'card'];

export interface PanelBox {
  id: PanelId;
  corner: Corner;
  w: number;
  h: number;
}

export interface Placement {
  left: number;
  top: number;
  /** The most height the panel may take at its place (it scrolls beyond). */
  maxHeight: number;
  /** No usable room left (the canvas is too small for every panel): the panel is not drawn. */
  squeezed: boolean;
}

/** Below this much room a panel is not drawn at all rather than shown as a sliver. */
export const MIN_PANEL_ROOM = 40;

/**
 * Pure: the position of each visible panel in a `width` × `height` canvas whose HUD ends at
 * `hudBottom`. Bottom-corner panels are placed first, stacking upwards; then top-corner panels
 * stack downwards from the HUD. A panel moves past (and never onto) every panel already placed
 * whose column overlaps its own, so on a narrow canvas the left and right stacks share one column,
 * and a panel that does not fit gets a smaller `maxHeight` (it scrolls) instead of overlapping.
 * Panels in one corner stack in `STACK_ORDER` away from the corner.
 */
export function stackPanels(
  width: number,
  height: number,
  hudBottom: number,
  panels: readonly PanelBox[],
): Partial<Record<PanelId, Placement>> {
  const out: Partial<Record<PanelId, Placement>> = {};
  const topLimit = hudBottom + DOCK_GAP;
  const bottomLimit = height - DOCK_MARGIN;
  const placed: { x0: number; x1: number; y0: number; y1: number; top: boolean }[] = [];
  const ordered = [...panels].sort(
    (a, b) =>
      Number(a.corner.startsWith('t')) - Number(b.corner.startsWith('t')) ||
      STACK_ORDER.indexOf(a.id) - STACK_ORDER.indexOf(b.id),
  );
  for (const p of ordered) {
    const right = p.corner.endsWith('r');
    const left = right ? Math.max(DOCK_MARGIN, width - DOCK_MARGIN - p.w) : DOCK_MARGIN;
    const x0 = left;
    const x1 = left + p.w;
    const beside = placed.filter((q) => q.x0 < x1 && x0 < q.x1);
    let y0: number;
    let y1: number;
    if (p.corner.startsWith('b')) {
      // Upwards from the bottom, above anything already in this column.
      const floor = Math.min(bottomLimit, ...beside.map((q) => q.y0 - DOCK_GAP));
      const room = Math.max(0, floor - topLimit);
      const h = Math.min(p.h, room);
      y1 = floor;
      y0 = floor - h;
      out[p.id] = {
        left,
        top: Math.max(topLimit, y0),
        maxHeight: room,
        squeezed: room < Math.min(MIN_PANEL_ROOM, p.h),
      };
    } else {
      // Downwards from the HUD, below the top panels in this column, above the bottom ones.
      const ceiling = Math.max(
        topLimit,
        ...beside.filter((q) => q.top).map((q) => q.y1 + DOCK_GAP),
      );
      const floor = Math.min(
        bottomLimit,
        ...beside.filter((q) => !q.top).map((q) => q.y0 - DOCK_GAP),
      );
      const room = Math.max(0, floor - ceiling);
      const h = Math.min(p.h, room);
      y0 = ceiling;
      y1 = ceiling + h;
      out[p.id] = {
        left,
        top: y0,
        maxHeight: room,
        squeezed: room < Math.min(MIN_PANEL_ROOM, p.h),
      };
    }
    // A squeezed panel is not drawn, so it takes no room from the others.
    if (!(out[p.id]?.squeezed ?? false))
      placed.push({ x0, x1, y0, y1, top: p.corner.startsWith('t') });
  }
  return out;
}

/** The corner nearest a point: the half of the canvas it is in, both ways. */
export function nearestCorner(x: number, y: number, width: number, height: number): Corner {
  return `${y < height / 2 ? 't' : 'b'}${x < width / 2 ? 'l' : 'r'}` as Corner;
}

/**
 * A corner after a key: the arrows move to that side (Left → left, Up → top, …), Enter to the
 * next corner clockwise. Undefined for any other key.
 */
export function cornerAfterKey(corner: Corner, key: string): Corner | undefined {
  const v = corner.charAt(0);
  const h = corner.charAt(1);
  switch (key) {
    case 'ArrowLeft':
      return `${v}l` as Corner;
    case 'ArrowRight':
      return `${v}r` as Corner;
    case 'ArrowUp':
      return `t${h}` as Corner;
    case 'ArrowDown':
      return `b${h}` as Corner;
    case 'Enter':
      return CORNERS[(CORNERS.indexOf(corner) + 1) % CORNERS.length];
    default:
      return undefined;
  }
}

export const CORNER_NAMES: Readonly<Record<Corner, string>> = {
  tl: 'top left',
  tr: 'top right',
  bl: 'bottom left',
  br: 'bottom right',
};

interface Registered {
  el: HTMLElement;
  handle: HTMLElement;
  /** Whether it takes part in the layout now (the card only while something is pinned). */
  shown(): boolean;
}

/** Positions the panels, and moves them by drag and keyboard. */
export class Dock {
  private prefs: PanelPrefs = structuredClone(DEFAULT_PANELS);
  private readonly panels = new Map<PanelId, Registered>();
  private frame: number | undefined;
  private dragging: PanelId | undefined;
  private readonly observer: ResizeObserver;

  constructor(
    private readonly root: HTMLElement,
    private readonly hud: HTMLElement,
    private readonly onChange: (prefs: PanelPrefs) => void,
    private readonly announce: (text: string) => void,
    /** After every layout: the overlays moved, so the safe area is measured again. */
    private readonly onLayout: () => void = () => undefined,
  ) {
    const observer = new ResizeObserver(() => {
      this.schedule();
    });
    observer.observe(root);
    observer.observe(hud);
    this.observer = observer;
  }

  register(id: PanelId, el: HTMLElement, handle: HTMLElement, shown: () => boolean): void {
    this.panels.set(id, { el, handle, shown });
    this.observer.observe(el);
    el.classList.add('docked-panel');
    handle.classList.add('dock-handle');
    if (!handle.hasAttribute('tabindex')) handle.tabIndex = 0;
    handle.setAttribute('aria-roledescription', 'movable panel header');
    this.describe(id);
    handle.addEventListener('pointerdown', (e) => {
      this.startDrag(id, e);
    });
    handle.addEventListener('keydown', (e) => {
      if (e.target !== handle || e.ctrlKey || e.metaKey || e.altKey) return;
      const next = cornerAfterKey(this.prefs[id].corner, e.key);
      if (!next) return;
      e.preventDefault();
      e.stopPropagation();
      this.move(id, next);
    });
  }

  get state(): PanelPrefs {
    return this.prefs;
  }

  panel(id: PanelId): PanelState {
    return this.prefs[id];
  }

  /** Applies remembered prefs (from the host); nothing is posted back. */
  setPrefs(prefs: PanelPrefs): void {
    this.prefs = structuredClone(prefs);
    for (const id of PANEL_IDS) this.describe(id);
    this.layout();
  }

  /** Changes one panel's state, lays out, and tells the host. */
  update(id: PanelId, change: Partial<PanelState>): void {
    this.prefs = { ...this.prefs, [id]: { ...this.prefs[id], ...change } };
    this.describe(id);
    this.layout();
    this.onChange(this.prefs);
  }

  move(id: PanelId, corner: Corner): void {
    if (this.prefs[id].corner !== corner) this.update(id, { corner });
    else this.layout();
    this.announce(`Moved to the ${CORNER_NAMES[corner]} corner.`);
  }

  private describe(id: PanelId): void {
    const panel = this.panels.get(id);
    if (!panel) return;
    panel.el.dataset.corner = this.prefs[id].corner;
    panel.handle.title = `Drag to move (arrow keys when focused) · now ${CORNER_NAMES[this.prefs[id].corner]}`;
  }

  /** Lays out on the next frame (resize observers, content changes). */
  schedule(): void {
    this.frame ??= requestAnimationFrame(() => {
      this.frame = undefined;
      this.layout();
    });
  }

  /** Positions every shown panel now. */
  layout(): void {
    const bounds = this.root.getBoundingClientRect();
    const hud = this.hud.getBoundingClientRect();
    const hudBottom = hud.height > 0 ? hud.bottom - bounds.top : 0;
    // The ranked list (T) and anything else under the HUD start here too.
    this.root.style.setProperty('--cm-hud-bottom', `${String(Math.round(hudBottom))}px`);
    const boxes: PanelBox[] = [];
    for (const [id, panel] of this.panels) {
      if (!panel.shown() || panel.el.hidden || id === this.dragging) continue;
      // Measure at natural height: the last max-height would cap it.
      panel.el.style.maxHeight = '';
      boxes.push({
        id,
        corner: this.prefs[id].corner,
        w: panel.el.offsetWidth,
        h: panel.el.offsetHeight,
      });
    }
    const placed = stackPanels(bounds.width, bounds.height, hudBottom, boxes);
    for (const [id, place] of Object.entries(placed) as [PanelId, Placement][]) {
      const el = this.panels.get(id)?.el;
      if (!el) continue;
      el.style.left = `${String(Math.round(place.left))}px`;
      el.style.top = `${String(Math.round(place.top))}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.maxHeight = `${String(Math.floor(place.maxHeight))}px`;
      // visibility, not display: the panel keeps its size, so measuring it again is stable.
      el.classList.toggle('squeezed', place.squeezed);
    }
    this.onLayout();
  }

  /** Whether a panel is drawn now (shown, and not squeezed out by a small canvas). */
  isDrawn(id: PanelId): boolean {
    const panel = this.panels.get(id);
    return (
      panel !== undefined &&
      panel.shown() &&
      !panel.el.hidden &&
      !panel.el.classList.contains('squeezed')
    );
  }

  /** Drag by the header: the panel follows the pointer, then snaps to the nearest corner. */
  private startDrag(id: PanelId, e: PointerEvent): void {
    const panel = this.panels.get(id);
    if (!panel || e.button !== 0) return;
    // Buttons in the header (close, collapse) stay buttons.
    if (e.target instanceof Element && e.target.closest('button') !== null) return;
    e.preventDefault();
    e.stopPropagation();
    const { el, handle } = panel;
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    this.dragging = id;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer (tests) cannot be captured; the handle still gets its events.
    }
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      el.classList.add('dragging');
      el.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`;
    };
    const onUp = (ev: PointerEvent): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      this.dragging = undefined;
      el.classList.remove('dragging');
      if (!moved) {
        el.style.transform = '';
        return;
      }
      // The corner nearest where the pointer let go (a tall panel's centre may be elsewhere).
      const bounds = this.root.getBoundingClientRect();
      el.style.transform = '';
      const corner = nearestCorner(
        ev.clientX - bounds.left,
        ev.clientY - bounds.top,
        bounds.width,
        bounds.height,
      );
      this.move(id, corner);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  /** Test mode: drags a panel's header to a point inside `corner` with real pointer events. */
  testDrag(id: PanelId, corner: Corner): void {
    const panel = this.panels.get(id);
    if (!panel) return;
    const bounds = this.root.getBoundingClientRect();
    const from = panel.handle.getBoundingClientRect();
    const x0 = from.left + Math.min(12, from.width / 2);
    const y0 = from.top + from.height / 2;
    const x1 = bounds.left + (corner[1] === 'l' ? 0.15 : 0.85) * bounds.width;
    const y1 = bounds.top + (corner[0] === 't' ? 0.2 : 0.85) * bounds.height;
    const init = (x: number, y: number): PointerEventInit => ({
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 7,
      isPrimary: true,
    });
    panel.handle.dispatchEvent(new PointerEvent('pointerdown', init(x0, y0)));
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      panel.handle.dispatchEvent(
        new PointerEvent('pointermove', init(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)),
      );
    }
    panel.handle.dispatchEvent(new PointerEvent('pointerup', init(x1, y1)));
  }
}
