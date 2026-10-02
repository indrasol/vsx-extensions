/**
 * "How is this scored?": a sheet over the city, opened from the card and the legend. The same
 * words as the README's "How scoring works" (`src/analysis/scoring.ts`), with the worked example
 * using the selected file's real numbers (else the #1 hotspot's). No network, text only; a modal
 * dialog: focus moves in, Tab stays inside, Escape or Close returns focus to the opener.
 */
import {
  BAND_LINES,
  BANDS_NOTE,
  BANDS_TITLE,
  EXAMPLE_TITLE,
  exampleLines,
  NOT_LINES,
  NOT_TITLE,
  type ScoringExample,
  SCORING_INTRO,
  SCORING_QUESTIONS,
  SCORING_TITLE,
  WHO_IS_RANKED,
  WHO_IS_RANKED_TITLE,
} from '../src/analysis/scoring.js';
import type { TopEntry } from '../src/city/protocol.js';
import { button, el } from './dom.js';
import { fileName } from './text.js';

/** The worked example for a top entry: its real sentences and percentiles. */
export function exampleOf(entry: TopEntry): ScoringExample {
  return { name: fileName(entry.path), score: entry.score, parts: entry.parts };
}

export class Explainer {
  private readonly root = el('div', 'explainer');
  private readonly sheet = el('section', 'explainer-sheet glass');
  private readonly body = el('div', 'explainer-body');
  private readonly closeButton: HTMLButtonElement;
  private returnTo: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.root.hidden = true;
    this.sheet.setAttribute('role', 'dialog');
    this.sheet.setAttribute('aria-modal', 'true');
    this.sheet.setAttribute('aria-labelledby', 'explainer-title');
    const head = el('div', 'explainer-head');
    const title = el('h2', 'explainer-title', SCORING_TITLE);
    title.id = 'explainer-title';
    this.closeButton = button(
      'hud-icon-button explainer-close',
      '×',
      () => {
        this.hide();
      },
      'Close (Esc)',
    );
    this.closeButton.setAttribute('aria-label', 'Close');
    this.closeButton.dataset.test = 'explainer-close';
    head.append(title, this.closeButton);
    // Focusable, so the arrow keys scroll it.
    this.body.tabIndex = 0;
    this.body.setAttribute('aria-label', SCORING_TITLE);
    this.sheet.append(head, this.body);
    this.sheet.addEventListener('keydown', (e) => {
      this.onKey(e);
    });
    // A click on the dimmed backdrop closes it too.
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.hide();
    });
    this.root.append(this.sheet);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** Opens the sheet; the example uses `entry` (the selected file, else #1) when there is one. */
  show(entry: TopEntry | undefined, window: number): void {
    this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.body.replaceChildren(...this.render(entry, window));
    this.root.hidden = false;
    this.closeButton.focus();
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.returnTo?.focus();
    this.returnTo = null;
  }

  private render(entry: TopEntry | undefined, window: number): HTMLElement[] {
    const parts: HTMLElement[] = [el('p', 'explainer-intro', SCORING_INTRO)];
    const questions = el('ol', 'explainer-questions');
    for (const q of SCORING_QUESTIONS) {
      const li = el('li', 'explainer-question');
      const line = el('p', 'explainer-q');
      line.append(
        el('span', 'explainer-q-text', q.question),
        el('span', 'explainer-weight num', `${String(q.weight)}%`),
      );
      li.append(line, el('p', 'detail', q.measure));
      questions.append(li);
    }
    parts.push(questions);
    if (entry) {
      const { lines, total } = exampleLines(exampleOf(entry));
      const section = el('section', 'explainer-section');
      section.append(
        el(
          'h3',
          'explainer-h3',
          `${EXAMPLE_TITLE}: ${fileName(entry.path)} (last ${String(window)} days)`,
        ),
      );
      const list = el('ul', 'explainer-list num');
      for (const line of lines) list.append(el('li', '', line));
      section.append(list, el('p', 'explainer-total', total));
      parts.push(section);
    }
    const who = el('section', 'explainer-section');
    who.append(el('h3', 'explainer-h3', WHO_IS_RANKED_TITLE), el('p', '', WHO_IS_RANKED));
    const bands = el('section', 'explainer-section');
    const bandList = el('ul', 'explainer-list');
    for (const line of BAND_LINES) bandList.append(el('li', '', line));
    bands.append(el('h3', 'explainer-h3', BANDS_TITLE), bandList, el('p', '', BANDS_NOTE));
    const not = el('section', 'explainer-section');
    const notList = el('ul', 'explainer-list');
    for (const line of NOT_LINES) notList.append(el('li', '', line));
    not.append(el('h3', 'explainer-h3', NOT_TITLE), notList);
    parts.push(who, bands, not);
    return parts;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
      return;
    }
    if (e.key !== 'Tab') return;
    // Focus stays inside: Tab and Shift+Tab move between Close and the (scrollable) text.
    e.preventDefault();
    (document.activeElement === this.closeButton ? this.body : this.closeButton).focus();
  }
}
