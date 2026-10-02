import { WINDOWS, type Window } from '../src/analysis/model.js';
import { type PaletteVariant, rampColour, rgbCss } from '../src/city/palette.js';
import { RANK_ALL_LABEL, type RankMode, type ViewMode } from '../src/city/protocol.js';
import { button, el } from './dom.js';

export { el };
export { rgbCss };

export interface HudHandlers {
  /** A window segment was pressed (only when it differs from the current window). */
  onWindow(window: Window): void;
  onToggleList(): void;
  onView(mode: ViewMode): void;
  onToggleHighContrast(): void;
  /** ⤢ Fit, ⋯ → Fit city to view: the whole city in the space the panels leave (F, Home). */
  onFit(): void;
  /** ⋯ → ? Controls: the mouse, trackpad and keyboard controls. */
  onShowControls(): void;
  onExportPostcard(): void;
  onExportForAgents(): void;
  onAddToAgent(): void;
  onShowTips(): void;
  /** The "switch" button beside the repository name. */
  onSelectRepository(): void;
  /** The HUD's "✦ AI prompt": the selected building, else the #1 hotspot. */
  onCreatePrompt(): void;
  /** The "Ranking: all files" chip's "Code only". */
  onRankCodeOnly(): void;
  /** ⋯ → Show insights / Show legend: bring a closed panel back (or close it). */
  onTogglePanel(panel: 'rail' | 'legend'): void;
}

/** Below this width (CSS px) the HUD wraps into two rows. */
export const HUD_WRAP_WIDTH = 900;
/** Below this width the window and view groups become dropdowns and the meta text hides. */
export const HUD_COMPACT_WIDTH = 640;

/** The HUD's layout at a canvas width: one row, two rows, or two compact rows. */
export function hudMode(width: number): 'wide' | 'wrap' | 'compact' {
  if (width < HUD_COMPACT_WIDTH) return 'compact';
  if (width < HUD_WRAP_WIDTH) return 'wrap';
  return 'wide';
}

/** The legend gradient's colour stops, sampled from the ramp (CSS `linear-gradient` stops). */
export function legendStops(opts: { variant: PaletteVariant; highContrast: boolean }): string[] {
  if (opts.highContrast) {
    // Flat bands in high contrast: hard stops at the band edges.
    const [stable, watch, hot] = [30, 72, 95].map((s) => rgbCss(rampColour(s, opts)));
    return [
      `${stable ?? ''} 0%`,
      `${stable ?? ''} 60%`,
      `${watch ?? ''} 60%`,
      `${watch ?? ''} 85%`,
      `${hot ?? ''} 85%`,
      `${hot ?? ''} 100%`,
    ];
  }
  return [0, 20, 40, 60, 70, 80, 90, 100].map(
    (s) => `${rgbCss(rampColour(s, opts))} ${String(s)}%`,
  );
}

export interface MenuItem {
  label: string;
  run(): void;
  /** `menuitemcheckbox` / `menuitemradio` for a toggle (its `aria-checked` is kept by the caller). */
  role?: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
  test?: string;
}

/**
 * A button that opens a `menu` of `menuitem`s (arrow keys move, Escape closes and returns focus
 * to the button, Enter or Space activates): the ⋯ overflow menu and the AI agent menu.
 */
export class MenuButton {
  readonly trigger: HTMLButtonElement;
  private readonly menu = el('div', 'menu glass');
  readonly items: HTMLButtonElement[] = [];
  readonly wrap = el('div', 'menu-wrap');

  constructor(
    parent: HTMLElement,
    opts: { label: string; className: string; title: string; test: string; items: MenuItem[] },
  ) {
    this.trigger = button(
      opts.className,
      opts.label,
      () => {
        this.toggle();
      },
      opts.title,
    );
    this.trigger.setAttribute('aria-haspopup', 'menu');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-label', opts.title);
    this.trigger.dataset.test = opts.test;
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', opts.title);
    this.menu.hidden = true;
    for (const item of opts.items) {
      const b = button('menu-item', item.label, () => {
        this.close(false);
        item.run();
      });
      b.setAttribute('role', item.role ?? 'menuitem');
      b.tabIndex = -1;
      if (item.test) b.dataset.test = item.test;
      this.items.push(b);
      this.menu.append(b);
    }
    this.menu.addEventListener('keydown', (e) => {
      this.onKey(e);
    });
    document.addEventListener('pointerdown', (e) => {
      if (
        !this.menu.hidden &&
        e.target instanceof Node &&
        !this.menu.contains(e.target) &&
        e.target !== this.trigger
      ) {
        this.close(false);
      }
    });
    this.wrap.append(this.trigger, this.menu);
    parent.append(this.wrap);
  }

  setLabel(label: string): void {
    this.trigger.textContent = label;
  }

  private toggle(): void {
    if (this.menu.hidden) this.open();
    else this.close(true);
  }

  private open(): void {
    this.menu.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.items[0]?.focus();
  }

  close(refocus: boolean): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (refocus) this.trigger.focus();
  }

  private onKey(e: KeyboardEvent): void {
    const index = this.items.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => {
      const n = this.items.length;
      this.items[((to % n) + n) % n]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(this.items.length - 1);
        break;
      case 'Escape':
      case 'Tab':
        this.close(true);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }
}

/**
 * The heads-up display: a top bar (repository, window, 3D/2D, Top hotspots, ✦ AI prompt, AI
 * agent, ⋯). Plain DOM; the bar comes first in the page, so its controls are first in the focus
 * order. Responsive: below 900 px it wraps into two rows (repository and meta; controls), below
 * 640 px the window and view groups become dropdowns and the meta text moves into the repository
 * name's tooltip, so nothing ever draws over anything else.
 */
export class Hud {
  private readonly repo = el('h1', 'hud-repo', 'Churnmap');
  readonly switchButton: HTMLButtonElement;
  private readonly meta = el('p', 'hud-meta num', '');
  /** Shown only while `churnmap.rank` is `all`, with a one-click way back to code only. */
  private readonly rankChip = el('p', 'hud-chip');
  readonly askButton: HTMLButtonElement;
  private readonly message = el('p', 'hud-message', '');
  private readonly windowButtons = new Map<Window, HTMLButtonElement>();
  private readonly viewButtons = new Map<ViewMode, HTMLButtonElement>();
  /** Compact mode: the window and view groups as dropdowns. */
  private readonly windowMenu: MenuButton;
  private readonly viewMenu: MenuButton;
  private readonly agentMenu: MenuButton;
  readonly listButton: HTMLButtonElement;
  readonly fitButton: HTMLButtonElement;
  private readonly menu: MenuButton;
  private readonly contrastItem: HTMLButtonElement;
  private readonly railItem: HTMLButtonElement;
  private readonly legendItem: HTMLButtonElement;
  private window: Window | undefined;
  private buildings = 0;
  private busy = false;
  private repoName = 'Churnmap';
  private repoPath: string | undefined;
  private layoutMode: 'wide' | 'wrap' | 'compact' = 'wide';

  constructor(
    private readonly root: HTMLElement,
    handlers: HudHandlers,
  ) {
    const title = el('div', 'hud-title');
    this.switchButton = button(
      'hud-switch',
      'switch',
      () => {
        handlers.onSelectRepository();
      },
      'Analyse another repository in this workspace',
    );
    this.switchButton.setAttribute('aria-label', 'Switch repository');
    this.switchButton.dataset.test = 'switch-repository';
    this.rankChip.hidden = true;
    this.rankChip.append(el('span', 'hud-chip-text', RANK_ALL_LABEL));
    const codeOnly = button(
      'hud-chip-button',
      'Code only',
      () => {
        handlers.onRankCodeOnly();
      },
      'Rank source code only again (documentation and data are drawn as glass)',
    );
    codeOnly.dataset.test = 'rank-code-only';
    this.rankChip.append(codeOnly);
    this.repo.dataset.test = 'hud-repo';
    this.meta.dataset.test = 'hud-meta';
    title.append(this.repo, this.switchButton, this.meta, this.rankChip);

    const controls = el('div', 'hud-controls');
    const windows = el('div', 'segmented hud-wide-only');
    windows.setAttribute('role', 'group');
    windows.setAttribute('aria-label', 'Time window');
    windows.dataset.test = 'hud-windows';
    for (const days of WINDOWS) {
      const b = button(
        'segment num',
        `${String(days)} d`,
        () => {
          if (days !== this.window && !this.busy) handlers.onWindow(days);
        },
        `Rank by the last ${String(days)} days of history`,
      );
      b.setAttribute('aria-pressed', 'false');
      this.windowButtons.set(days, b);
      windows.append(b);
    }
    controls.append(windows);
    this.windowMenu = new MenuButton(controls, {
      label: '90 d ▾',
      className: 'hud-button num',
      title: 'Time window',
      test: 'hud-window-menu',
      items: WINDOWS.map((days) => ({
        label: `Last ${String(days)} days`,
        role: 'menuitemradio' as const,
        run: () => {
          if (days !== this.window && !this.busy) handlers.onWindow(days);
        },
      })),
    });
    this.windowMenu.wrap.classList.add('hud-compact-only');

    const views = el('div', 'segmented hud-wide-only');
    views.setAttribute('role', 'group');
    views.setAttribute('aria-label', 'View (2)');
    views.dataset.test = 'hud-views';
    for (const [mode, label, tip] of [
      ['3d', '3D', 'The city in 3D (2)'],
      ['2d', '2D', 'The flat treemap (2)'],
    ] as const) {
      const b = button(
        'segment',
        label,
        () => {
          handlers.onView(mode);
        },
        tip,
      );
      b.setAttribute('aria-pressed', mode === '3d' ? 'true' : 'false');
      b.dataset.test = `view-${mode}`;
      this.viewButtons.set(mode, b);
      views.append(b);
    }
    controls.append(views);
    this.viewMenu = new MenuButton(controls, {
      label: '3D ▾',
      className: 'hud-button',
      title: 'View (2)',
      test: 'hud-view-menu',
      items: (['3d', '2d'] as const).map((mode) => ({
        label: mode === '3d' ? 'The city in 3D' : 'The flat 2D treemap',
        role: 'menuitemradio' as const,
        run: () => {
          handlers.onView(mode);
        },
      })),
    });
    this.viewMenu.wrap.classList.add('hud-compact-only');

    this.listButton = button(
      'hud-button',
      'Top hotspots',
      () => {
        handlers.onToggleList();
      },
      'Show the ranked list (T)',
    );
    this.listButton.setAttribute('aria-pressed', 'false');
    this.listButton.setAttribute('aria-keyshortcuts', 'T');
    this.listButton.setAttribute('aria-label', 'Top hotspots');
    this.listButton.dataset.test = 'hud-list';

    this.askButton = button(
      'hud-button primary hud-ask',
      '✦ AI prompt',
      () => {
        handlers.onCreatePrompt();
      },
      'Create a ready-to-paste prompt about this hotspot for your AI agent (Cursor, Copilot, Claude Code…) · the selected building, else the #1 hotspot (A)',
    );
    this.askButton.setAttribute('aria-keyshortcuts', 'A');
    this.askButton.dataset.test = 'ai-prompt';

    this.fitButton = button(
      'hud-button hud-fit',
      '⤢ Fit',
      () => {
        handlers.onFit();
      },
      'Fit the whole city into the space the panels leave (F)',
    );
    this.fitButton.setAttribute('aria-keyshortcuts', 'F Home');
    this.fitButton.setAttribute('aria-label', 'Fit city to view');
    this.fitButton.dataset.test = 'fit';

    controls.append(this.fitButton, this.listButton, this.askButton);
    this.agentMenu = new MenuButton(controls, {
      label: 'AI agent ▾',
      className: 'hud-button',
      title: 'AI agent',
      test: 'ai-agent',
      items: [
        {
          label: 'Export for agents…',
          run: () => {
            handlers.onExportForAgents();
          },
          test: 'export-for-agents',
        },
        {
          label: 'Connect to AI agent…',
          run: () => {
            handlers.onAddToAgent();
          },
          test: 'connect-agent',
        },
      ],
    });
    this.menu = new MenuButton(controls, {
      label: '⋯',
      className: 'hud-icon-button',
      title: 'More actions',
      test: 'more',
      items: [
        {
          label: 'High contrast',
          run: () => {
            handlers.onToggleHighContrast();
          },
          role: 'menuitemcheckbox',
        },
        {
          label: 'Show insights',
          run: () => {
            handlers.onTogglePanel('rail');
          },
          role: 'menuitemcheckbox',
          test: 'menu-show-rail',
        },
        {
          label: 'Show legend',
          run: () => {
            handlers.onTogglePanel('legend');
          },
          role: 'menuitemcheckbox',
          test: 'menu-show-legend',
        },
        {
          label: 'Fit city to view (F)',
          run: () => {
            handlers.onFit();
          },
          test: 'menu-fit',
        },
        {
          label: 'Export postcard…',
          run: () => {
            handlers.onExportPostcard();
          },
        },
        {
          label: 'Show tips',
          run: () => {
            handlers.onShowTips();
          },
        },
        {
          label: '? Controls',
          run: () => {
            handlers.onShowControls();
          },
          test: 'menu-controls',
        },
      ],
    });
    const [contrast, rail, legend] = this.menu.items;
    if (!contrast || !rail || !legend) throw new Error('missing a ⋯ menu item');
    this.contrastItem = contrast;
    this.railItem = rail;
    this.legendItem = legend;
    this.contrastItem.setAttribute('aria-checked', 'false');
    this.setPanelShown('rail', true);
    this.setPanelShown('legend', true);
    root.append(title, controls, this.message);
    this.applyMode();
  }

  /** Lays the HUD out for the canvas width (called on every resize). */
  setWidth(width: number): void {
    const mode = hudMode(width);
    if (mode === this.layoutMode) return;
    this.layoutMode = mode;
    this.applyMode();
  }

  get mode(): 'wide' | 'wrap' | 'compact' {
    return this.layoutMode;
  }

  private applyMode(): void {
    const compact = this.layoutMode === 'compact';
    this.root.classList.toggle('hud-wrap', this.layoutMode !== 'wide');
    this.root.classList.toggle('hud-compact', compact);
    this.listButton.textContent = compact ? 'Top' : 'Top hotspots';
    this.fitButton.textContent = compact ? '⤢' : '⤢ Fit';
    this.agentMenu.setLabel(compact ? 'Agent ▾' : 'AI agent ▾');
    this.renderMeta();
  }

  setAnalysis(
    repoName: string,
    window: Window,
    buildings: number,
    extra: { repoPath?: string | undefined; rank?: RankMode | undefined; askable?: boolean } = {},
  ): void {
    this.repoName = repoName;
    this.repoPath = extra.repoPath;
    this.repo.textContent = repoName;
    this.switchButton.setAttribute('aria-label', `Switch repository (now ${repoName})`);
    this.rankChip.hidden = extra.rank !== 'all';
    this.askButton.disabled = extra.askable === false;
    this.buildings = buildings;
    this.busy = false;
    this.message.textContent = '';
    this.setWindow(window);
  }

  setWindow(window: Window): void {
    this.window = window;
    for (const [days, b] of this.windowButtons) {
      b.setAttribute('aria-pressed', days === window ? 'true' : 'false');
    }
    WINDOWS.forEach((days, i) => {
      this.windowMenu.items[i]?.setAttribute('aria-checked', days === window ? 'true' : 'false');
    });
    this.windowMenu.setLabel(`${String(window)} d ▾`);
    this.renderMeta();
  }

  /** "Analysing…" until the next analysis arrives. */
  setBusy(window: Window): void {
    this.busy = true;
    this.setWindow(window);
  }

  setView(mode: ViewMode): void {
    for (const [m, b] of this.viewButtons)
      b.setAttribute('aria-pressed', m === mode ? 'true' : 'false');
    this.viewMenu.items.forEach((item, i) => {
      item.setAttribute('aria-checked', (i === 0 ? '3d' : '2d') === mode ? 'true' : 'false');
    });
    this.viewMenu.setLabel(`${mode === '3d' ? '3D' : '2D'} ▾`);
  }

  disableView(mode: ViewMode): void {
    const b = this.viewButtons.get(mode);
    if (b) b.disabled = true;
    const item = this.viewMenu.items[mode === '3d' ? 0 : 1];
    if (item) item.disabled = true;
  }

  /** A one-line notice (no data yet, WebGL missing, …). */
  showMessage(text: string): void {
    this.message.textContent = text;
  }

  setPressed(b: HTMLButtonElement, pressed: boolean): void {
    b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  }

  setHighContrast(on: boolean): void {
    this.contrastItem.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  /** ⋯ → Show insights / Show legend is checked while that panel is shown. */
  setPanelShown(panel: 'rail' | 'legend', shown: boolean): void {
    (panel === 'rail' ? this.railItem : this.legendItem).setAttribute(
      'aria-checked',
      shown ? 'true' : 'false',
    );
  }

  /** Test-mode stats. */
  get rankChipShown(): boolean {
    return !this.rankChip.hidden;
  }

  /**
   * Every HUD part that must never overlap another (test mode): the title parts and each control,
   * whichever are shown at this width.
   */
  get parts(): HTMLElement[] {
    const nodes = [
      this.repo,
      this.switchButton,
      this.meta,
      this.rankChip,
      ...this.root.querySelectorAll<HTMLElement>('.hud-controls > *'),
    ];
    return nodes.filter((n) => !n.hidden && n.getClientRects().length > 0);
  }

  private renderMeta(): void {
    let text: string;
    if (this.busy) {
      text = `Analysing the last ${String(this.window ?? 90)} days…`;
    } else {
      const parts: string[] = [];
      if (this.window !== undefined) parts.push(`last ${String(this.window)} days`);
      parts.push(`${this.buildings.toLocaleString('en-US')} files`);
      text = parts.join(' · ');
    }
    this.meta.textContent = text;
    // Compact: the meta text lives in the repository name's tooltip.
    const where = this.repoPath ?? this.repoName;
    this.repo.title =
      this.layoutMode === 'compact'
        ? `${where}\n${text}\nClick switch to choose another repository`
        : `${where}\nClick switch to choose another repository`;
  }

  get element(): HTMLElement {
    return this.root;
  }
}
