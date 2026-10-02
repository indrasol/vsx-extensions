import type { ThemeKind } from '../src/city/protocol.js';

export type RGB = readonly [number, number, number];

/** Colours the views take from the editor theme (VS Code sets these CSS variables on the page). */
export interface ThemeColours {
  kind: ThemeKind;
  background: RGB;
  foreground: RGB;
  /** The focus ring colour; also the 2D view's outline for top hotspots. */
  focus: RGB;
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Parses any CSS colour through a 2D context, which normalises it to `#rrggbb` or `rgba(…)`. */
export function parseCssColour(text: string, fallback: RGB): RGB {
  const value = text.trim();
  if (!value) return fallback;
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe) return fallback;
  probe.fillStyle = '#010203';
  probe.fillStyle = value;
  const normal = probe.fillStyle;
  if (normal === '#010203' && value.toLowerCase() !== '#010203') return fallback;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(normal);
  if (hex)
    return [parseInt(hex[1] ?? '0', 16), parseInt(hex[2] ?? '0', 16), parseInt(hex[3] ?? '0', 16)];
  const rgb = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(normal);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return fallback;
}

export function readTheme(kind: ThemeKind): ThemeColours {
  const style = getComputedStyle(document.body);
  const dark = kind !== 'light';
  return {
    kind,
    background: parseCssColour(
      style.getPropertyValue('--vscode-editor-background'),
      dark ? [30, 30, 30] : [255, 255, 255],
    ),
    foreground: parseCssColour(
      style.getPropertyValue('--vscode-editor-foreground'),
      dark ? [212, 212, 212] : [51, 51, 51],
    ),
    focus: parseCssColour(style.getPropertyValue('--vscode-focusBorder'), [0, 127, 212]),
  };
}

/** `a` moved towards `b` by `t` (0–1), per channel. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
