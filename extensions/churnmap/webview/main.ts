import { backgroundGradient, rgbCss, variantOf } from '../src/city/palette.js';
import {
  type AnalysisMessage,
  type AnyHostToWebview,
  CORNERS,
  isIgnoredList,
  type PanelId,
  type PanelPrefs,
  type TestBox,
  POSTCARD_HEIGHT,
  POSTCARD_WIDTH,
  type PostcardMessage,
  type ThemeKind,
  toShortString,
  type ViewMode,
} from '../src/city/protocol.js';
import { COACH_STEPS, CoachMark, ControlsHelp } from './coach.js';
import { Dock } from './dock.js';
import { forceReducedMotion, reducedMotionQuery, replayClass } from './dom.js';
import { Explainer } from './explainer.js';
import { Hud } from './hud.js';
import { Interaction } from './interaction.js';
import { Legend } from './legend.js';
import { TopList } from './list.js';
import { DURATION } from './motion.js';
import { renderPostcard } from './postcard.js';
import { InsightsRail } from './rail.js';
import { overlaps, type Rect, safeArea } from './safeArea.js';
import { ThreeView } from './scene.js';
import { composeSnapshot } from './snapshot.js';
import { readTheme, type ThemeColours } from './theme.js';
import { TreemapView } from './treemap2d.js';
import type { CityView } from './view.js';
import { post, TEST_MODE } from './vscodeApi.js';

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`missing #${id}`);
  return node;
}

function reportError(message: string): void {
  post({ type: 'error', message: toShortString(message) });
}

function postStats(stats: Record<string, number | boolean>): void {
  post({ type: 'test:stats', stats: { ...stats, cspViolations } });
}

// Any Content Security Policy violation is a bug (ADR-0011): report it and count it for tests.
let cspViolations = 0;
document.addEventListener('securitypolicyviolation', (event) => {
  cspViolations += 1;
  reportError(`CSP violation: ${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`);
});

// Error boundary: anything uncaught is reported to the host's log (short text only).
window.addEventListener('error', (event) => {
  reportError(event.message || 'Unknown error');
});
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason;
  reportError(reason instanceof Error ? reason.message : 'Unhandled promise rejection');
});

const app = byId('app', HTMLElement);
const canvas = byId('city', HTMLCanvasElement);
const status = byId('status', HTMLElement);
const reducedMotion = reducedMotionQuery();

/** High contrast: the theme's kind, the host's `highContrast` message or the ⋯ menu toggle. */
const contrast = { theme: false, host: false, local: false };
let themeKind: ThemeKind = 'dark';

/** Both views are kept; `view` is the one in charge. The 3D one is missing without WebGL. */
const views: { '3d': ThreeView | undefined; '2d': TreemapView } = {
  '3d': undefined,
  '2d': new TreemapView(),
};
let mode: ViewMode = '3d';
let view: CityView | undefined;
let analysis: AnalysisMessage | undefined;
let theme: ThemeColours | undefined;
let lastSwitchMs = 0;
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

const highContrastOn = (): boolean => contrast.theme || contrast.host || contrast.local;

function applyContrast(): void {
  const on = highContrastOn();
  document.body.classList.toggle('high-contrast', on);
  hud.setHighContrast(on);
  legend.setPalette({ variant: variantOf(themeKind), highContrast: on });
  const palette = { variant: variantOf(themeKind), highContrast: on };
  rail.palette = palette;
  rail.render();
  interaction.setPalette(palette);
  for (const v of [views['3d'], views['2d']]) v?.setHighContrast(contrast.host || contrast.local);
}

/** The page backdrop: a soft vertical gradient from the editor background (CSSOM variables). */
function applyBackdrop(colours: ThemeColours): void {
  const [top, bottom] = backgroundGradient(colours.background, colours.foreground);
  document.documentElement.style.setProperty('--cm-bg-top', rgbCss(top));
  document.documentElement.style.setProperty('--cm-bg-bottom', rgbCss(bottom));
}

/**
 * Switches views locally, from the same `Layout` (nothing is requested from the host), keeping the
 * selection and the window, and tells the host at once so it can remember the mode. The 3D city
 * morphs: to 2D it flattens under a top-down camera while the treemap fades in; back to 3D the
 * treemap fades out while the buildings rise again.
 */
function switchView(next: ViewMode): void {
  const three = views['3d'];
  const flat = views['2d'];
  if (next === mode || (next === '3d' && !three)) return;
  const start = performance.now();
  mode = next;
  if (fadeTimer !== undefined) clearTimeout(fadeTimer);
  if (next === '2d') {
    if (theme) flat.setTheme(theme);
    if (analysis && flat.data !== analysis) flat.setData(analysis);
    flat.element.classList.remove('fade-out');
    flat.mount(app);
    replayClass(flat.element, 'fade-in');
    view = flat;
    if (three && !three.element.hidden) {
      three.morphTo2D(() => {
        if (mode === '2d') three.unmount();
      });
    }
  } else if (three) {
    three.mount();
    if (theme) three.setTheme(theme);
    if (analysis && three.data !== analysis) three.setData(analysis);
    three.morphFrom2D();
    view = three;
    flat.element.classList.remove('fade-in');
    flat.element.classList.add('fade-out');
    fadeTimer = setTimeout(
      () => {
        if (mode !== '3d') return;
        flat.unmount();
        flat.element.classList.remove('fade-out');
      },
      reducedMotion.matches ? 0 : DURATION.state,
    );
  }
  interaction.viewChanged();
  hud.setView(mode);
  lastSwitchMs = performance.now() - start;
  if (document.activeElement instanceof HTMLCanvasElement) view?.element.focus();
  post({ type: 'viewChanged', mode });
}

function toggleList(): void {
  list.toggle();
  hud.setPressed(hud.listButton, list.isOpen);
  if (!list.isOpen) view?.element.focus();
}

const hud = new Hud(byId('hud', HTMLElement), {
  onWindow: (window) => {
    hud.setBusy(window);
    status.textContent = `Analysing the last ${String(window)} days…`;
    post({ type: 'setWindow', window });
  },
  onToggleList: toggleList,
  onView: (next) => {
    switchView(next);
  },
  onToggleHighContrast: () => {
    contrast.local = !contrast.local;
    applyContrast();
  },
  onFit: () => {
    view?.fitToView(true);
    view?.element.focus();
  },
  onShowControls: () => {
    controlsHelp.show();
  },
  onExportPostcard: () => {
    post({ type: 'exportPostcard' });
  },
  onExportForAgents: () => {
    post({ type: 'exportForAgents' });
  },
  onAddToAgent: () => {
    post({ type: 'addToAgent' });
  },
  onShowTips: () => {
    coach.show(0);
  },
  onSelectRepository: () => {
    post({ type: 'selectRepository' });
  },
  onCreatePrompt: () => {
    interaction.askSelectedOrTop();
  },
  onRankCodeOnly: () => {
    post({ type: 'rankCodeOnly' });
  },
  onTogglePanel: (panel) => {
    dock.update(panel, { hidden: !dock.panel(panel).hidden, collapsed: false });
    applyPanels(dock.state);
  },
});

const legend = new Legend(app, {
  onCollapse: (collapsed) => {
    dock.update('legend', { collapsed });
    applyPanels(dock.state);
  },
  onClose: () => {
    dock.update('legend', { hidden: true });
    applyPanels(dock.state);
    view?.element.focus();
  },
  onExplain: () => {
    showExplainer(interaction.selection);
  },
});

const explainer = new Explainer(app);

/** "How is this scored?": the example uses `path` when it is a top hotspot, else #1. */
function showExplainer(path: string | null): void {
  const top = analysis?.top ?? [];
  const entry = top.find((t) => t.path === path) ?? top[0];
  explainer.show(entry, analysis?.window ?? 90);
}

const list = new TopList(app, {
  onOpen: (path) => {
    interaction.open(path);
  },
  onFly: (path) => {
    interaction.select(path);
  },
  onClose: () => {
    hud.setPressed(hud.listButton, false);
    view?.element.focus();
  },
});

const rail = new InsightsRail(app, {
  onFly: (path) => {
    interaction.select(path);
  },
  onOpen: (path) => {
    interaction.open(path);
  },
  onAsk: (path) => {
    interaction.ask(path);
  },
  onToggle: (open) => {
    post({ type: 'setRail', open });
    dock.update('rail', { collapsed: !open });
  },
  onClose: () => {
    dock.update('rail', { hidden: true });
    applyPanels(dock.state);
    view?.element.focus();
  },
});

const coach = new CoachMark(app, () => view?.element);
const controlsHelp = new ControlsHelp(app);

const interaction = new Interaction({
  root: app,
  status,
  list,
  post,
  view: () => view,
  onToggleList: toggleList,
  onToggleView: () => {
    switchView(mode === '3d' ? '2d' : '3d');
  },
  onToggleCardCollapse: () => {
    const collapsed = !dock.panel('card').collapsed;
    interaction.pinnedCard.setCollapsed(collapsed);
    dock.update('card', { collapsed });
    if (!collapsed) interaction.pinnedCard.handle.focus();
  },
  onExplain: (path) => {
    showExplainer(path);
  },
  onPinnedChange: () => {
    dock.layout();
  },
});

/**
 * The card, rail and legend dock in corners, stack below the HUD, and move by drag or keys. Their
 * corners and collapsed/closed states are remembered per workspace (`setPanels`).
 */
const dock = new Dock(
  app,
  hud.element,
  (panels: PanelPrefs) => {
    post({ type: 'setPanels', panels });
  },
  (text) => {
    status.textContent = text;
  },
  () => {
    updateOverlays();
  },
);
dock.register('legend', legend.root, legend.handle, () => !legend.root.hidden);
dock.register('rail', rail.root, rail.handle, () => rail.shown);
dock.register(
  'card',
  interaction.pinnedCard.root,
  interaction.pinnedCard.handle,
  () => interaction.pinnedCard.isDocked,
);

/** The HUD and every drawn panel, CSS px from the page's top-left corner. */
function overlayRects(): { hud: Rect | undefined; panels: Rect[] } {
  const origin = app.getBoundingClientRect();
  const rect = (node: Element): Rect => {
    const r = node.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };
  const hudRect = hud.element.getClientRects().length > 0 ? rect(hud.element) : undefined;
  const panels: Rect[] = [];
  if (dock.isDrawn('legend')) panels.push(rect(legend.root));
  if (dock.isDrawn('rail')) panels.push(rect(rail.root));
  if (dock.isDrawn('card')) panels.push(rect(interaction.pinnedCard.root));
  return { hud: hudRect, panels: panels.filter((r) => r.w > 0 && r.h > 0) };
}

/**
 * Measures the overlays and the safe area between them and hands both to the views (after every
 * dock layout: resize, collapse, close, move). Never re-fits: the next fit uses them.
 */
function updateOverlays(): void {
  const width = Math.max(1, app.clientWidth);
  const height = Math.max(1, app.clientHeight);
  const { hud: hudRect, panels } = overlayRects();
  const overlays = {
    width,
    height,
    safe: safeArea(width, height, hudRect, panels),
    obstacles: hudRect ? [hudRect, ...panels] : panels,
  };
  for (const v of [views['3d'], views['2d']]) v?.setOverlays(overlays);
}

/** Shows each panel as its prefs say (collapsed, closed) and lays the dock out again. */
function applyPanels(prefs: PanelPrefs): void {
  legend.setCollapsed(prefs.legend.collapsed);
  legend.root.hidden = prefs.legend.hidden;
  rail.setClosed(prefs.rail.hidden);
  interaction.pinnedCard.setCollapsed(prefs.card.collapsed);
  hud.setPanelShown('rail', !prefs.rail.hidden);
  hud.setPanelShown('legend', !prefs.legend.hidden);
  dock.layout();
}

// The HUD wraps and compacts with the canvas width; panels follow its height.
const resize = new ResizeObserver(() => {
  hud.setWidth(app.clientWidth);
  dock.schedule();
});
resize.observe(app);
hud.setWidth(app.clientWidth);

try {
  views['3d'] = new ThreeView(canvas, (step, frameMs) => {
    post({ type: 'quality', step, frameMs });
  });
  view = views['3d'];
} catch (err) {
  // No WebGL: the 2D treemap shows the same data.
  canvas.hidden = true;
  const text = 'The 3D city needs WebGL, which is not available here; showing the 2D treemap.';
  hud.showMessage(text);
  hud.disableView('3d');
  status.textContent = text;
  reportError(`WebGL unavailable: ${err instanceof Error ? err.message : String(err)}`);
  mode = '2d';
  hud.setView('2d');
  view = views['2d'];
  view.mount(app);
}

/** Renders the postcard from the view in charge and hands the PNG bytes to the host. */
function makePostcard(message: PostcardMessage): void {
  try {
    if (!view || !analysis) throw new Error('nothing to draw yet');
    const { png, ms } = renderPostcard(message, view, themeKind);
    post(
      {
        type: 'postcardResult',
        png,
        width: POSTCARD_WIDTH,
        height: POSTCARD_HEIGHT,
        ms: Math.round(ms * 10) / 10,
      },
      [png],
    );
  } catch (err) {
    post({
      type: 'postcardError',
      message: toShortString(err instanceof Error ? err.message : String(err)),
    });
  }
}

/**
 * Test mode: the next animation frame, or 100 ms when the webview gets no frame (a panel in the
 * background, or Cursor's sparse frames), so a test step can never hang waiting for one.
 */
function testFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Test mode: no tween runs in the view in charge, and no 3D ↔ 2D morph behind the treemap. */
function motionDone(): boolean {
  if (view?.stats().tweening === true) return false;
  return !(mode === '2d' && views['3d']?.stats().tweening === true);
}

/** Test mode: the render-settled signal (`test:settle`). */
async function settle(timeoutMs: number): Promise<void> {
  const deadline = performance.now() + Math.min(Math.max(0, timeoutMs), 30_000);
  while (!motionDone() && performance.now() < deadline) await testFrame();
  const settled = motionDone();
  // Two more frames: the last tween step, labels and the HUD drawn at their final place.
  await testFrame();
  await testFrame();
  postStats({
    ...(view?.stats() ?? {}),
    settled,
    mode2d: mode === '2d',
    // VS Code sets the body's theme class (and the CSS variables) a moment after a theme change.
    bodyLight: document.body.classList.contains('vscode-light'),
  });
}

/** Test mode: the page laid out at width × height, city and overlays in one PNG. */
async function capture(width: number, height: number): Promise<void> {
  const w = Math.min(Math.max(320, width), 3200);
  const h = Math.min(Math.max(240, height), 2000);
  app.style.width = `${String(w)}px`;
  app.style.height = `${String(h)}px`;
  const frame = testFrame;
  try {
    await frame();
    // Lay the HUD and the panels out for this size now (the resize observers run a frame late).
    hud.setWidth(w);
    dock.layout();
    await frame();
    const current = view;
    const png = await composeSnapshot(app, w, h, (ctx) => {
      if (current instanceof ThreeView) {
        current.snapshot(ctx, w, h);
      } else if (current) {
        (current as TreemapView).drawNow();
        ctx.drawImage(current.element, 0, 0, w, h);
      }
    });
    await frame(); // labels settle after the snapshot's own frame
    post({ type: 'test:capture', png, width: w, height: h }, [png]);
  } finally {
    app.style.width = '';
    app.style.height = '';
    hud.setWidth(app.clientWidth);
    dock.schedule();
  }
}

/** Test mode: `test:frame` holds the page at its size until `test:clock` releases the clock. */
let heldSize: { w: number; h: number } | undefined;

/**
 * Test mode: one frame of a motion (the demo GIF). Animations are not settled; during a 3D ↔ 2D
 * morph the treemap is drawn over the flattening city as it fades in or out.
 */
async function captureFrame(width: number, height: number): Promise<void> {
  const w = Math.min(Math.max(320, width), 3200);
  const h = Math.min(Math.max(240, height), 2000);
  if (heldSize?.w !== w || heldSize.h !== h) {
    heldSize = { w, h };
    app.style.width = `${String(w)}px`;
    app.style.height = `${String(h)}px`;
    for (let i = 0; i < 2; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      hud.setWidth(w);
      dock.layout();
    }
  }
  // Panels follow what the storyboard does (a card pinned, the rail flown to) on every frame.
  dock.layout();
  const three = views['3d'];
  const flat = views['2d'];
  const png = await composeSnapshot(app, w, h, (ctx) => {
    const threeShown = three !== undefined && !three.element.hidden;
    if (threeShown) three.frame(ctx, w, h);
    if (flat.element.isConnected && !flat.element.hidden) {
      ctx.globalAlpha = threeShown ? 1 - three.flatness : 1;
      flat.drawNow();
      ctx.drawImage(flat.element, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  });
  post({ type: 'test:capture', png, width: w, height: h }, [png]);
}

/**
 * Test mode: presses the pointer on the building at `path` in the view in charge, the way a user
 * does (pointerdown, pointerup and click; a double-click adds the second click and `dblclick`).
 */
function clickBuilding(path: string, double: boolean): void {
  const current = view;
  const at = current?.pointOf(path);
  if (!current || !at) {
    reportError(`test: ${path} is not on screen`);
    return;
  }
  const rect = current.element.getBoundingClientRect();
  const init = {
    bubbles: true,
    button: 0,
    clientX: rect.left + at.x,
    clientY: rect.top + at.y,
    pointerId: 1,
    isPrimary: true,
  };
  const press = (detail: number): void => {
    current.element.dispatchEvent(new PointerEvent('pointerdown', init));
    current.element.dispatchEvent(new PointerEvent('pointerup', init));
    current.element.dispatchEvent(new MouseEvent('click', { ...init, detail }));
  };
  press(1);
  if (double) {
    press(2);
    current.element.dispatchEvent(new MouseEvent('dblclick', { ...init, detail: 2 }));
  }
}

/** Test-mode stats: each panel's corner (index into CORNERS), collapsed and closed state. */
function panelStats(): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const id of ['card', 'rail', 'legend'] as PanelId[]) {
    const state = dock.panel(id);
    out[`${id}Corner`] = CORNERS.indexOf(state.corner);
    out[`${id}Collapsed`] = state.collapsed;
    out[`${id}Hidden`] = state.hidden;
  }
  return out;
}

/**
 * Test mode: lays the page out at width × height and replies with the boxes that must never
 * overlap: each HUD part, the HUD itself, and every shown panel (the HUD overlap test).
 */
async function layoutBoxes(width: number, height: number): Promise<void> {
  const w = Math.min(Math.max(320, width), 3200);
  const h = Math.min(Math.max(240, height), 2000);
  app.style.width = `${String(w)}px`;
  app.style.height = `${String(h)}px`;
  const frame = (): Promise<void> =>
    new Promise((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
  try {
    hud.setWidth(w);
    await frame();
    dock.layout();
    await frame();
    const origin = app.getBoundingClientRect();
    const box = (name: string, node: Element): TestBox => {
      const r = node.getBoundingClientRect();
      return {
        name,
        x: Math.round((r.left - origin.left) * 10) / 10,
        y: Math.round((r.top - origin.top) * 10) / 10,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
      };
    };
    const boxes: TestBox[] = hud.parts.map((part, i) =>
      box(`hud:${part.dataset.test ?? part.className.split(' ')[0] ?? String(i)}`, part),
    );
    boxes.push(box('panel:hud', hud.element));
    if (dock.isDrawn('legend')) boxes.push(box('panel:legend', legend.root));
    if (dock.isDrawn('rail')) boxes.push(box('panel:rail', rail.root));
    if (dock.isDrawn('card')) boxes.push(box('panel:card', interaction.pinnedCard.root));
    post({ type: 'test:boxes', width: w, height: h, boxes });
  } finally {
    app.style.width = '';
    app.style.height = '';
    hud.setWidth(app.clientWidth);
    dock.schedule();
  }
}

/**
 * Test mode: lays the page out at width × height with the rail shown or closed, fits the city
 * without animation and replies with the safe area, the city's bounds on screen and the panels.
 */
async function fitBoxes(width: number, height: number, railShown: boolean): Promise<void> {
  const w = Math.min(Math.max(320, width), 3200);
  const h = Math.min(Math.max(240, height), 2000);
  app.style.width = `${String(w)}px`;
  app.style.height = `${String(h)}px`;
  const frame = (): Promise<void> =>
    new Promise((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
  try {
    dock.update('rail', { hidden: !railShown, collapsed: false });
    applyPanels(dock.state);
    hud.setWidth(w);
    await frame();
    dock.layout();
    await frame();
    view?.fitToView(false);
    await frame();
    const { hud: hudRect, panels } = overlayRects();
    const safe = safeArea(w, h, hudRect, panels);
    const city = view?.projectedBounds();
    const round = (n: number): number => Math.round(n * 10) / 10;
    const box = (name: string, r: Rect): TestBox => ({
      name,
      x: round(r.x),
      y: round(r.y),
      w: round(r.w),
      h: round(r.h),
    });
    const boxes: TestBox[] = [
      box('safe', safe),
      ...panels.map((r, i) => box(`panel:${String(i)}`, r)),
    ];
    if (hudRect) boxes.push(box('panel:hud', hudRect));
    if (city) boxes.push(box('city', city));
    post({ type: 'test:boxes', width: w, height: h, boxes });
  } finally {
    app.style.width = '';
    app.style.height = '';
    hud.setWidth(app.clientWidth);
    dock.schedule();
  }
}

/** Test mode: a drag across the view's canvas with real pointer events (pointer 1, the mouse). */
async function dragView(
  dx: number,
  dy: number,
  buttonId: 0 | 1 | 2,
  shift: boolean,
): Promise<void> {
  const current = view;
  if (!current) return;
  const rect = current.element.getBoundingClientRect();
  const x0 = rect.left + rect.width / 2;
  const y0 = rect.top + rect.height / 2;
  const init = (x: number, y: number, buttons: number): PointerEventInit => ({
    bubbles: true,
    cancelable: true,
    button: buttonId,
    buttons,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    shiftKey: shift,
  });
  const mask = buttonId === 0 ? 1 : buttonId === 1 ? 4 : 2;
  current.element.dispatchEvent(new PointerEvent('pointerdown', init(x0, y0, mask)));
  for (let i = 1; i <= 6; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const t = i / 6;
    current.element.dispatchEvent(
      new PointerEvent('pointermove', { ...init(x0 + dx * t, y0 + dy * t, mask), button: -1 }),
    );
  }
  current.element.dispatchEvent(new PointerEvent('pointerup', init(x0 + dx, y0 + dy, 0)));
}

/** Test mode: a wheel event at the canvas centre. */
function wheelView(deltaX: number, deltaY: number, ctrl: boolean): void {
  const current = view;
  if (!current) return;
  const rect = current.element.getBoundingClientRect();
  current.element.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      deltaX,
      deltaY,
      deltaMode: 0,
      ctrlKey: ctrl,
    }),
  );
}

/** Test mode: pairs of shown pills that overlap each other or an overlay (must stay 0). */
function pillOverlaps(): number {
  const origin = app.getBoundingClientRect();
  const rects = [...document.querySelectorAll<HTMLElement>('.pill:not([hidden])')].map((n) => {
    const r = n.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  });
  const { hud: hudRect, panels } = overlayRects();
  const blocks = hudRect ? [hudRect, ...panels] : panels;
  let count = 0;
  rects.forEach((a, i) => {
    for (const b of rects.slice(i + 1)) if (overlaps(a, b)) count += 1;
    for (const b of blocks) if (overlaps(a, b)) count += 1;
  });
  return count;
}

/** Test mode: moves a real pointer over the first building on screen that is not `except`. */
function hoverAny(except: string): void {
  const current = view;
  if (!current || !analysis) return;
  const rect = current.element.getBoundingClientRect();
  for (const b of analysis.layout.buildings) {
    if (b.path === except || b.folded) continue;
    const at = current.pointOf(b.path);
    if (!at || at.x < 40 || at.y < 40 || at.x > rect.width - 40 || at.y > rect.height - 40)
      continue;
    // Only where the building itself is under the pointer (not a panel or a nearer building).
    const hit = current.hitTest(at.x, at.y);
    if (!hit || !('id' in hit) || 'children' in hit || hit.path !== b.path) continue;
    current.element.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: rect.left + at.x,
        clientY: rect.top + at.y,
        pointerId: 1,
        isPrimary: true,
      }),
    );
    return;
  }
  reportError('test: no other building is on screen');
}

/** Test mode: focuses the insights rail's card for `rank` and presses Enter on it. */
function railFly(rank: number): void {
  const card = rail.root.querySelectorAll<HTMLElement>('.rail-card')[rank - 1];
  if (!card) return;
  card.focus();
  card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function onMessage(message: AnyHostToWebview): void {
  switch (message.type) {
    case 'analysis': {
      const receivedAt = performance.now();
      // Checked like any input: malformed extras are dropped, the city still draws.
      let data = isIgnoredList(message.ignored) ? message : { ...message, ignored: [] };
      const notes: unknown = data.notes;
      if (typeof notes !== 'object' || notes === null || Array.isArray(notes)) {
        data = { ...data, notes: {} };
      }
      analysis = data;
      hud.setAnalysis(data.repoName, data.window, data.layout.stats.files, {
        repoPath: typeof data.repoPath === 'string' ? data.repoPath : undefined,
        rank: data.rank === 'all' ? 'all' : 'code',
        askable: data.top.length > 0,
      });
      list.setEntries(data.top);
      rail.setEntries(data.top);
      // Now, not next frame: the first fit needs the panels' real size.
      hud.setWidth(app.clientWidth);
      dock.layout();
      if (!view) return;
      // Only the view in charge draws now; the other catches up when it is switched to.
      const stats = view.setData(data, receivedAt);
      interaction.setData(data);
      post({ type: 'rendered', buildings: stats.buildings, ms: Math.round(stats.ms * 10) / 10 });
      return;
    }
    case 'theme': {
      themeKind = message.kind;
      contrast.theme = themeKind === 'hc';
      theme = readTheme(themeKind);
      applyBackdrop(theme);
      for (const v of [views['3d'], views['2d']]) v?.setTheme(theme);
      applyContrast();
      return;
    }
    case 'view':
      switchView(message.mode);
      return;
    case 'highContrast':
      contrast.host = message.on;
      applyContrast();
      return;
    case 'prefs':
      rail.setOpen(message.railOpen);
      if (message.panels) {
        dock.setPrefs({
          ...message.panels,
          rail: { ...message.panels.rail, collapsed: !message.railOpen },
        });
      }
      applyPanels(dock.state);
      return;
    case 'coach':
      coach.show(0);
      return;
    case 'window':
      hud.setBusy(message.window);
      return;
    case 'select':
      interaction.select(message.path);
      return;
    case 'postcard':
      makePostcard(message);
      return;
    case 'empty':
      hud.showMessage(message.message);
      status.textContent = message.message;
      return;
    case 'test:emit':
      if (TEST_MODE) post(message.payload);
      return;
    case 'test:stats':
      if (TEST_MODE) {
        postStats({
          ...(view?.stats() ?? {}),
          ...(mode === '2d' && views['3d']
            ? { morphing3d: views['3d'].stats().tweening === true }
            : {}),
          mode2d: mode === '2d',
          lastSwitchMs,
          coachVisible: coach.visible,
          railOpen: rail.isOpen,
          railCollapsedCount: Number.parseInt(rail.collapsedLabel, 10) || 0,
          railCards: rail.shown ? document.querySelectorAll('.rail-card').length : 0,
          railAskButtons: rail.shown ? document.querySelectorAll('.rail-card .rail-ask').length : 0,
          cardPinned: interaction.pinnedState.pinned,
          pinnedButtons: interaction.pinnedState.buttons,
          selected: interaction.selection !== null,
          rankChip: hud.rankChipShown,
          askEnabled: !hud.askButton.disabled,
          coachSteps: COACH_STEPS.length,
          pills: document.querySelectorAll('.pill:not([hidden])').length,
          pillsCompact: document.querySelectorAll('.pill.compact:not([hidden])').length,
          pillOverlaps: pillOverlaps(),
          controlsOpen: controlsHelp.visible,
          ...panelStats(),
          hudMode: ['wide', 'wrap', 'compact'].indexOf(hud.mode),
          explainerOpen: explainer.visible,
          hoverCard: interaction.hoverState.card,
          hoverTip: interaction.hoverState.tip,
          cardCollapsed: interaction.pinnedCard.isDocked && interaction.pinnedCard.collapsed,
        });
      }
      return;
    case 'test:bench':
      if (TEST_MODE && view) {
        void view.bench(Math.min(Math.max(1, message.frames), 2000)).then(postStats);
      }
      return;
    case 'test:benchIntro':
      if (TEST_MODE && views['3d'] && mode === '3d') void views['3d'].benchIntro().then(postStats);
      return;
    case 'test:capture':
      if (TEST_MODE) {
        void capture(message.width, message.height).catch((err: unknown) => {
          reportError(`capture failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      return;
    case 'test:dismissCoach':
      if (TEST_MODE) coach.hide();
      return;
    case 'test:settle':
      if (TEST_MODE) void settle(message.timeoutMs);
      return;
    case 'test:clock':
      if (TEST_MODE) {
        views['3d']?.setTestClock(message.advance);
        if (message.advance === null && heldSize) {
          heldSize = undefined;
          app.style.width = '';
          app.style.height = '';
          hud.setWidth(app.clientWidth);
          dock.schedule();
        }
      }
      return;
    case 'test:frame':
      if (TEST_MODE) {
        void captureFrame(message.width, message.height).catch((err: unknown) => {
          reportError(`frame failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      return;
    case 'test:railFly':
      if (TEST_MODE) railFly(message.rank);
      return;
    case 'test:clickBuilding':
      if (TEST_MODE) clickBuilding(message.path, message.double);
      return;
    case 'test:click':
      if (TEST_MODE) {
        document.querySelector<HTMLElement>(`[data-test="${CSS.escape(message.target)}"]`)?.click();
      }
      return;
    case 'test:reducedMotion':
      if (TEST_MODE) forceReducedMotion(message.on ?? undefined);
      return;
    case 'test:layout':
      if (TEST_MODE) {
        void layoutBoxes(message.width, message.height).catch((err: unknown) => {
          reportError(`layout failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      return;
    case 'test:drag':
      if (TEST_MODE) dock.testDrag(message.panel, message.corner);
      return;
    case 'test:hoverAny':
      if (TEST_MODE) hoverAny(message.except);
      return;
    case 'test:fit':
      if (TEST_MODE) {
        void fitBoxes(message.width, message.height, message.rail).catch((err: unknown) => {
          reportError(`fit failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      return;
    case 'test:dragView':
      if (TEST_MODE) {
        void dragView(message.dx, message.dy, message.button, message.shift).catch(
          (err: unknown) => {
            reportError(`drag failed: ${err instanceof Error ? err.message : String(err)}`);
          },
        );
      }
      return;
    case 'test:wheel':
      if (TEST_MODE) wheelView(message.deltaX, message.deltaY, message.ctrl);
      return;
    case 'test:key':
      if (TEST_MODE) {
        // `view` is the canvas in charge; `Alt+` in front of the key holds Alt.
        const alt = message.key.startsWith('Alt+');
        const key = alt ? message.key.slice(4) : message.key;
        const target =
          message.target === 'view'
            ? view?.element
            : document.querySelector<HTMLElement>(`[data-test="${CSS.escape(message.target)}"]`);
        target?.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: alt, bubbles: true }));
      }
      return;
  }
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (typeof data !== 'object' || data === null) return;
  if (typeof (data as { type?: unknown }).type !== 'string') return;
  onMessage(data as AnyHostToWebview);
});

post({ type: 'ready' });
