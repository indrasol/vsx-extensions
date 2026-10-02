/**
 * Inline SVG built with `createElementNS` (no markup strings, no image files): the reason icons
 * and the weekly-commits sparkline. Strokes use `currentColor`, so CSS colours them.
 */
import type { Component } from '../src/analysis/model.js';

/** The SVG XML namespace name `createElementNS` requires; an identifier, never fetched. */
export const SVG_NS = 'http://www.w3.org/2000/svg';
const NS = SVG_NS;

export type IconKey = Component | 'info';

/** 16×16 stroke paths, one per reason. */
const ICONS: Record<IconKey, string[]> = {
  // A pulse line: how often it changes.
  frequency: ['M1 8h3l2-5 4 10 2-5h3'],
  // Two arrows chasing each other: rewritten over and over.
  relChurn: ['M3 7a5 5 0 0 1 9-2', 'M12 2v3H9', 'M13 9a5 5 0 0 1-9 2', 'M4 14v-3h3'],
  // Stacked layers: nesting depth.
  complexity: ['M8 2 2 5l6 3 6-3z', 'M2 8l6 3 6-3', 'M2 11l6 3 6-3'],
  // Two heads: how many people.
  authors: [
    'M6 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    'M1.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4',
    'M11 3.2a2.3 2.3 0 0 1 0 4.4',
    'M12.5 10.2c1.3.6 2 1.9 2 3.8',
  ],
  // A bug.
  fixRatio: [
    'M5 6h6v5a3 3 0 0 1-6 0z',
    'M6 6a2 2 0 0 1 4 0',
    'M2 8h3M11 8h3M2.5 12.5 5 11M13.5 12.5 11 11M8 7v7',
  ],
  info: ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z', 'M8 7v4', 'M8 5h.01'],
};

export function icon(key: IconKey, size = 14): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  for (const d of ICONS[key]) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

/**
 * The sparkline's polyline points for `values` in a `width` × `height` box with `pad` inside:
 * x spreads evenly, y is 0 at the bottom and the largest value at the top.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): [number, number][] {
  if (values.length === 0) return [];
  const max = Math.max(1, ...values);
  const span = values.length > 1 ? (width - 2 * pad) / (values.length - 1) : 0;
  return values.map((v, i) => {
    const x = values.length > 1 ? pad + i * span : width / 2;
    const y = height - pad - (Math.max(0, v) / max) * (height - 2 * pad);
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  });
}

/** A 120×24 sparkline of weekly commits: a line, a soft area under it and a dot on the last week. */
export function sparkline(values: readonly number[], width = 120, height = 24): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('aria-hidden', 'true');
  const points = sparklinePoints(values, width, height);
  if (points.length === 0) return svg;
  const line = points.map(([x, y]) => `${String(x)},${String(y)}`).join(' ');
  const first = points[0] ?? [0, height];
  const last = points.at(-1) ?? first;
  const area = document.createElementNS(NS, 'polygon');
  area.setAttribute(
    'points',
    `${String(first[0])},${String(height)} ${line} ${String(last[0])},${String(height)}`,
  );
  area.setAttribute('fill', 'currentColor');
  area.setAttribute('fill-opacity', '0.14');
  const stroke = document.createElementNS(NS, 'polyline');
  stroke.setAttribute('points', line);
  stroke.setAttribute('fill', 'none');
  stroke.setAttribute('stroke', 'currentColor');
  stroke.setAttribute('stroke-width', '1.5');
  stroke.setAttribute('stroke-linejoin', 'round');
  stroke.setAttribute('stroke-linecap', 'round');
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', String(last[0]));
  dot.setAttribute('cy', String(last[1]));
  dot.setAttribute('r', '2');
  dot.setAttribute('fill', 'currentColor');
  svg.append(area, stroke, dot);
  return svg;
}
