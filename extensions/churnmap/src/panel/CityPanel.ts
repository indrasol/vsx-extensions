import { randomBytes } from 'node:crypto';
import type { Logger } from '@indrasol/labs-core';
import * as vscode from 'vscode';
import type { Window } from '../analysis/model.js';
import type { AnalysisStore } from '../analysis/store.js';
import { renderHtml, renderMessageHtml } from '../city/html.js';
import {
  type AnalysisMessage,
  type AnyHostToWebview,
  type AnyWebviewToHost,
  type HostToWebview,
  isViewMode,
  isWebviewToHost,
  panelPrefsOrDefault,
  type PanelPrefs,
  type ThemeKind,
  type ViewMode,
  type WebviewToHost,
} from '../city/protocol.js';
import { COMMANDS } from '../commands.js';
import { UNTRUSTED_MESSAGE } from '../trust.js';
import { buildAnalysisMessage } from './analysisMessage.js';

export const CITY_VIEW_TYPE = 'churnmap.city';
/** workspaceState key: the last view the user chose (3D city or 2D treemap). */
export const VIEW_MODE_KEY = 'churnmap.cityView';
/** workspaceState key: whether the insights rail is open (default open). */
export const RAIL_KEY = 'churnmap.insightsRail';
/** workspaceState key: the card, rail and legend corners and collapsed/closed states. */
export const PANELS_KEY = 'churnmap.panels';
/** globalState key: the first-run coach mark has been shown. */
export const COACH_KEY = 'churnmap.coachShown';
export const CITY_TITLE = 'Churnmap';
const EMPTY_MESSAGE = 'Run “Churnmap: Build city” to draw this repository.';

export interface CityDeps {
  context: vscode.ExtensionContext;
  store: AnalysisStore;
  logger: Logger;
}

/** A fresh CSP nonce: 32 random bytes, base64url. */
export function createNonce(): string {
  return randomBytes(32).toString('base64url');
}

export function themeKind(kind: vscode.ColorThemeKind): ThemeKind {
  switch (kind) {
    case vscode.ColorThemeKind.Light:
      return 'light';
    case vscode.ColorThemeKind.Dark:
      return 'dark';
    default:
      return 'hc';
  }
}

/** The `analysis` message for the store's current result: paths, numbers and short strings only. */
export function analysisMessage(store: AnalysisStore): AnalysisMessage | undefined {
  const result = store.get();
  const layout = store.getLayout();
  if (!result || !layout) return undefined;
  return buildAnalysisMessage(result, layout, store.ignored());
}

type Waiter<T> = { type: string; resolve: (m: T) => void };

/** Resolves the waiters for `message.type` and returns the rest. */
function settle<T extends { type: string }>(waiters: Waiter<T>[], message: T): Waiter<T>[] {
  const due = waiters.filter((w) => w.type === message.type);
  for (const w of due) w.resolve(message);
  return waiters.filter((w) => w.type !== message.type);
}

/** Adds a waiter for the next message of `type`; rejects after `timeoutMs`. */
function wait<T>(waiters: Waiter<T>[], type: string, timeoutMs: number, dir: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const waiter: Waiter<T> = {
      type,
      resolve: (m) => {
        clearTimeout(timer);
        resolve(m);
      },
    };
    const timer = setTimeout(() => {
      const i = waiters.indexOf(waiter);
      if (i >= 0) waiters.splice(i, 1);
      reject(
        new Error(`no "${type}" message ${dir} the city webview within ${String(timeoutMs)} ms`),
      );
    }, timeoutMs);
    waiters.push(waiter);
  });
}

/**
 * Test-mode instrumentation: counts every message the host receives from (or posts to) the
 * webview and lets integration tests wait for the next one of a type. Inert unless enabled.
 */
class TestBus {
  enabled = false;
  readonly received = new Map<string, number>();
  readonly posted = new Map<string, number>();
  private receivedWaiters: Waiter<AnyWebviewToHost>[] = [];
  private postedWaiters: Waiter<AnyHostToWebview>[] = [];

  onReceived(message: AnyWebviewToHost): void {
    if (!this.enabled) return;
    this.received.set(message.type, (this.received.get(message.type) ?? 0) + 1);
    this.receivedWaiters = settle(this.receivedWaiters, message);
  }

  onPosted(message: AnyHostToWebview): void {
    if (!this.enabled) return;
    this.posted.set(message.type, (this.posted.get(message.type) ?? 0) + 1);
    this.postedWaiters = settle(this.postedWaiters, message);
  }

  next(type: string, timeoutMs: number): Promise<AnyWebviewToHost> {
    return wait(this.receivedWaiters, type, timeoutMs, 'from');
  }

  nextPosted(type: string, timeoutMs: number): Promise<AnyHostToWebview> {
    return wait(this.postedWaiters, type, timeoutMs, 'to');
  }
}

/** The city: one editor-area webview panel at a time (ADR-0011). */
export class CityPanel implements vscode.Disposable {
  private static current: CityPanel | undefined;
  private static readonly bus = new TestBus();

  private ready = false;
  /** A `select` asked for before the webview was ready; sent right after the analysis. */
  private pendingSelect: string | undefined;
  private readyWaiters: (() => void)[] = [];
  private replyWaiters: { types: readonly string[]; resolve: (m: WebviewToHost) => void }[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly test: boolean;

  /** Shows the city, creating the panel on first use. */
  static show(deps: CityDeps): CityPanel {
    const existing = CityPanel.current;
    if (existing) {
      existing.panel.reveal();
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(
      CITY_VIEW_TYPE,
      CITY_TITLE,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(deps.context.extensionUri, 'media')],
        retainContextWhenHidden: false,
      },
    );
    CityPanel.current = new CityPanel(panel, deps);
    return CityPanel.current;
  }

  static get instance(): CityPanel | undefined {
    return CityPanel.current;
  }

  /** The remembered view mode (3D unless the user switched). */
  static viewMode(context: vscode.ExtensionContext): ViewMode {
    const saved: unknown = context.workspaceState.get(VIEW_MODE_KEY);
    return isViewMode(saved) ? saved : '3d';
  }

  /**
   * Churnmap: Toggle 2D treemap. Flips the remembered mode; an open city switches at once (no new
   * analysis is sent), otherwise the city opens in the new mode.
   */
  static async toggleView(deps: CityDeps): Promise<ViewMode> {
    const next: ViewMode = CityPanel.viewMode(deps.context) === '3d' ? '2d' : '3d';
    await deps.context.workspaceState.update(VIEW_MODE_KEY, next);
    const current = CityPanel.current;
    if (current) {
      current.panel.reveal();
      current.post({ type: 'view', mode: next });
    } else {
      CityPanel.show(deps);
    }
    return next;
  }

  static isVisible(): boolean {
    return CityPanel.current?.panel.visible ?? false;
  }

  /** Posts to the open panel, if any. */
  static post(message: HostToWebview): void {
    CityPanel.current?.post(message);
  }

  private constructor(
    readonly panel: vscode.WebviewPanel,
    private readonly deps: CityDeps,
  ) {
    this.test = deps.context.extensionMode === vscode.ExtensionMode.Test;
    CityPanel.bus.enabled = this.test;
    this.setHtml();
    this.disposables.push(
      panel.onDidDispose(() => {
        this.dispose();
      }),
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        this.receive(raw);
      }),
      // retainContextWhenHidden is off: a hidden webview is torn down and posts `ready` again
      // when it is shown, so nothing is posted in between.
      panel.onDidChangeViewState((e) => {
        if (!e.webviewPanel.visible) this.ready = false;
      }),
      deps.store.onDidChange(() => {
        this.postAnalysis();
      }),
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        this.post({ type: 'theme', kind: themeKind(theme.kind) });
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.setHtml();
      }),
    );
  }

  private setHtml(): void {
    const { webview } = this.panel;
    const media = vscode.Uri.joinPath(this.deps.context.extensionUri, 'media');
    const nonce = createNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(media, 'webview.css')).toString();
    this.ready = false;
    if (!vscode.workspace.isTrusted) {
      webview.html = renderMessageHtml({
        nonce,
        styleUri,
        cspSource: webview.cspSource,
        message: UNTRUSTED_MESSAGE,
      });
      return;
    }
    webview.html = renderHtml({
      nonce,
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(media, 'webview.js')).toString(),
      styleUri,
      cspSource: webview.cspSource,
      test: this.test,
    });
  }

  /** Posts once the webview has said it is ready; earlier messages would be lost. */
  post(message: AnyHostToWebview): void {
    if (!this.ready) return;
    CityPanel.bus.onPosted(message);
    void this.panel.webview.postMessage(message);
  }

  private postAnalysis(): void {
    const message = analysisMessage(this.deps.store);
    this.post(message ?? { type: 'empty', message: EMPTY_MESSAGE });
    // The remembered view follows every analysis (a no-op in the webview when it matches).
    if (message) this.post({ type: 'view', mode: CityPanel.viewMode(this.deps.context) });
  }

  private receive(raw: unknown): void {
    if (!isWebviewToHost(raw, { test: this.test })) {
      this.deps.logger.warn('City: ignored a malformed message from the webview.');
      return;
    }
    CityPanel.bus.onReceived(raw);
    if (raw.type !== 'test:stats' && raw.type !== 'test:capture' && raw.type !== 'test:boxes') {
      this.settleReplies(raw);
    }
    switch (raw.type) {
      case 'ready': {
        this.ready = true;
        this.post({ type: 'theme', kind: themeKind(vscode.window.activeColorTheme.kind) });
        this.post({
          type: 'prefs',
          railOpen: CityPanel.railOpen(this.deps.context),
          panels: CityPanel.panels(this.deps.context),
        });
        this.postAnalysis();
        this.maybeCoach();
        const pending = this.pendingSelect;
        this.pendingSelect = undefined;
        if (pending !== undefined) this.post({ type: 'select', path: pending });
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const resolve of waiters) resolve();
        return;
      }
      case 'rendered':
        this.deps.logger.info(
          `City rendered ${String(raw.buildings)} buildings in ${raw.ms.toFixed(1)} ms`,
        );
        return;
      case 'openFile':
        void vscode.commands.executeCommand(COMMANDS.openFile, raw.path);
        return;
      case 'error':
        this.deps.logger.warn(`City webview: ${raw.message}`);
        return;
      case 'setWindow':
        // Same path as the command palette: saves the setting, rebuilds, posts `analysis`.
        void vscode.commands.executeCommand(COMMANDS.setWindow, raw.window);
        return;
      case 'viewChanged':
        void this.deps.context.workspaceState.update(VIEW_MODE_KEY, raw.mode);
        return;
      case 'setRail':
        void this.deps.context.workspaceState.update(RAIL_KEY, raw.open);
        return;
      case 'setPanels':
        void this.deps.context.workspaceState.update(PANELS_KEY, raw.panels);
        return;
      case 'exportPostcard':
        void vscode.commands.executeCommand(COMMANDS.exportPostcard);
        return;
      case 'selectRepository':
        void vscode.commands.executeCommand(COMMANDS.selectRepository);
        return;
      case 'rankCodeOnly':
        void vscode.commands.executeCommand(COMMANDS.rankCodeOnly);
        return;
      case 'createPrompt':
        // The host validates the path again and builds the prompt itself (ADR-0011).
        void vscode.commands.executeCommand(COMMANDS.createAIPrompt, raw.path);
        return;
      case 'exportForAgents':
        void vscode.commands.executeCommand(COMMANDS.exportForAgents);
        return;
      case 'addToAgent':
        void vscode.commands.executeCommand(COMMANDS.addToAgent);
        return;
      case 'quality':
        this.deps.logger.info(
          `City: frames stayed above 20 ms (${raw.frameMs.toFixed(1)} ms), so ${raw.step} are off.`,
        );
        return;
      case 'hover':
        this.deps.logger.trace(`City hover: ${raw.path ?? '(none)'}`);
        return;
      case 'postcardResult':
      case 'postcardError':
        // Answers to `request` (settled above).
        return;
      case 'test:stats':
      case 'test:capture':
      case 'test:boxes':
        // Test mode only (the guard rejects them otherwise); the test bus above recorded them.
        return;
    }
  }

  /** Where the card, rail and legend sit, and whether each is collapsed or closed (per workspace). */
  static panels(context: vscode.ExtensionContext): PanelPrefs {
    return panelPrefsOrDefault(context.workspaceState.get(PANELS_KEY));
  }

  /** Whether the insights rail is open in this workspace (open unless the user closed it). */
  static railOpen(context: vscode.ExtensionContext): boolean {
    return context.workspaceState.get(RAIL_KEY) !== false;
  }

  /** The first time any city opens, show the coach mark; it is recorded as shown right away. */
  private maybeCoach(): void {
    const state = this.deps.context.globalState;
    if (state.get(COACH_KEY) === true) return;
    void state.update(COACH_KEY, true);
    this.post({ type: 'coach' });
  }

  /** Resolves once the webview is ready for messages (at once when it is). */
  whenReady(timeoutMs: number): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter);
        reject(new Error(`the city did not load within ${String(timeoutMs)} ms`));
      }, timeoutMs);
      this.readyWaiters.push(waiter);
    });
  }

  /** Posts `message` and resolves with the webview's first reply of one of `replyTypes`. */
  request(
    message: HostToWebview,
    replyTypes: readonly WebviewToHost['type'][],
    timeoutMs: number,
  ): Promise<WebviewToHost> {
    return new Promise((resolve, reject) => {
      const waiter = {
        types: replyTypes,
        resolve: (reply: WebviewToHost) => {
          clearTimeout(timer);
          resolve(reply);
        },
      };
      const timer = setTimeout(() => {
        this.replyWaiters = this.replyWaiters.filter((w) => w !== waiter);
        reject(new Error(`no reply from the city within ${String(timeoutMs)} ms`));
      }, timeoutMs);
      this.replyWaiters.push(waiter);
      this.post(message);
    });
  }

  private settleReplies(message: WebviewToHost): void {
    const due = this.replyWaiters.filter((w) => w.types.includes(message.type));
    if (due.length === 0) return;
    this.replyWaiters = this.replyWaiters.filter((w) => !due.includes(w));
    for (const w of due) w.resolve(message);
  }

  /** Flies to a building and shows its card; waits for the webview when it is still loading. */
  select(path: string): void {
    if (this.ready) this.post({ type: 'select', path });
    else this.pendingSelect = path;
  }

  /** Tells the HUD which window is being built; the data follows with the next `analysis`. */
  postWindow(window: Window): void {
    this.post({ type: 'window', window });
  }

  dispose(): void {
    if (CityPanel.current === this) CityPanel.current = undefined;
    this.ready = false;
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
    this.panel.dispose();
  }

  // ---- Test mode only (the extension exposes these only when extensionMode === Test) ----

  static __nextMessage(
    type: AnyWebviewToHost['type'],
    timeoutMs = 10_000,
  ): Promise<AnyWebviewToHost> {
    return CityPanel.bus.next(type, timeoutMs);
  }

  static __nextPosted(
    type: AnyHostToWebview['type'],
    timeoutMs = 10_000,
  ): Promise<AnyHostToWebview> {
    return CityPanel.bus.nextPosted(type, timeoutMs);
  }

  static __received(type: string): number {
    return CityPanel.bus.received.get(type) ?? 0;
  }

  static __posted(type: string): number {
    return CityPanel.bus.posted.get(type) ?? 0;
  }

  static __post(message: AnyHostToWebview): boolean {
    const current = CityPanel.current;
    if (!current?.test || !current.ready) return false;
    current.post(message);
    return true;
  }

  static __html(): string | undefined {
    return CityPanel.current?.panel.webview.html;
  }
}
