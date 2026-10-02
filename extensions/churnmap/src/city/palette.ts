/**
 * The city's colour system. Stops are defined in OKLCH (perceptual lightness, chroma, hue) and
 * converted to sRGB once, when this module loads, by the small pure converter below; there is no
 * colour library. Browser-safe: the host, the three.js city, the 2D treemap and the postcard all
 * read their colours from here.
 *
 * - Eligible files are coloured by `heat` (0–100), not by their raw score: the relative band
 *   (Hotspot = top 5 %, Watch = next 15 %, Stable = the rest; `analysis/bands.ts`) picks a stretch
 *   of the ramp and the score places the file inside it, so #1 always gets the hottest colour.
 * - The ramp runs teal (calm) → amber (watch) → coral → hot magenta-red (hotspot). Lightness
 *   falls and chroma rises with the score, so the top of the ranking reads first. The teal → amber
 *   step passes through a near-neutral grey rather than round the hue wheel, so no score is drawn
 *   green (people read green as "healthy").
 * - Ineligible (unranked) files are low-chroma slate drawn at 55 % opacity ("glass"), so they recede.
 * - High contrast uses one flat colour per band, with a luminance ratio of at least 3:1 between
 *   neighbouring bands.
 * - Dark and light variants differ only in lightness, so each sits well on its editor background.
 */
import { BAND_RULES, HEAT_RANGES } from '../analysis/bands.js';
import type { Band } from '../analysis/model.js';
import type { Building } from './model.js';
import type { ThemeKind } from './protocol.js';

/** sRGB components, 0–255 (fractions allowed: three.js and canvas take them). */
export type RGB = readonly [number, number, number];

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma, 0 to about 0.37. */
  c: number;
  /** Hue angle, degrees. */
  h: number;
}

export type { Band };
export type PaletteVariant = 'dark' | 'light';

/**
 * The three bands the legend and cards name: where each starts on the colour ramp (`heat`) and
 * the rule that puts a file in it.
 */
export const BANDS: readonly { band: Band; label: string; from: number; rule: string }[] = [
  { band: 'stable', label: 'Stable', from: HEAT_RANGES.stable[0], rule: BAND_RULES.stable },
  { band: 'watch', label: 'Watch', from: HEAT_RANGES.watch[0], rule: BAND_RULES.watch },
  { band: 'hotspot', label: 'Hotspot', from: HEAT_RANGES.hotspot[0], rule: BAND_RULES.hotspot },
];

/** The band a colour position (`heat`) falls in; the heat ranges never overlap. */
export function bandOfHeat(heat: number): Band {
  if (heat >= HEAT_RANGES.hotspot[0]) return 'hotspot';
  if (heat >= HEAT_RANGES.watch[0]) return 'watch';
  return 'stable';
}

/** A building's (or top entry's) colour position: its heat, else its score (older data). */
export function heatOf(x: { heat?: number | undefined; score: number }): number {
  return x.heat ?? x.score;
}

export function bandLabel(band: Band): string {
  return BANDS.find((b) => b.band === band)?.label ?? 'Stable';
}

/** The eligible-file ramp, by score. Lightness strictly falls; chroma strictly rises. */
export const RAMP: Readonly<Record<PaletteVariant, readonly (Oklch & { score: number })[]>> = {
  // Stable stays teal until the Watch band starts at 60, then warms quickly.
  dark: [
    { score: 0, l: 0.8, c: 0.07, h: 200 },
    { score: 55, l: 0.79, c: 0.095, h: 180 },
    { score: 60, l: 0.77, c: 0.15, h: 75 },
    { score: 80, l: 0.69, c: 0.17, h: 35 },
    { score: 95, l: 0.62, c: 0.23, h: 10 },
  ],
  light: [
    { score: 0, l: 0.7, c: 0.07, h: 200 },
    { score: 55, l: 0.69, c: 0.095, h: 180 },
    { score: 60, l: 0.67, c: 0.145, h: 70 },
    { score: 80, l: 0.6, c: 0.175, h: 35 },
    { score: 95, l: 0.54, c: 0.215, h: 10 },
  ],
};

/** High contrast: one flat colour per band (luminance ratio ≥ 3:1 between neighbours). */
export const HIGH_CONTRAST: Readonly<Record<Band, Oklch>> = {
  stable: { l: 0.97, c: 0.035, h: 185 },
  watch: { l: 0.62, c: 0.13, h: 65 },
  hotspot: { l: 0.33, c: 0.13, h: 15 },
};

/** Unranked files: low-chroma slate, drawn at `GLASS_OPACITY`. */
export const GLASS: Readonly<Record<PaletteVariant, Oklch>> = {
  dark: { l: 0.56, c: 0.02, h: 255 },
  light: { l: 0.8, c: 0.015, h: 255 },
};
export const GLASS_OPACITY = 0.55;

/** Unranked files (and folded blocks with nothing ranked inside) are drawn as glass. */
export function isGlass(b: Pick<Building, 'why' | 'folded' | 'score'>): boolean {
  return b.why !== undefined || (b.folded !== undefined && b.score === 0);
}

// ---- OKLCH → sRGB (Björn Ottosson's OKLab matrices) ----

function oklabToLinear(l: number, a: number, b: number): [number, number, number] {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

function encode(v: number): number {
  const x = Math.min(1, Math.max(0, v));
  return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
}

function decode(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

const IN_GAMUT = 1e-6;

function linearAt(l: number, c: number, h: number): [number, number, number] {
  const r = (h * Math.PI) / 180;
  return oklabToLinear(l, c * Math.cos(r), c * Math.sin(r));
}

function inGamut(rgb: readonly number[]): boolean {
  return rgb.every((v) => v >= -IN_GAMUT && v <= 1 + IN_GAMUT);
}

/**
 * OKLCH → sRGB 0–255. Out-of-gamut colours keep their lightness and hue and lose chroma
 * (binary search) until they fit, so the ramp's lightness order survives the conversion.
 */
export function oklchToSrgb({ l, c, h }: Oklch): [number, number, number] {
  let chroma = c;
  if (!inGamut(linearAt(l, c, h))) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(linearAt(l, mid, h))) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  const [r, g, b] = linearAt(l, chroma, h);
  return [encode(r), encode(g), encode(b)];
}

/** sRGB 0–255 → OKLCH (for tests and contrast checks). */
export function srgbToOklch(rgb: RGB): Oklch {
  const r = decode(rgb[0]);
  const g = decode(rgb[1]);
  const b = decode(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

/** sRGB 0–255 → OKLab lightness (for tests and contrast checks). */
export function oklabLightness(rgb: RGB): number {
  return srgbToOklch(rgb).l;
}

/** WCAG relative luminance, 0–1. */
export function luminance(rgb: RGB): number {
  return 0.2126 * decode(rgb[0]) + 0.7152 * decode(rgb[1]) + 0.0722 * decode(rgb[2]);
}

/** WCAG contrast ratio between two colours, 1–21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** OKLCH at `t` (0–1) between two stops; hue takes the shorter way round. */
export function mixOklch(a: Oklch, b: Oklch, t: number): Oklch {
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return { l: a.l + (b.l - a.l) * t, c: a.c + (b.c - a.c) * t, h: (a.h + dh * t + 360) % 360 };
}

/** Hue steps wider than this (degrees) pass through grey instead of sweeping round the wheel. */
export const HUE_JUMP = 60;
/** The chroma at the grey midpoint of a wide hue step. */
export const NEUTRAL_CHROMA = 0.02;

/**
 * Between two ramp stops. A narrow hue step blends in OKLCH; a wide one (teal → amber) fades the
 * first colour to a near-neutral grey and then the second one in, keeping each end's hue, so the
 * blend never crosses the greens in between. Lightness always blends linearly.
 */
export function mixStops(a: Oklch, b: Oklch, t: number): Oklch {
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  if (Math.abs(dh) <= HUE_JUMP) return mixOklch(a, b, t);
  const l = a.l + (b.l - a.l) * t;
  if (t < 0.5) return { l, c: a.c + (NEUTRAL_CHROMA - a.c) * (t / 0.5), h: a.h };
  return { l, c: NEUTRAL_CHROMA + (b.c - NEUTRAL_CHROMA) * ((t - 0.5) / 0.5), h: b.h };
}

function rampOklch(variant: PaletteVariant, score: number): Oklch {
  const stops = RAMP[variant];
  const first = stops[0] ?? { score: 0, l: 0.7, c: 0, h: 0 };
  if (score <= first.score) return first;
  for (let i = 1; i < stops.length; i++) {
    const hi = stops[i];
    const lo = stops[i - 1];
    if (!hi || !lo) break;
    if (score <= hi.score) return mixStops(lo, hi, (score - lo.score) / (hi.score - lo.score));
  }
  return stops.at(-1) ?? first;
}

/** Scores carry one decimal, so a table of 1001 entries per variant is exact. */
const STEPS = 1000;

function table(variant: PaletteVariant): (readonly [number, number, number])[] {
  return Array.from({ length: STEPS + 1 }, (_, i) =>
    oklchToSrgb(rampOklch(variant, (i / STEPS) * 100)),
  );
}

/** Built once, when the module loads (the "build-time" conversion). */
const TABLES: Record<PaletteVariant, (readonly [number, number, number])[]> = {
  dark: table('dark'),
  light: table('light'),
};
const HC_RGB: Record<Band, RGB> = {
  stable: oklchToSrgb(HIGH_CONTRAST.stable),
  watch: oklchToSrgb(HIGH_CONTRAST.watch),
  hotspot: oklchToSrgb(HIGH_CONTRAST.hotspot),
};
const GLASS_RGB: Record<PaletteVariant, RGB> = {
  dark: oklchToSrgb(GLASS.dark),
  light: oklchToSrgb(GLASS.light),
};

export interface PaletteOptions {
  variant?: PaletteVariant;
  highContrast?: boolean;
}

/** The colour of an eligible file's heat (clamped to 0–100; NaN counts as 0). */
export function rampColour(heat: number, opts: PaletteOptions = {}): RGB {
  const s = Number.isFinite(heat) ? Math.min(100, Math.max(0, heat)) : 0;
  if (opts.highContrast === true) return HC_RGB[bandOfHeat(s)];
  const rows = TABLES[opts.variant ?? 'dark'];
  return rows[Math.round((s / 100) * STEPS)] ?? rows[0] ?? [0, 0, 0];
}

/** The unranked ("glass") colour; draw it at `GLASS_OPACITY`. */
export function glassColour(variant: PaletteVariant = 'dark'): RGB {
  return GLASS_RGB[variant];
}

/** The colour for the band, as the legend and rank badges show it. */
export function bandColour(band: Band, opts: PaletteOptions = {}): RGB {
  if (opts.highContrast === true) return HC_RGB[band];
  const from = BANDS.find((b) => b.band === band)?.from ?? 0;
  // The middle of the band (Hotspot: its hot end), so badges look like the buildings.
  const score = band === 'stable' ? 30 : band === 'watch' ? 72 : 95;
  return rampColour(Math.max(from, score), opts);
}

/** Light themes get the light variant; dark and high-contrast themes the dark one. */
export function variantOf(kind: ThemeKind): PaletteVariant {
  return kind === 'light' ? 'light' : 'dark';
}

/** `a` moved towards `b` by `t` (0–1), per channel. */
export function mixRgb(a: RGB, b: RGB, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The backdrop: a soft vertical gradient from the editor background, a touch lighter at the top
 * (towards the foreground) and a touch deeper at the bottom.
 */
export function backgroundGradient(background: RGB, foreground: RGB): [RGB, RGB] {
  const dark = luminance(background) < luminance(foreground);
  const top = mixRgb(background, foreground, dark ? 0.07 : 0.03);
  const bottom = mixRgb(background, dark ? [0, 0, 0] : [214, 222, 232], dark ? 0.35 : 0.35);
  return [top, bottom];
}

/** `rgb(r, g, b)` or `rgba(r, g, b, a)`, rounded. */
export function rgbCss(rgb: RGB, alpha?: number): string {
  const [r, g, b] = rgb.map((v) => String(Math.round(v)));
  return alpha === undefined
    ? `rgb(${r ?? '0'}, ${g ?? '0'}, ${b ?? '0'})`
    : `rgba(${r ?? '0'}, ${g ?? '0'}, ${b ?? '0'}, ${String(alpha)})`;
}
