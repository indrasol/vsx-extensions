/**
 * Relative bands. A file's band is its position among the ranked (eligible, not ignored) files,
 * never a fixed score: the top 5 % are Hotspot (at least the top 3, at most 20), the next 15 %
 * Watch, the rest Stable. So the #1 file is always a Hotspot, however its score compares with
 * other repositories.
 *
 * The score stays 0–100 and says how strongly a file stands out. Colour uses `heat`: the band
 * picks a range of the colour ramp (Stable 0–55, Watch 60–84.9, Hotspot 85–100) and the score
 * places the file within it, so #1 always gets the hottest colour. Pure and browser-safe.
 */
import type { Band, FileScore } from './model.js';

export type { Band };

/** Share of the ranked files in the Hotspot band, and its floor and cap. */
export const HOTSPOT_SHARE = 0.05;
export const MIN_HOTSPOTS = 3;
export const MAX_HOTSPOTS = 20;
/** Share of the ranked files in the Watch band (after the hotspots). */
export const WATCH_SHARE = 0.15;

/** Where each band sits on the colour ramp (`heat`, 0–100). */
export const HEAT_RANGES: Readonly<Record<Band, readonly [number, number]>> = {
  stable: [0, 55],
  watch: [60, 84.9],
  hotspot: [85, 100],
};

/** How many of `n` ranked files are Hotspot and Watch; the rest are Stable. */
export function bandSizes(n: number): { hotspot: number; watch: number; stable: number } {
  const count = Math.max(0, Math.floor(n));
  const hotspot = Math.min(
    count,
    Math.max(MIN_HOTSPOTS, Math.min(MAX_HOTSPOTS, Math.ceil(HOTSPOT_SHARE * count))),
  );
  const watch = Math.min(count - hotspot, Math.ceil(WATCH_SHARE * count));
  return { hotspot, watch, stable: count - hotspot - watch };
}

/** The band of the file at 1-based `position` among `n` ranked files. */
export function bandAt(position: number, n: number): Band {
  const sizes = bandSizes(n);
  if (position <= sizes.hotspot) return 'hotspot';
  if (position <= sizes.hotspot + sizes.watch) return 'watch';
  return 'stable';
}

/** The ranking order (`rank` uses it too): score desc, then commits desc, then path asc. */
export function compareRanked(
  a: Pick<FileScore, 'score' | 'commits' | 'path'>,
  b: Pick<FileScore, 'score' | 'commits' | 'path'>,
): number {
  // Code-unit order for the path, never locale order, so every machine agrees.
  return (
    b.score - a.score || b.commits - a.commits || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Every file with its `position`, `band` and `heat` filled in from its place among the ranked
 * files (eligible and not in `ignored`). Other files have none of the three; an ignored file that
 * would rank keeps a calm heat (its score squeezed into the Stable range) so it never glows.
 */
export function withBands(
  files: readonly FileScore[],
  ignored: ReadonlySet<string> = new Set(),
): FileScore[] {
  const ranked = files.filter((f) => f.eligible && !ignored.has(f.path)).sort(compareRanked);
  const n = ranked.length;
  const placed = new Map<string, { position: number; band: Band }>();
  ranked.forEach((f, i) => placed.set(f.path, { position: i + 1, band: bandAt(i + 1, n) }));

  // The score range inside each band, so the band's best file gets its range's top colour.
  const spans = new Map<Band, { lo: number; hi: number }>();
  for (const f of ranked) {
    const band = placed.get(f.path)?.band ?? 'stable';
    const span = spans.get(band);
    if (!span) spans.set(band, { lo: f.score, hi: f.score });
    else {
      span.lo = Math.min(span.lo, f.score);
      span.hi = Math.max(span.hi, f.score);
    }
  }

  return files.map((f) => {
    const rest = { ...f };
    delete rest.position;
    delete rest.band;
    delete rest.heat;
    const place = placed.get(f.path);
    if (!place) {
      return f.eligible && ignored.has(f.path)
        ? { ...rest, heat: round1((HEAT_RANGES.stable[1] * f.score) / 100) }
        : rest;
    }
    const [from, to] = HEAT_RANGES[place.band];
    const span = spans.get(place.band) ?? { lo: f.score, hi: f.score };
    // Stable fades from 0; Watch and Hotspot spread their own score range over their colours.
    const lo = place.band === 'stable' ? 0 : span.lo;
    const t = span.hi > lo ? (f.score - lo) / (span.hi - lo) : 1;
    return {
      ...rest,
      position: place.position,
      band: place.band,
      heat: round1(from + (to - from) * t),
    };
  });
}

/** A file's band; files outside the ranking (unranked or ignored) count as Stable. */
export function bandOfFile(file: Pick<FileScore, 'band'>): Band {
  return file.band ?? 'stable';
}

/**
 * The legend's and the explainer's rule for each band (literal text; a unit test keeps it in
 * step with the shares above).
 */
export const BAND_RULES: Readonly<Record<Band, string>> = {
  hotspot: 'top 5 % of your code files (at least 3, at most 20)',
  watch: 'the next 15 %',
  stable: 'the rest',
};
