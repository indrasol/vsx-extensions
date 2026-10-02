import type { TopEntry } from '../src/city/protocol.js';

export interface ListHandlers {
  /** Enter (or double-click): open the file. */
  onOpen(path: string): void;
  /** Space (or click): fly the camera there and show its card. */
  onFly(path: string): void;
  /** Escape: the list closed; focus goes back to the city. */
  onClose(): void;
}

/** `#rank path — score`: rank and score in text, so colour is never the only channel. */
export function optionLabel(entry: TopEntry): string {
  return `#${String(entry.rank)} ${entry.path} — ${entry.score.toFixed(1)}`;
}

/** The attributes and text of one listbox option (pure, so the a11y contract is unit-tested). */
export function optionSpec(
  entry: TopEntry,
  index: number,
): { id: string; role: 'option'; text: string; description: string } {
  return {
    id: `hotspot-option-${String(index)}`,
    role: 'option',
    text: optionLabel(entry),
    description: entry.reasons.length > 0 ? entry.reasons.join('; ') : 'No reasons recorded',
  };
}

/**
 * The "Top hotspots" overlay: a listbox (`aria-activedescendant` pattern) of the ranked files.
 * Each option carries its reasons in `aria-description` for assistive technology.
 */
export class TopList {
  readonly root: HTMLElement;
  private readonly list: HTMLOListElement;
  private entries: TopEntry[] = [];
  private active = 0;

  constructor(
    parent: HTMLElement,
    private readonly handlers: ListHandlers,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'toplist';
    this.root.hidden = true;
    const heading = document.createElement('h2');
    heading.id = 'toplist-heading';
    heading.textContent = 'Top hotspots';
    this.list = document.createElement('ol');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-labelledby', 'toplist-heading');
    this.list.tabIndex = 0;
    this.list.addEventListener('keydown', (e) => {
      this.onKey(e);
    });
    this.list.addEventListener('click', (e) => {
      const index = this.indexOf(e.target);
      if (index === undefined) return;
      this.setActive(index);
      const entry = this.entries[index];
      if (entry) this.handlers.onFly(entry.path);
    });
    this.list.addEventListener('dblclick', (e) => {
      const entry = this.entries[this.indexOf(e.target) ?? -1];
      if (entry) this.handlers.onOpen(entry.path);
    });
    this.root.append(heading, this.list);
    parent.append(this.root);
  }

  setEntries(entries: TopEntry[]): void {
    this.entries = entries;
    this.active = 0;
    this.list.replaceChildren(
      ...entries.map((entry, i) => {
        const spec = optionSpec(entry, i);
        const li = document.createElement('li');
        li.id = spec.id;
        li.setAttribute('role', spec.role);
        li.dataset.index = String(i);
        li.textContent = spec.text;
        li.setAttribute('aria-description', spec.description);
        return li;
      }),
    );
    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'toplist-empty';
      empty.textContent = 'No hotspots in this window.';
      this.list.append(empty);
    }
    this.setActive(0);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Shows or hides the list; showing moves focus into it. */
  toggle(force?: boolean): void {
    const open = force ?? !this.isOpen;
    this.root.hidden = !open;
    if (open) this.list.focus();
  }

  private indexOf(target: EventTarget | null): number | undefined {
    const li = target instanceof Element ? target.closest('li[role="option"]') : null;
    const index = li instanceof HTMLElement ? Number(li.dataset.index) : Number.NaN;
    return Number.isInteger(index) ? index : undefined;
  }

  private setActive(index: number): void {
    if (this.entries.length === 0) {
      this.list.removeAttribute('aria-activedescendant');
      return;
    }
    this.active = Math.max(0, Math.min(index, this.entries.length - 1));
    const options = this.list.querySelectorAll('li[role="option"]');
    options.forEach((option, i) => {
      option.setAttribute('aria-selected', i === this.active ? 'true' : 'false');
    });
    const current = options[this.active];
    if (current) {
      this.list.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    }
  }

  private onKey(e: KeyboardEvent): void {
    const entry = this.entries[this.active];
    switch (e.key) {
      case 'ArrowDown':
        this.setActive(this.active + 1);
        break;
      case 'ArrowUp':
        this.setActive(this.active - 1);
        break;
      case 'Home':
        this.setActive(0);
        break;
      case 'End':
        this.setActive(this.entries.length - 1);
        break;
      case 'Enter':
        if (entry) this.handlers.onOpen(entry.path);
        break;
      case ' ':
        if (entry) this.handlers.onFly(entry.path);
        break;
      case 'Escape':
        this.toggle(false);
        this.handlers.onClose();
        break;
      default:
        return; // let T, 2 and Tab reach the page
    }
    e.preventDefault();
    e.stopPropagation();
  }
}
