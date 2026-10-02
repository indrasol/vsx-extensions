import type { IgnoredFile } from '../src/analysis/model.js';
import type { Building, District } from '../src/city/model.js';
import type { PaletteOptions } from '../src/city/palette.js';
import type { AnalysisMessage, TopEntry, WebviewToHost } from '../src/city/protocol.js';
import {
  buildingCard,
  Card,
  type CardContent,
  districtCard,
  type DistrictTotals,
  districtTotals,
  placeCard,
  tipText,
} from './card.js';
import { el } from './dom.js';
import { PINCH_BOOST, spaceHeld, wheelGesture } from './gesture.js';
import type { TopList } from './list.js';
import { throttle } from '../src/shared/throttle.js';
import type { CityView, NavAction } from './view.js';

/** Movement (CSS px) under which a pointer press and release count as a click, not a drag. */
export const CLICK_SLOP = 4;
/** Hover messages to the host: at most 10 per second. */
export const HOVER_POST_MS = 100;
/**
 * A second click this soon after the first belongs to a double-click: it opens the building the
 * first click selected (the camera is already flying, so the pointer may be over another one).
 */
export const DOUBLE_CLICK_MS = 500;

export function isDistrict(hit: Building | District): hit is District {
  return 'children' in hit;
}

export interface InteractionDeps {
  root: HTMLElement;
  status: HTMLElement;
  list: TopList;
  post(message: WebviewToHost): void;
  view(): CityView | undefined;
  /** T: show or hide the ranked list. */
  onToggleList(): void;
  /** 2: switch between the 3D city and the 2D treemap. */
  onToggleView(): void;
  /** The pinned card's collapse control, its pill, or C. */
  onToggleCardCollapse(): void;
  /** The pinned card's "How is this scored?" (the selected file). */
  onExplain(path: string | null): void;
  /** The pinned card was shown or hidden (the dock lays out again). */
  onPinnedChange(): void;
}

/** Wheel zoom per pixel of delta (a mouse-wheel notch of 100 px zooms by about 20 %). */
export const WHEEL_ZOOM_PER_PX = 0.002;

/** The zoom factor for a wheel event (lines and pages count as pixels; a pinch is boosted). */
export function wheelZoomFactor(deltaY: number, deltaMode: number, pinch: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  return Math.exp(-px * WHEEL_ZOOM_PER_PX * (pinch ? PINCH_BOOST : 1));
}

/** Keyboard steps: arrows pan, Alt + arrows orbit, +/- zoom (F and Home fit, elsewhere). */
export function navFor(key: string, alt: boolean): NavAction | undefined {
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const arrow = arrows[key];
  if (arrow) return { kind: alt ? 'orbit' : 'pan', dx: arrow[0], dy: arrow[1] };
  if (key === '+' || key === '=') return { kind: 'zoom', direction: 1 };
  if (key === '-' || key === '_') return { kind: 'zoom', direction: -1 };
  return undefined;
}

/**
 * Hover card, selection and keyboard for whichever view is mounted. All pointer handling is
 * registered here, once, on the page root. A click selects a building: the camera flies to it,
 * everything else dims, and its card is pinned with **Open file** and **✦ AI prompt**. A
 * double-click, or Enter on the selection, opens the file. While a card is pinned, hovering
 * anything else shows only a one-line tooltip (name and rank), never a second full card.
 */
export class Interaction {
  /** Follows the pointer; never has buttons. */
  private readonly card: Card;
  /** The selected building's card, docked, with Open file and AI prompt. */
  private readonly pinned: Card;
  /** The one-line tooltip while a card is pinned. */
  private readonly tip = el('div', 'hover-tip');
  private data: AnalysisMessage | undefined;
  private top = new Map<string, TopEntry>();
  private ignored = new Map<string, IgnoredFile>();
  private totals: DistrictTotals[] = [];
  private pointer: { x: number; y: number } | undefined;
  private pressed: { x: number; y: number; lastX: number; lastY: number } | undefined;
  /** Space is down: released without a drag it flies to the building under the pointer. */
  private spaceTap: { dragged: boolean } | undefined;
  private hoverFrame: number | undefined;
  private hoveredPath: string | null = null;
  private selected: string | null = null;
  /** The building the last single click selected, and when. */
  private lastClick: { path: string; at: number } | undefined;
  private readonly postHover = throttle((path: string | null) => {
    this.deps.post({ type: 'hover', path });
  }, HOVER_POST_MS);

  constructor(private readonly deps: InteractionDeps) {
    this.card = new Card(deps.root);
    this.pinned = new Card(deps.root, {
      onAsk: (path) => {
        this.ask(path);
      },
      onOpen: (path) => {
        this.open(path);
      },
      onClose: () => {
        this.clear();
        this.deps.view()?.element.focus();
      },
      onToggleCollapse: () => {
        this.deps.onToggleCardCollapse();
      },
      onExplain: () => {
        this.deps.onExplain(this.selected);
      },
    });
    this.tip.hidden = true;
    this.tip.setAttribute('aria-hidden', 'true');
    deps.root.append(this.tip);
    const { root } = deps;
    root.addEventListener('pointermove', (e) => {
      this.onPointerMove(e);
    });
    spaceHeld(); // start tracking Space for Space + drag
    root.addEventListener('pointerdown', (e) => {
      // Left-drag (a click when it does not move) and middle-drag; the 2D view pans with both.
      if ((e.button === 0 || e.button === 1) && this.onCanvas(e)) {
        const p = this.local(e);
        this.pressed = { x: p.x, y: p.y, lastX: p.x, lastY: p.y };
        if (e.button === 1) e.preventDefault(); // no autoscroll
        const view = this.deps.view();
        if (view?.dragBy) {
          try {
            view.element.setPointerCapture(e.pointerId);
          } catch {
            // A synthetic pointer (tests) cannot be captured; the canvas still gets its events.
          }
        }
      }
    });
    root.addEventListener('pointerup', (e) => {
      this.onPointerUp(e);
    });
    root.addEventListener('pointerleave', () => {
      this.pointer = undefined;
      this.pressed = undefined;
      this.hideTip();
      this.setHovered(null);
    });
    root.addEventListener(
      'wheel',
      (e) => {
        const view = this.deps.view();
        if (!view?.zoomAt || !this.onCanvas(e)) return;
        e.preventDefault();
        // A two-finger trackpad drag pans; a pinch or a wheel zooms towards the pointer.
        if (wheelGesture(e) === 'pan' && view.dragBy) {
          view.dragBy(-e.deltaX, -e.deltaY);
          return;
        }
        const p = this.local(e);
        view.zoomAt(p.x, p.y, wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey));
      },
      { passive: false },
    );
    root.addEventListener('dblclick', (e) => {
      this.onDoubleClick(e);
    });
    root.addEventListener('keydown', (e) => {
      this.onKey(e);
    });
    root.addEventListener('keyup', (e) => {
      this.onKeyUp(e);
    });
  }

  /** The pinned card (the dock positions it and drags it by `handle`). */
  get pinnedCard(): Card {
    return this.pinned;
  }

  /** The selected file, if any (the HUD's AI prompt acts on it). */
  get selection(): string | null {
    return this.selected;
  }

  /** Test-mode stats: whether a card is pinned, and how many buttons it has. */
  get pinnedState(): { pinned: boolean; buttons: number } {
    return { pinned: this.pinned.isDocked, buttons: this.pinned.buttons };
  }

  /** The card for a building, from everything the analysis says about it. */
  private cardFor(building: Building): CardContent {
    return buildingCard(building, {
      top: this.top.get(building.path),
      ignored: this.ignored.get(building.path),
      notes: this.data?.notes[building.path],
      window: this.data?.window ?? 90,
    });
  }

  /** Theme variant and high contrast change the badge and meter colours on the next card. */
  setPalette(palette: PaletteOptions): void {
    this.card.palette = palette;
    this.pinned.palette = palette;
  }

  setData(message: AnalysisMessage): void {
    this.data = message;
    this.top = new Map(message.top.map((t) => [t.path, t]));
    this.ignored = new Map(message.ignored.map((e) => [e.path, e]));
    this.totals = districtTotals(message.layout);
    this.card.hide();
    this.hideTip();
    this.pinned.hide();
    this.deps.onPinnedChange();
    this.selected = null;
    this.hoveredPath = null;
    const first = message.top[0];
    this.announce(
      `Rendered ${String(message.layout.buildings.length)} buildings` +
        (first
          ? `, top hotspot #${String(first.rank)} ${first.path}, score ${first.score.toFixed(1)}.`
          : '.'),
    );
  }

  announce(text: string): void {
    this.deps.status.textContent = text;
  }

  /**
   * Selects a building (a click, the rail, the host's `select`, list Space): fly there, dim the
   * rest, pin its card. Folded blocks have no single file: no-op.
   */
  select(path: string): boolean {
    const data = this.data;
    const view = this.deps.view();
    const id = data?.layout.byPath[path];
    const building = id === undefined ? undefined : data?.layout.buildings[id];
    if (!view || !building || building.folded || building.path !== path) return false;
    this.selected = path;
    view.focusCamera(path);
    view.select(path);
    const top = this.top.get(path);
    this.card.hide();
    this.hideTip();
    this.pinned.show(this.cardFor(building), 'docked');
    this.deps.onPinnedChange();
    this.announce(
      `Selected ${building.rank === undefined ? '' : `#${String(building.rank)} `}${path}, score ${building.score.toFixed(1)}` +
        (top && top.reasons.length > 0 ? `: ${top.reasons.join('; ')}.` : '.'),
    );
    this.setHovered(path);
    return true;
  }

  /** Escape: clear the selection and the card. */
  clear(): void {
    this.selected = null;
    this.card.hide();
    this.hideTip();
    this.pinned.hide();
    this.deps.onPinnedChange();
    this.deps.view()?.select(null);
    this.deps.view()?.setHover(null);
    this.setHovered(null);
  }

  /** After a view switch: the selection (and its docked card) carries over; the hover does not. */
  viewChanged(): void {
    const view = this.deps.view();
    this.pointer = undefined;
    this.pressed = undefined;
    view?.setHover(null);
    this.card.hide();
    this.hideTip();
    if (this.selected) {
      view?.select(this.selected);
      view?.focusCamera(this.selected);
    }
  }

  /** Opens a file through the host (which validates the path again). */
  open(path: string): void {
    const id = this.data?.layout.byPath[path];
    const building = id === undefined ? undefined : this.data?.layout.buildings[id];
    if (!building || building.folded) return;
    this.deps.post({ type: 'openFile', path: building.path });
  }

  /**
   * The HUD's AI prompt: the selected building when it can be asked about, else the #1 hotspot.
   * False when there is nothing to ask about.
   */
  askSelectedOrTop(): boolean {
    const selected = this.selected;
    const id = selected === null ? undefined : this.data?.layout.byPath[selected];
    const building = id === undefined ? undefined : this.data?.layout.buildings[id];
    const path =
      building && !building.folded && building.why === undefined
        ? building.path
        : this.data?.top[0]?.path;
    if (path === undefined) return false;
    this.ask(path);
    return true;
  }

  /** Asks the host for an AI prompt about a scored file (the host validates the path again). */
  ask(path: string): void {
    const id = this.data?.layout.byPath[path];
    const building = id === undefined ? undefined : this.data?.layout.buildings[id];
    if (!building || building.folded || building.why !== undefined) return;
    this.deps.post({ type: 'createPrompt', path: building.path });
  }

  private onCanvas(e: Event): boolean {
    return e.target === this.deps.view()?.element;
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const rect = this.deps.view()?.element.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.onCanvas(e)) return;
    const p = this.local(e);
    this.pointer = p;
    const view = this.deps.view();
    if (this.pressed) {
      view?.dragBy?.(p.x - this.pressed.lastX, p.y - this.pressed.lastY);
      this.pressed.lastX = p.x;
      this.pressed.lastY = p.y;
      if (this.spaceTap && Math.hypot(p.x - this.pressed.x, p.y - this.pressed.y) >= CLICK_SLOP) {
        this.spaceTap.dragged = true;
      }
    }
    // Hit-test at most once per frame, with the latest position.
    this.hoverFrame ??= requestAnimationFrame(() => {
      this.hoverFrame = undefined;
      this.updateHover();
    });
  }

  private updateHover(): void {
    const view = this.deps.view();
    const p = this.pointer;
    if (!view || !p || !this.data) return;
    const hit = view.hitTest(p.x, p.y);
    if (!hit) {
      this.setHovered(null);
      this.card.hide();
      this.hideTip();
      view.setHover(null);
      return;
    }
    const pinned = this.pinned.isDocked;
    if (isDistrict(hit)) {
      view.setHover(null);
      if (pinned) this.showTip(tipText(hit), p);
      else this.card.show(districtCard(hit, this.totals[hit.id]), p);
      this.setHovered(hit.path === '' ? null : hit.path);
      return;
    }
    view.setHover(hit.id);
    if (hit.path === this.selected) {
      // The selected building's card is already pinned; no second copy by the pointer.
      this.card.hide();
      this.hideTip();
    } else if (pinned) {
      this.showTip(tipText(hit), p);
    } else {
      this.card.show(this.cardFor(hit), p);
    }
    this.setHovered(hit.path);
  }

  /** The one-line tooltip by the pointer (a card is pinned); the full card stays hidden. */
  private showTip(text: string, at: { x: number; y: number }): void {
    this.card.hide();
    this.tip.textContent = text;
    this.tip.hidden = false;
    const bounds = this.deps.root.getBoundingClientRect();
    const pos = placeCard(
      at.x,
      at.y,
      this.tip.offsetWidth,
      this.tip.offsetHeight,
      bounds.width,
      bounds.height,
      12,
    );
    this.tip.style.left = `${String(Math.round(pos.left))}px`;
    this.tip.style.top = `${String(Math.round(pos.top))}px`;
  }

  private hideTip(): void {
    this.tip.hidden = true;
  }

  /** Test-mode stats: what hovering shows now. */
  get hoverState(): { card: boolean; tip: boolean; tipText: string } {
    return { card: this.card.visible, tip: !this.tip.hidden, tipText: this.tip.textContent };
  }

  private setHovered(path: string | null): void {
    if (path === this.hoveredPath) return;
    this.hoveredPath = path;
    this.postHover(path);
  }

  private onPointerUp(e: PointerEvent): void {
    const pressed = this.pressed;
    this.pressed = undefined;
    if (!pressed || e.button !== 0 || !this.onCanvas(e)) return;
    const p = this.local(e);
    if (Math.hypot(p.x - pressed.x, p.y - pressed.y) >= CLICK_SLOP) return; // a drag
    const hit = this.deps.view()?.hitTest(p.x, p.y);
    if (!hit) {
      // A click on empty ground lets go of the selection.
      if (this.selected) this.clear();
      return;
    }
    if (isDistrict(hit)) return;
    if (hit.folded) {
      // A folded block has no single file: say so on the card (a tooltip while one is pinned).
      if (this.pinned.isDocked) this.showTip(tipText(hit), p);
      else this.card.show(this.cardFor(hit), p);
      return;
    }
    const now = performance.now();
    if (this.lastClick && now - this.lastClick.at < DOUBLE_CLICK_MS) return; // its second click
    this.lastClick = { path: hit.path, at: now };
    if (hit.path !== this.selected) this.select(hit.path);
  }

  /** A double-click on a building opens its file (the first click has already selected it). */
  private onDoubleClick(e: MouseEvent): void {
    if (e.button !== 0 || !this.onCanvas(e)) return;
    const recent = this.lastClick;
    this.lastClick = undefined;
    if (recent && performance.now() - recent.at < DOUBLE_CLICK_MS * 2) {
      this.open(recent.path);
      return;
    }
    const p = this.local(e);
    const hit = this.deps.view()?.hitTest(p.x, p.y);
    if (!hit || isDistrict(hit) || hit.folded) return;
    this.open(hit.path);
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key !== ' ') return;
    const tap = this.spaceTap;
    this.spaceTap = undefined;
    if (!tap || tap.dragged || this.pressed) return;
    if (this.hoveredPath && this.hoveredPath !== this.selected) this.select(this.hoveredPath);
  }

  private onKey(e: KeyboardEvent): void {
    const view = this.deps.view();
    if (
      (e.key === 't' || e.key === 'T' || e.key === '2') &&
      !(e.ctrlKey || e.metaKey || e.altKey)
    ) {
      if (e.key === '2') this.deps.onToggleView();
      else this.deps.onToggleList();
      e.preventDefault();
      return;
    }
    if (!view || e.target !== view.element) return;
    const nav = navFor(e.key, e.altKey);
    if (nav) {
      view.navigate(nav);
    } else if (
      e.key === 'Home' ||
      ((e.key === 'f' || e.key === 'F') && !(e.ctrlKey || e.metaKey || e.altKey))
    ) {
      view.fitToView(true);
    } else if (e.key === 'Escape') {
      this.clear();
    } else if (e.key === 'Enter' && this.selected) {
      this.open(this.selected);
    } else if (
      (e.key === 'c' || e.key === 'C') &&
      this.selected &&
      !(e.ctrlKey || e.metaKey || e.altKey)
    ) {
      // C collapses the pinned card to a pill, or expands it again.
      this.deps.onToggleCardCollapse();
    } else if ((e.key === 'a' || e.key === 'A') && !(e.ctrlKey || e.metaKey || e.altKey)) {
      // A creates an AI prompt about the selected building, else the one under the pointer.
      const path = this.selected ?? this.hoveredPath;
      if (path === null) return;
      this.ask(path);
    } else if (e.key === ' ') {
      // Space + drag pans; a tap (released without a drag) flies to the building under the
      // pointer (the card says so), on key up.
      if (!e.repeat) this.spaceTap = { dragged: false };
    } else {
      return;
    }
    e.preventDefault();
  }
}
