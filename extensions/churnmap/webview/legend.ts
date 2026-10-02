/**
 * The legend: the colour bar (Stable → Watch → Hotspot), what makes a file a Hotspot or Watch
 * (relative: the top 5 % and the next 15 % of the ranked code files), what height and glass mean,
 * and "How is this scored?". A dock panel: its header drags it, it collapses to its colour bar and
 * it can be closed (⋯ → Show legend brings it back).
 */
import {
  BANDS,
  glassColour,
  GLASS_OPACITY,
  type PaletteVariant,
  rgbCss,
} from '../src/city/palette.js';
import { button, el } from './dom.js';
import { legendStops } from './hud.js';

/** The legend's rule line: what puts a file in each band. */
export const LEGEND_RULE = 'Hotspot = top 5 % of your code files · Watch = the next 15 %';

export interface LegendHandlers {
  onCollapse(collapsed: boolean): void;
  onClose(): void;
  onExplain(): void;
}

export class Legend {
  readonly root = el('section', 'legend glass');
  /** The header: drags the legend; focused, the arrow keys move it between corners. */
  readonly handle = el('div', 'legend-head');
  private readonly bar = el('div', 'legend-bar');
  private readonly glass = el('span', 'legend-glass-swatch');
  private readonly body = el('div', 'legend-body');
  private readonly collapseButton: HTMLButtonElement;
  private collapsedState = false;

  constructor(parent: HTMLElement, handlers: LegendHandlers) {
    this.root.setAttribute('aria-label', 'Legend');
    this.root.dataset.test = 'legend';
    this.handle.setAttribute('aria-label', 'Legend: arrow keys move it');
    this.handle.dataset.test = 'legend-handle';
    this.handle.tabIndex = 0;
    const title = el('h2', 'legend-title', 'Colour = risk');
    this.collapseButton = button(
      'card-tool',
      '–',
      (e) => {
        e.stopPropagation();
        handlers.onCollapse(!this.collapsedState);
      },
      'Collapse to the colour bar',
    );
    this.collapseButton.dataset.test = 'legend-collapse';
    const close = button(
      'card-tool',
      '×',
      (e) => {
        e.stopPropagation();
        handlers.onClose();
      },
      'Close the legend (⋯ → Show legend brings it back)',
    );
    close.setAttribute('aria-label', 'Close legend');
    close.dataset.test = 'legend-close';
    const tools = el('div', 'card-tools');
    tools.append(this.collapseButton, close);
    this.handle.append(title, tools);

    const labels = el('div', 'legend-labels');
    for (const band of BANDS)
      labels.append(el('span', `legend-label legend-${band.band}`, band.label));
    const glassRow = el('div', 'legend-glass');
    glassRow.append(this.glass, el('span', '', 'Not ranked (docs, data, small or cold files)'));
    const link = button(
      'card-link',
      'How is this scored?',
      (e) => {
        e.stopPropagation();
        handlers.onExplain();
      },
      'The five questions behind the score, and what the bands mean',
    );
    link.dataset.test = 'legend-explain';
    this.body.append(
      labels,
      el('p', 'legend-rule', LEGEND_RULE),
      el('p', 'legend-key', 'Height = lines of code'),
      glassRow,
      link,
    );
    // The bar stays when collapsed; a click on it then expands the legend again.
    this.bar.addEventListener('click', () => {
      if (this.collapsedState) handlers.onCollapse(false);
    });
    this.root.append(this.handle, this.bar, this.body);
    parent.append(this.root);
    this.setPalette({ variant: 'dark', highContrast: false });
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsedState = collapsed;
    this.root.classList.toggle('collapsed', collapsed);
    this.body.hidden = collapsed;
    this.collapseButton.textContent = collapsed ? '+' : '–';
    this.collapseButton.title = collapsed ? 'Expand the legend' : 'Collapse to the colour bar';
    this.collapseButton.setAttribute('aria-label', collapsed ? 'Expand legend' : 'Collapse legend');
    this.collapseButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  get collapsed(): boolean {
    return this.collapsedState;
  }

  setPalette(opts: { variant: PaletteVariant; highContrast: boolean }): void {
    const stops = legendStops(opts);
    this.bar.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;
    // The screenshot capture paints the bar from these stops (it cannot read a CSS gradient).
    this.bar.dataset.stops = stops.join('|');
    this.glass.style.backgroundColor = rgbCss(glassColour(opts.variant), GLASS_OPACITY);
  }
}
