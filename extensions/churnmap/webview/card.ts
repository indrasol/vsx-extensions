import {
  componentOf,
  peopleFact,
  TREND_TOOLTIP,
  trendText,
  whyText,
} from '../src/analysis/explain.js';
import type { IgnoredFile, Window } from '../src/analysis/model.js';
import type { Building, District, Layout } from '../src/city/model.js';
import {
  type Band,
  bandLabel,
  bandOfHeat,
  heatOf,
  luminance,
  type PaletteOptions,
  rampColour,
  rgbCss,
} from '../src/city/palette.js';
import type { TopEntry } from '../src/city/protocol.js';
import { button, el, replayClass } from './dom.js';
import { icon, type IconKey, sparkline } from './svg.js';
import { fileName, folderOf, middleTruncate } from './text.js';

/** One plain-language line, with the numbers behind it for experts. */
export interface CardSentence {
  icon: IconKey;
  text: string;
  detail?: string;
}

/** One entry of the facts row ("525 lines", "People 2", "Complexity rising ↑"). */
export interface CardFact {
  text: string;
  /** Its tooltip (the trend says what it is compared with). */
  title?: string;
}

/**
 * What a hover or selection card shows. Plain strings and numbers, rendered with `textContent`
 * only (never HTML).
 */
export interface CardContent {
  kind: 'hotspot' | 'scored' | 'unranked' | 'folded' | 'district';
  rank?: number;
  /** The file (or folder) name, and the folder it is in (muted, cut in the middle). */
  name: string;
  folder: string;
  /** The risk meter; absent for unranked files and folders with nothing ranked. */
  score?: number;
  /** The meter's colour position (relative band + score within it). */
  heat?: number;
  band?: Band;
  sentences: CardSentence[];
  /** Commits per week, for the sparkline (top hotspots only). */
  weekly?: number[];
  /** The facts row under the reasons: lines, people (when not a reason), trend. */
  facts: CardFact[];
  /** A single friendly line (not ranked yet, ignored, folded, a folder's riskiest file). */
  note?: string;
  hint?: string;
  /** The file an "AI prompt" button is about (scored files and top hotspots). */
  askPath?: string;
  /** The file the pinned card's "Open file" button opens (every drawn file, not folded blocks). */
  openPath?: string;
}

/** The footer hint of a hover card for a file: a click pins it, a double-click opens the file. */
export const SCORED_HINT = 'Click to select · Double-click to open · A · AI prompt';
export const FILE_HINT = 'Click to select · Double-click to open';
/** The footer hint of the pinned (selected) card. */
export const PINNED_HINT = 'Esc to close · C to collapse';
/** The pinned card's link to the scoring explainer. */
export const EXPLAIN_LINK = 'How is this scored?';
/** A folder with nothing ranked inside (only documentation, data, small or cold files). */
export const NO_RANKED_NOTE = 'No ranked files here (documentation / data)';
/** The AI prompt button's label and tooltip, everywhere it appears. */
export const PROMPT_LABEL = '✦ AI prompt';
export const PROMPT_TOOLTIP =
  'Create a ready-to-paste prompt about this hotspot for your AI agent (Cursor, Copilot, Claude Code…)';

export interface DistrictTotals {
  files: number;
  loc: number;
  maxScore: number;
  /** The highest heat inside, -1 when nothing ranks. */
  maxHeat: number;
  /** The riskiest ranked file inside (highest heat): its name and place among ranked files. */
  best?: { name: string; position?: number };
}

/** Longest folder path the card shows before cutting it in the middle. */
export const CARD_FOLDER_CHARS = 48;

function n(value: number): string {
  return value.toLocaleString('en-US');
}

function lines(loc: number): string {
  return `${n(loc)} ${loc === 1 ? 'line' : 'lines'}`;
}

/** "Ignored: <reason> (until yyyy-mm-dd)". */
export function ignoredLine(entry: IgnoredFile): string {
  const until = new Date(entry.until).toISOString().slice(0, 10);
  return `Ignored: ${entry.reason || 'no reason given'} (until ${until})`;
}

/** The facts row of a top hotspot: lines, people (unless it is already a reason), trend. */
export function topFacts(loc: number, top: TopEntry): CardFact[] {
  const trend = trendText(top.trend);
  const peopleIsReason = top.sentences.slice(0, 3).some((text) => componentOf(text) === 'authors');
  return [
    { text: lines(loc) },
    ...(peopleIsReason ? [] : [{ text: peopleFact(top.authors) }]),
    ...(trend ? [{ text: trend, title: TREND_TOOLTIP }] : []),
  ];
}

/**
 * The card for a building: a top hotspot gets its rank, risk meter, sentences with their numbers,
 * a facts row and a sparkline; another scoring file its meter and notes; an unranked file one
 * friendly line; a folded block how many files it stands for.
 */
export function buildingCard(
  building: Building,
  opts: {
    top?: TopEntry | undefined;
    ignored?: IgnoredFile | undefined;
    notes?: readonly string[] | undefined;
    window: Window;
  },
): CardContent {
  const { top, ignored, window } = opts;
  const name = fileName(building.path);
  const folder = middleTruncate(folderOf(building.path), CARD_FOLDER_CHARS);
  const heat = heatOf(building);
  if (building.folded) {
    return {
      kind: 'folded',
      name,
      folder,
      score: building.score,
      heat,
      band: bandOfHeat(heat),
      sentences: [],
      facts: [{ text: `${n(building.folded.files)} files` }, { text: lines(building.folded.loc) }],
      note: 'This block stands for a whole folder.',
      hint: 'Zoom in to see its files',
    };
  }
  const ignoredNote = ignored ? ignoredLine(ignored) : undefined;
  if (building.why !== undefined) {
    return {
      kind: 'unranked',
      name,
      folder,
      sentences: [],
      facts: [{ text: lines(building.loc) }],
      note: ignoredNote ?? whyText(building.why, building.commits ?? 0, window),
      hint: FILE_HINT,
      openPath: building.path,
    };
  }
  const rank = building.rank ?? top?.rank;
  if (top) {
    return {
      kind: 'hotspot',
      ...(rank === undefined ? {} : { rank }),
      name,
      folder,
      score: building.score,
      heat,
      band: bandOfHeat(heat),
      sentences: top.sentences.slice(0, 3).map((text, i) => {
        const detail = top.reasons[i];
        return { icon: componentOf(text), text, ...(detail ? { detail } : {}) };
      }),
      weekly: top.weekly,
      facts: topFacts(building.loc, top),
      ...(ignoredNote ? { note: ignoredNote } : {}),
      hint: SCORED_HINT,
      askPath: building.path,
      openPath: building.path,
    };
  }
  return {
    kind: 'scored',
    ...(building.position === undefined ? {} : { rank: building.position }),
    name,
    folder,
    score: building.score,
    heat,
    band: bandOfHeat(heat),
    sentences: (opts.notes ?? []).slice(0, 2).map((text) => ({ icon: componentOf(text), text })),
    facts: [{ text: lines(building.loc) }],
    ...(ignoredNote ? { note: ignoredNote } : {}),
    hint: SCORED_HINT,
    askPath: building.path,
    openPath: building.path,
  };
}

/**
 * A folder's card: its size, and its riskiest ranked file by name and place ("Riskiest file:
 * engine.js (#1)"), or that nothing inside ranks.
 */
export function districtCard(district: District, totals: DistrictTotals | undefined): CardContent {
  const t = totals ?? { files: 0, loc: 0, maxScore: 0, maxHeat: -1 };
  const root = district.path === '';
  const base = {
    kind: 'district' as const,
    name: root ? 'Repository root' : `${fileName(district.path)}/`,
    folder: root ? '' : middleTruncate(folderOf(district.path), CARD_FOLDER_CHARS),
    sentences: [],
    facts: [{ text: `${n(t.files)} files` }, { text: lines(t.loc) }],
  };
  if (!t.best || t.maxHeat < 0) return { ...base, note: NO_RANKED_NOTE };
  const place = t.best.position === undefined ? '' : ` (#${String(t.best.position)})`;
  return {
    ...base,
    score: t.maxScore,
    heat: t.maxHeat,
    band: bandOfHeat(t.maxHeat),
    note: `Riskiest file: ${t.best.name}${place}`,
  };
}

/** The one-line tooltip shown while a card is pinned: name, and rank when it has one. */
export function tipText(hit: Building | District): string {
  if ('children' in hit) return hit.path === '' ? 'Repository root' : `${fileName(hit.path)}/`;
  const place = hit.rank ?? hit.position;
  return place === undefined ? fileName(hit.path) : `#${String(place)} ${fileName(hit.path)}`;
}

/** Totals per district id over its whole subtree (folded leaves count their files). */
export function districtTotals(layout: Layout): DistrictTotals[] {
  const totals: DistrictTotals[] = layout.districts.map(() => ({
    files: 0,
    loc: 0,
    maxScore: 0,
    maxHeat: -1,
  }));
  // Districts are numbered in pre-order, so children always come after their parent.
  for (let i = layout.districts.length - 1; i >= 0; i--) {
    const d = layout.districts[i];
    const t = totals[i];
    if (!d || !t) continue;
    for (const id of d.buildings) {
      const b = layout.buildings[id];
      if (!b) continue;
      t.files += b.folded?.files ?? 1;
      t.loc += b.loc;
      if (b.why !== undefined || b.heat === undefined) continue;
      t.maxScore = Math.max(t.maxScore, b.score);
      if (b.heat > t.maxHeat) {
        t.maxHeat = b.heat;
        const position = b.rank ?? b.position;
        t.best = { name: fileName(b.path), ...(position === undefined ? {} : { position }) };
      }
    }
    for (const id of d.children) {
      const c = totals[id];
      if (!c) continue;
      t.files += c.files;
      t.loc += c.loc;
      t.maxScore = Math.max(t.maxScore, c.maxScore);
      if (c.maxHeat > t.maxHeat && c.best) {
        t.maxHeat = c.maxHeat;
        t.best = c.best;
      }
    }
  }
  return totals;
}

/** Card position near the pointer, flipped and clamped so it stays inside the bounds. */
export function placeCard(
  x: number,
  y: number,
  width: number,
  height: number,
  boundsWidth: number,
  boundsHeight: number,
  offset = 14,
): { left: number; top: number } {
  let left = x + offset;
  let top = y + offset;
  if (left + width > boundsWidth) left = x - offset - width;
  if (top + height > boundsHeight) top = y - offset - height;
  left = Math.max(4, Math.min(left, boundsWidth - width - 4));
  top = Math.max(4, Math.min(top, boundsHeight - height - 4));
  return { left, top };
}

/** A `#3` badge in the building's own colour (its heat), with ink that stays readable on it. */
export function rankBadge(rank: number, heat: number, opts: PaletteOptions): HTMLElement {
  const badge = el('span', 'rank-badge', `#${String(rank)}`);
  const colour = rampColour(heat, opts);
  badge.style.backgroundColor = rgbCss(colour);
  badge.style.color = luminance(colour) > 0.35 ? '#10141a' : '#ffffff';
  return badge;
}

/**
 * The horizontal risk meter: the score as a bar in the building's colour (its heat), labelled
 * with the relative band.
 */
export function riskMeter(
  score: number,
  heat: number,
  band: Band,
  opts: PaletteOptions,
): HTMLElement {
  const meter = el('div', 'meter');
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', '100');
  meter.setAttribute('aria-valuenow', score.toFixed(0));
  meter.setAttribute('aria-label', `Risk ${bandLabel(band)}`);
  const track = el('div', 'meter-track');
  const fill = el('div', 'meter-fill');
  fill.style.width = `${String(Math.max(2, Math.min(100, score)))}%`;
  fill.style.backgroundColor = rgbCss(rampColour(heat, opts));
  track.append(fill);
  const label = el('div', 'meter-label');
  label.append(
    el('span', 'meter-band', bandLabel(band)),
    el('span', 'meter-score num', score.toFixed(0)),
  );
  meter.append(track, label);
  return meter;
}

export interface CardActions {
  onAsk(path: string): void;
  onOpen(path: string): void;
  /** Escape or the × on the pinned card. */
  onClose(): void;
  /** The collapse control, the pill or the C key. */
  onToggleCollapse(): void;
  /** "How is this scored?". */
  onExplain(): void;
}

/** The collapsed card's pill: "#1 task_router.py ›". */
export function pillText(c: Pick<CardContent, 'rank' | 'name'>): string {
  return `${c.rank === undefined ? '' : `#${String(c.rank)} `}${c.name} ›`;
}

/**
 * The card element: rebuilt from `CardContent` with `textContent`, never HTML. A hover card
 * floats by the pointer and has no buttons. The pinned card (the selection, `docked`) sits in a
 * corner (the dock places it), can be dragged by its header, collapsed to a pill and closed, and
 * has **Open file**, **✦ AI prompt** and the "How is this scored?" link.
 */
export class Card {
  readonly root: HTMLElement;
  /** The pinned card's header, which drags it (the dock listens on it). */
  readonly handle: HTMLElement;
  /** Palette for badges and meters (variant from the theme, high contrast). */
  palette: PaletteOptions = { variant: 'dark', highContrast: false };
  private docked = false;
  private collapsedState = false;
  private content: CardContent | undefined;

  constructor(
    parent: HTMLElement,
    private readonly actions?: CardActions,
  ) {
    this.root = el('div', 'card glass');
    this.root.hidden = true;
    this.handle = el('div', 'card-grip');
    this.root.addEventListener('keydown', (e) => {
      if (!this.docked || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.actions?.onClose();
      } else if ((e.key === 'c' || e.key === 'C') && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        e.stopPropagation();
        this.actions?.onToggleCollapse();
      }
    });
    parent.append(this.root);
  }

  /** Collapsed (the pill) or expanded; re-renders a pinned card. */
  setCollapsed(collapsed: boolean): void {
    if (this.collapsedState === collapsed) return;
    this.collapsedState = collapsed;
    if (this.docked && this.content) this.root.replaceChildren(...this.render(this.content));
    this.root.classList.toggle('collapsed', this.docked && collapsed);
  }

  get collapsed(): boolean {
    return this.collapsedState;
  }

  show(content: CardContent, at: { x: number; y: number } | 'docked'): void {
    const wasHidden = this.root.hidden;
    this.docked = at === 'docked';
    this.content = content;
    this.root.replaceChildren(...this.render(content));
    this.root.hidden = false;
    this.root.classList.toggle('docked', this.docked);
    this.root.classList.toggle('collapsed', this.docked && this.collapsedState);
    if (this.docked) {
      this.root.setAttribute('role', 'region');
      this.root.setAttribute('aria-label', `Selected: ${content.name}`);
      this.root.dataset.test = 'pinned-card';
    } else {
      this.root.removeAttribute('role');
      this.root.removeAttribute('aria-label');
      delete this.root.dataset.test;
    }
    if (wasHidden) {
      // Restart the 180 ms entrance (CSS; none with reduced motion).
      replayClass(this.root, 'enter');
    }
    // The dock places a pinned card; a hover card follows the pointer.
    if (at === 'docked') return;
    this.root.style.maxHeight = '';
    const bounds = this.root.parentElement?.getBoundingClientRect();
    const pos = placeCard(
      at.x,
      at.y,
      this.root.offsetWidth,
      this.root.offsetHeight,
      bounds?.width ?? window.innerWidth,
      bounds?.height ?? window.innerHeight,
    );
    this.root.style.left = `${String(Math.round(pos.left))}px`;
    this.root.style.top = `${String(Math.round(pos.top))}px`;
    this.root.style.right = '';
    this.root.style.bottom = '';
  }

  private render(c: CardContent): HTMLElement[] {
    const actions = this.actions;
    if (this.docked && this.collapsedState && actions) {
      // Collapsed: one pill; a click (or Enter) expands it again. The pill is the drag handle.
      const pill = button(
        'card-pill',
        pillText(c),
        (e) => {
          e.stopPropagation();
          actions.onToggleCollapse();
        },
        `Expand the card for ${c.name} (C)`,
      );
      pill.dataset.test = 'card-expand';
      this.handle.replaceChildren(pill);
      this.handle.className = 'card-grip card-grip-pill dock-handle';
      this.handle.removeAttribute('tabindex');
      return [this.handle];
    }
    const opts = this.palette;
    const heat = c.heat ?? c.score ?? 0;
    const head = el('div', 'card-head');
    if (c.rank !== undefined && c.score !== undefined) head.append(rankBadge(c.rank, heat, opts));
    else if (c.kind === 'unranked') head.append(el('span', 'glass-dot'));
    const titles = el('div', 'card-titles');
    titles.append(el('p', 'card-name path', c.name));
    if (c.folder) titles.append(el('p', 'card-folder path', c.folder));
    head.append(titles);
    const parts: HTMLElement[] = [];
    if (this.docked && actions) {
      const tools = el('div', 'card-tools');
      const collapse = button(
        'card-tool',
        '–',
        (e) => {
          e.stopPropagation();
          actions.onToggleCollapse();
        },
        'Collapse to a pill (C)',
      );
      collapse.setAttribute('aria-label', 'Collapse card');
      collapse.dataset.test = 'card-collapse';
      const close = button(
        'card-tool',
        '×',
        (e) => {
          e.stopPropagation();
          actions.onClose();
        },
        'Close (Esc)',
      );
      close.setAttribute('aria-label', 'Close card');
      close.dataset.test = 'card-close';
      tools.append(collapse, close);
      head.append(tools);
      // The header drags the card; focused, the arrow keys move it between corners.
      this.handle.className = 'card-grip dock-handle';
      this.handle.tabIndex = 0;
      this.handle.setAttribute('aria-label', `Card for ${c.name}: arrow keys move it`);
      this.handle.dataset.test = 'card-handle';
      this.handle.replaceChildren(head);
      parts.push(this.handle);
    } else {
      parts.push(head);
    }
    if (c.score !== undefined && c.band && c.kind !== 'unranked') {
      parts.push(riskMeter(c.score, heat, c.band, opts));
    }
    if (c.sentences.length > 0) {
      const list = el('ul', 'card-reasons');
      for (const s of c.sentences) {
        const item = el('li', 'card-reason');
        const text = el('div', 'card-reason-text');
        text.append(el('p', 'sentence', s.text));
        if (s.detail) text.append(el('p', 'detail num', s.detail));
        item.append(icon(s.icon), text);
        list.append(item);
      }
      parts.push(list);
    }
    if (c.facts.length > 0) {
      const facts = el('p', 'card-facts num');
      c.facts.forEach((fact, i) => {
        if (i > 0) facts.append(document.createTextNode(' · '));
        const span = el('span', fact.title ? 'card-fact has-tip' : 'card-fact', fact.text);
        if (fact.title) span.title = fact.title;
        facts.append(span);
      });
      parts.push(facts);
    }
    if (c.weekly && c.weekly.length > 1) {
      const spark = el('div', 'card-spark');
      spark.append(sparkline(c.weekly), el('span', 'card-spark-label', 'commits per week'));
      parts.push(spark);
    }
    if (c.note) parts.push(el('p', 'card-note', c.note));
    const hint = this.docked && c.kind !== 'district' && c.kind !== 'folded' ? PINNED_HINT : c.hint;
    const foot = el('div', 'card-foot');
    if (hint) foot.append(el('p', 'card-hint', hint));
    if (this.docked && actions && c.score !== undefined) {
      const link = button(
        'card-link',
        EXPLAIN_LINK,
        (e) => {
          e.stopPropagation();
          actions.onExplain();
        },
        'The five questions behind the score, with this file’s numbers',
      );
      link.dataset.test = 'card-explain';
      foot.append(link);
    }
    if (foot.childElementCount > 0) parts.push(foot);
    if (actions && this.docked) {
      const row = el('div', 'card-actions');
      const { openPath, askPath } = c;
      if (openPath !== undefined) {
        row.append(
          button(
            'card-button card-open',
            'Open file',
            (e) => {
              e.stopPropagation();
              actions.onOpen(openPath);
            },
            `Open ${openPath} (Enter)`,
          ),
        );
      }
      if (askPath !== undefined) {
        const ask = button(
          'card-button card-ask primary',
          PROMPT_LABEL,
          (e) => {
            e.stopPropagation();
            actions.onAsk(askPath);
          },
          `${PROMPT_TOOLTIP} (A)`,
        );
        ask.dataset.test = 'card-prompt';
        row.append(ask);
      }
      if (row.childElementCount > 0) parts.push(row);
    }
    return parts;
  }

  /** The pinned card's action buttons (test-mode stats). */
  get buttons(): number {
    return this.root.querySelectorAll('.card-actions button').length;
  }

  get isDocked(): boolean {
    return this.docked && !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
    this.docked = false;
    this.content = undefined;
    this.root.classList.remove('enter', 'collapsed');
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
