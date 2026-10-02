/** Creates an element with optional class and text (always `textContent`, never HTML). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A `<button type="button">` with a label, an optional tooltip and a click handler. */
export function button(
  className: string,
  label: string,
  onClick: (e: MouseEvent) => void,
  title?: string,
): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** Test mode: forces `prefers-reduced-motion` on or off; `undefined` follows the OS again. */
let forcedReducedMotion: boolean | undefined;
const reducedMotionListeners = new Set<() => void>();

export function forceReducedMotion(on: boolean | undefined): void {
  forcedReducedMotion = on;
  for (const listener of reducedMotionListeners) listener();
}

/** `prefers-reduced-motion: reduce`, read live (the part of `MediaQueryList` the city uses). */
export interface ReducedMotion {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
}

export const reducedMotionQuery = (): ReducedMotion => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  return {
    get matches() {
      return forcedReducedMotion ?? query.matches;
    },
    addEventListener(type, listener) {
      query.addEventListener(type, listener);
      reducedMotionListeners.add(listener);
    },
  };
};

/** Restarts a CSS entrance animation by removing the class, forcing a layout, and adding it back. */
export function replayClass(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  node.getBoundingClientRect();
  node.classList.add(className);
}
