import type { PaletteOptions } from '../src/city/palette.js';
import type { TopEntry } from '../src/city/protocol.js';
import { PROMPT_LABEL, PROMPT_TOOLTIP, rankBadge } from './card.js';
import { button, el } from './dom.js';
import { sparkline } from './svg.js';
import { fileName, folderOf, middleTruncate } from './text.js';

/** How many hotspots the rail explains. */
export const RAIL_TOP = 3;

export interface RailHandlers {
  /** Click, Enter or Space on a card: fly there and show its card. */
  onFly(path: string): void;
  /** Double-click or the card's Open button. */
  onOpen(path: string): void;
  /** The card's ✦ AI prompt button. */
  onAsk(path: string): void;
  /** The rail was opened or collapsed by the user (the host remembers it per workspace). */
  onToggle(open: boolean): void;
  /** The × : the rail closes (⋯ → Show insights brings it back). */
  onClose(): void;
}

/** The one-sentence summary a rail card shows: the first sentence, with a full stop. */
export function summary(entry: TopEntry): string {
  const first = entry.sentences[0] ?? entry.reasons[0] ?? '';
  return first && !/[.!?]$/.test(first) ? `${first}.` : first;
}

/**
 * The right-side insights rail: the top three hotspots as cards (rank, name, folder, one sentence,
 * sparkline), so a first-time viewer sees which files need attention and why without hovering.
 * A dock panel: its header drags it between corners, it collapses to "3 need attention ›" and
 * closes with ×; the host remembers all of it per workspace.
 */
export class InsightsRail {
  readonly root = el('aside', 'rail glass');
  /** The header: drags the rail; focused, the arrow keys move it between corners. */
  readonly handle = el('div', 'rail-head');
  private readonly list = el('ol', 'rail-list');
  private readonly toggleButton: HTMLButtonElement;
  /** The collapsed rail: "3 need attention ›", which opens it again. */
  private readonly expandButton: HTMLButtonElement;
  private entries: TopEntry[] = [];
  private open = true;
  private closed = false;
  palette: PaletteOptions = { variant: 'dark', highContrast: false };

  constructor(
    parent: HTMLElement,
    private readonly handlers: RailHandlers,
  ) {
    this.root.setAttribute('aria-label', 'Insights');
    this.root.dataset.test = 'rail';
    const head = this.handle;
    head.tabIndex = 0;
    head.setAttribute('aria-label', 'Needs attention: arrow keys move it');
    head.dataset.test = 'rail-handle';
    head.append(el('h2', 'rail-title', 'Needs attention'));
    this.toggleButton = button('card-tool rail-toggle', '–', () => {
      this.setOpen(!this.open);
      this.handlers.onToggle(this.open);
    });
    const close = button(
      'card-tool rail-close',
      '×',
      (e) => {
        e.stopPropagation();
        this.handlers.onClose();
      },
      'Close (⋯ → Show insights brings it back)',
    );
    close.setAttribute('aria-label', 'Close insights');
    close.dataset.test = 'rail-close';
    this.toggleButton.setAttribute('aria-controls', 'rail-list');
    this.expandButton = button('rail-expand', '', () => {
      this.setOpen(true);
      this.handlers.onToggle(true);
    });
    this.expandButton.setAttribute('aria-controls', 'rail-list');
    this.expandButton.setAttribute('aria-expanded', 'false');
    this.expandButton.dataset.test = 'rail-expand';
    this.toggleButton.dataset.test = 'rail-collapse';
    this.list.id = 'rail-list';
    const tools = el('div', 'card-tools');
    tools.append(this.toggleButton, close);
    head.append(this.expandButton, tools);
    this.root.append(head, this.list);
    parent.append(this.root);
    this.setOpen(true);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Closed with × (the ⋯ menu's Show insights opens it again). */
  setClosed(closed: boolean): void {
    this.closed = closed;
    this.root.hidden = this.entries.length === 0 || closed;
  }

  /** Shown on the canvas: has entries and is not closed. */
  get shown(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle('collapsed', !open);
    this.list.hidden = !open;
    this.toggleButton.textContent = '–';
    this.toggleButton.setAttribute('aria-expanded', 'true');
    this.toggleButton.setAttribute('aria-label', 'Collapse insights');
    this.toggleButton.title = 'Collapse to “need attention”';
    this.renderExpand();
  }

  /** "3 need attention ›" (or "1 needs attention ›"). */
  private renderExpand(): void {
    const n = this.entries.length;
    this.expandButton.textContent = `${String(n)} ${n === 1 ? 'needs' : 'need'} attention ›`;
    this.expandButton.title = 'Show insights';
  }

  setEntries(entries: readonly TopEntry[]): void {
    this.entries = entries.slice(0, RAIL_TOP);
    this.renderExpand();
    this.render();
  }

  /** Test-mode stats: the collapsed header's text. */
  get collapsedLabel(): string {
    return this.open ? '' : this.expandButton.textContent;
  }

  render(): void {
    this.root.hidden = this.entries.length === 0 || this.closed;
    this.list.replaceChildren(
      ...this.entries.map((entry) => {
        const li = el('li', 'rail-item');
        const card = el('div', 'rail-card');
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute(
          'aria-label',
          `#${String(entry.rank)} ${entry.path}: ${summary(entry)} Enter selects it.`,
        );
        const head = el('div', 'rail-card-head');
        const titles = el('div', 'card-titles');
        titles.append(el('p', 'card-name path', fileName(entry.path)));
        const folder = folderOf(entry.path);
        if (folder) titles.append(el('p', 'card-folder path', middleTruncate(folder, 36)));
        head.append(rankBadge(entry.rank, entry.heat, this.palette), titles);
        const text = el('p', 'rail-summary', summary(entry));
        const foot = el('div', 'rail-card-foot');
        foot.append(sparkline(entry.weekly, 120, 24));
        const open = button(
          'rail-open',
          'Open',
          (e) => {
            e.stopPropagation();
            this.handlers.onOpen(entry.path);
          },
          `Open ${entry.path}`,
        );
        const ask = button(
          'rail-open rail-ask',
          PROMPT_LABEL,
          (e) => {
            e.stopPropagation();
            this.handlers.onAsk(entry.path);
          },
          `${PROMPT_TOOLTIP}: ${entry.path}`,
        );
        ask.dataset.test = `rail-prompt-${String(entry.rank)}`;
        const actions = el('div', 'rail-actions');
        actions.append(ask, open);
        foot.append(actions);
        card.append(head, text, foot);
        card.addEventListener('click', () => {
          this.handlers.onFly(entry.path);
        });
        card.addEventListener('dblclick', () => {
          this.handlers.onOpen(entry.path);
        });
        card.addEventListener('keydown', (e) => {
          if (e.target !== card) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            this.handlers.onFly(entry.path);
          }
        });
        li.append(card);
        return li;
      }),
    );
  }
}
