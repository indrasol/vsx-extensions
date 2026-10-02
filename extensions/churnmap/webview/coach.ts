import { button, el, replayClass } from './dom.js';

/** The one line that says how to move around (the coach mark's first tip and ? Controls). */
export const CONTROLS_LINE =
  'Drag to rotate · Right-drag or Shift-drag to move · Scroll to zoom · F to fit';

/** Every way to move around and act, for ⋯ → ? Controls (the README has the same table). */
export const CONTROLS: readonly (readonly [string, string])[] = [
  ['Drag', 'Rotate (2D: move)'],
  ['Right-drag, middle-drag, Shift + drag or Space + drag', 'Move the city'],
  ['Two-finger trackpad drag', 'Move the city'],
  ['Scroll or pinch', 'Zoom towards the pointer'],
  ['Arrow keys', 'Move the city'],
  ['Alt + arrow keys', 'Rotate'],
  ['+ / −', 'Zoom'],
  ['F or Home', 'Fit the city into the space the panels leave'],
  ['Click · double-click or Enter', 'Select · open the file'],
  ['Space (tap)', 'Fly to the building under the pointer'],
  ['A · C · T · 2 · Escape', 'AI prompt · collapse the card · list · 3D/2D · clear'],
];

/** The first-run tips, one per step. */
export const COACH_STEPS: readonly { title: string; text: string }[] = [
  {
    title: 'Move around the city',
    text: CONTROLS_LINE,
  },
  {
    title: 'Taller = bigger file',
    text: 'Each building is a file; its height is its lines of code.',
  },
  {
    title: 'Hotter colour = more risk',
    text: 'Magenta-red is a Hotspot (the top 5 % of your code files), amber needs watching, teal is stable. Grey glass is not ranked.',
  },
  {
    title: 'Click a building to select it',
    text: 'Its card says why it ranks. Double-click or press Enter to open the file; T lists them all.',
  },
  {
    title: '✦ AI prompt',
    text: 'Turns any hotspot into a ready-to-paste prompt for your own AI agent (Cursor, Copilot, Claude Code…). “How is this scored?” on the card explains the numbers.',
  },
];

/**
 * The coach mark over the city, one tip per step. Dismissible (Skip, Escape, or Done on the last step);
 * focus moves into it when it opens and back to `returnFocus` when it closes.
 */
export class CoachMark {
  private readonly root = el('div', 'coach');
  private readonly panel = el('section', 'coach-panel glass');
  private readonly counter = el('p', 'coach-counter num');
  private readonly title = el('h2', 'coach-title');
  private readonly text = el('p', 'coach-text');
  private readonly dots = el('div', 'coach-dots');
  private readonly next: HTMLButtonElement;
  private step = 0;

  constructor(
    parent: HTMLElement,
    private readonly returnFocus: () => HTMLElement | undefined,
  ) {
    this.root.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    this.panel.setAttribute('aria-labelledby', 'coach-title');
    this.title.id = 'coach-title';
    const skip = button('coach-skip', 'Skip', () => {
      this.hide();
    });
    this.next = button('coach-next', 'Next', () => {
      if (this.step >= COACH_STEPS.length - 1) this.hide();
      else this.show(this.step + 1);
    });
    const actions = el('div', 'coach-actions');
    actions.append(skip, this.next);
    this.panel.append(this.counter, this.title, this.text, this.dots, actions);
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hide();
      }
    });
    this.root.append(this.panel);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(step = 0): void {
    this.step = Math.max(0, Math.min(step, COACH_STEPS.length - 1));
    const tip = COACH_STEPS[this.step];
    this.counter.textContent = `Tip ${String(this.step + 1)} of ${String(COACH_STEPS.length)}`;
    this.title.textContent = tip?.title ?? '';
    this.text.textContent = tip?.text ?? '';
    this.dots.replaceChildren(
      ...COACH_STEPS.map((_, i) => el('span', i === this.step ? 'coach-dot active' : 'coach-dot')),
    );
    this.next.textContent = this.step === COACH_STEPS.length - 1 ? 'Done' : 'Next';
    const wasHidden = this.root.hidden;
    this.root.hidden = false;
    if (wasHidden) {
      replayClass(this.panel, 'enter');
    }
    this.next.focus();
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.returnFocus()?.focus();
  }
}

/** ⋯ → ? Controls: every control in one sheet (Escape, × or the backdrop closes it). */
export class ControlsHelp {
  private readonly root = el('div', 'explainer controls-help');
  private readonly closeButton: HTMLButtonElement;
  private returnTo: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.root.hidden = true;
    const sheet = el('section', 'explainer-sheet glass');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'controls-title');
    const head = el('div', 'explainer-head');
    const title = el('h2', 'explainer-title', 'Controls');
    title.id = 'controls-title';
    this.closeButton = button(
      'hud-icon-button explainer-close',
      '×',
      () => {
        this.hide();
      },
      'Close (Esc)',
    );
    this.closeButton.setAttribute('aria-label', 'Close');
    this.closeButton.dataset.test = 'controls-close';
    head.append(title, this.closeButton);
    const body = el('div', 'explainer-body');
    const table = el('table', 'controls-table');
    for (const [keys, action] of CONTROLS) {
      const row = el('tr');
      row.append(el('th', '', keys), el('td', '', action));
      table.append(row);
    }
    body.append(el('p', 'explainer-intro', CONTROLS_LINE), table);
    sheet.append(head, body);
    sheet.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.hide();
    });
    this.root.append(sheet);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    this.closeButton.focus();
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.returnTo?.focus();
    this.returnTo = null;
  }
}
