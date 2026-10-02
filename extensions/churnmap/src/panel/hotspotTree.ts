/**
 * The Hotspots tree's model: which nodes exist and how each one is labelled. Pure (no `vscode`
 * import), so every label, description and screen-reader string is unit-tested; `HotspotsView`
 * turns an `ItemSpec` into a `TreeItem`.
 */
import { bandOfFile } from '../analysis/bands.js';
import { TREND_TOOLTIP, trendText as explainTrend } from '../analysis/explain.js';
import type { Band, Hotspot, IgnoredFile, Reason, Trend, Window } from '../analysis/model.js';
import { bandLabel } from '../city/palette.js';
import { daysLeft, reasonText, untilDate } from './ignore.js';

export type HotspotNode =
  | { kind: 'hotspot'; hotspot: Hotspot }
  | { kind: 'reason'; parent: string; reason: Reason }
  | { kind: 'meta'; parent: string; text: string }
  /** "Ignored (N)", after the ranked list; only when something is ignored. */
  | { kind: 'ignoredGroup'; count: number }
  | { kind: 'ignored'; entry: IgnoredFile };

/** Everything a tree item shows, as plain data. */
export interface ItemSpec {
  /** Stable across refreshes, so expansion and selection survive a rebuild. */
  id: string;
  label: string;
  description?: string;
  /** A codicon id. */
  icon: string;
  /** A theme colour id for the icon. */
  iconColor?: string;
  contextValue: string;
  /** A full sentence without icons or arrows. */
  accessibilityLabel: string;
  collapsible: boolean;
}

/** Icon colour by relative band (Hotspot = top 5 %, Watch = next 15 %), like the city. */
export function bandColor(band: Band): string {
  if (band === 'hotspot') return 'charts.red';
  if (band === 'watch') return 'charts.orange';
  return 'charts.foreground';
}

/** Scores are shown whole in the tree; the tooltip has one decimal. */
export function wholeScore(score: number): string {
  return String(Math.round(score));
}

/** "Complexity rising ↑", "Complexity steady", …, or `—` when the trend could not be computed. */
export function trendText(trend: Trend): string {
  return explainTrend(trend) || '—';
}

/** The trend in words, for screen readers. */
export function trendWords(trend: Trend): string {
  switch (trend) {
    case 'rising':
      return 'complexity rising';
    case 'falling':
      return 'complexity falling';
    case 'flat':
      return 'complexity steady';
    case 'unknown':
      return 'trend unknown';
  }
}

/** `#3  billing/invoice.ts`. */
export function hotspotLabel(hotspot: Hotspot): string {
  return `#${String(hotspot.rank)}  ${hotspot.file.path}`;
}

/** `Hotspot 82 · Complexity rising ↑ · alice, bob` (band, score, trend, up to two owners). */
export function hotspotDescription(hotspot: Hotspot): string {
  const parts = [
    `${bandLabel(bandOfFile(hotspot.file))} ${wholeScore(hotspot.file.score)}`,
    trendText(hotspot.trend),
  ];
  const owners = hotspot.file.owners.slice(0, 2);
  if (owners.length > 0) parts.push(owners.join(', '));
  return parts.join(' · ');
}

/** "Hotspot rank 3, billing/invoice.ts, score 82, rising; reasons: …; owners: …." */
export function hotspotAccessibilityLabel(hotspot: Hotspot): string {
  const reasons = hotspot.reasons.map((r) => r.text).join('; ');
  const owners = hotspot.file.owners.slice(0, 2);
  return (
    `Rank ${String(hotspot.rank)}, ${hotspot.file.path}, ${bandLabel(bandOfFile(hotspot.file))}, score ${wholeScore(hotspot.file.score)}, ` +
    `${trendWords(hotspot.trend)}; reasons: ${reasons || 'none'}` +
    (owners.length > 0 ? `; owners: ${owners.join(', ')}.` : '.')
  );
}

/** Escapes Markdown punctuation so a path or reason is shown literally. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

/** The hover tooltip: the full reason list, lines, commits and window. Markdown, no HTML. */
export function hotspotTooltip(hotspot: Hotspot, window: Window): string {
  const { file } = hotspot;
  const trend = explainTrend(hotspot.trend);
  const lines = [
    `**#${String(hotspot.rank)} ${escapeMarkdown(file.path)}**`,
    '',
    `${bandLabel(bandOfFile(file))} · score ${file.score.toFixed(1)}`,
    '',
    ...hotspot.reasons.map((r) => `- ${escapeMarkdown(r.text)} (${escapeMarkdown(r.detail)})`),
    '',
    `${file.loc.toLocaleString('en-US')} lines · People ${String(file.authors)} · changed ${String(file.commits)} times in the last ${String(window)} days`,
  ];
  if (trend) lines.push('', `${escapeMarkdown(trend)} (${TREND_TOOLTIP})`);
  if (file.owners.length > 0) {
    lines.push('', `Owners: ${file.owners.map(escapeMarkdown).join(', ')}`);
  }
  return lines.join('\n');
}

/** A hotspot's children: one node per reason, then "folded: N files" when the city folds it. */
export function hotspotChildren(hotspot: Hotspot, foldedFiles?: number): HotspotNode[] {
  const parent = hotspot.file.path;
  const children: HotspotNode[] = hotspot.reasons.map((reason) => ({
    kind: 'reason',
    parent,
    reason,
  }));
  if (foldedFiles !== undefined && foldedFiles > 0) {
    children.push({ kind: 'meta', parent, text: `folded: ${String(foldedFiles)} files` });
  }
  return children;
}

/** The path of the file a node belongs to; undefined for the "Ignored" group. */
export function nodePath(node: HotspotNode): string | undefined {
  switch (node.kind) {
    case 'hotspot':
      return node.hotspot.file.path;
    case 'reason':
    case 'meta':
      return node.parent;
    case 'ignored':
      return node.entry.path;
    case 'ignoredGroup':
      return undefined;
  }
}

/**
 * The path a command was invoked for: a string (palette, city, keybinding) or the tree node an
 * inline action passes. Anything else is undefined; callers validate the path again.
 */
export function argPath(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  if (typeof arg !== 'object' || arg === null || !('kind' in arg)) return undefined;
  const node = arg as Partial<HotspotNode>;
  if (node.kind === 'hotspot') {
    const path: unknown = node.hotspot?.file.path;
    return typeof path === 'string' ? path : undefined;
  }
  if (node.kind === 'reason' || node.kind === 'meta') {
    return typeof node.parent === 'string' ? node.parent : undefined;
  }
  if (node.kind === 'ignored') {
    const path: unknown = node.entry?.path;
    return typeof path === 'string' ? path : undefined;
  }
  return undefined;
}

/** `now` (ms since the epoch) words the days left on ignored entries. */
export function itemSpec(node: HotspotNode, now: number = Date.now()): ItemSpec {
  switch (node.kind) {
    case 'hotspot': {
      const { hotspot } = node;
      return {
        id: `hotspot:${hotspot.file.path}`,
        label: hotspotLabel(hotspot),
        description: hotspotDescription(hotspot),
        icon: 'flame',
        iconColor: bandColor(bandOfFile(hotspot.file)),
        contextValue: 'hotspot',
        accessibilityLabel: hotspotAccessibilityLabel(hotspot),
        collapsible: true,
      };
    }
    case 'reason':
      return {
        id: `reason:${node.parent}:${node.reason.component}`,
        label: node.reason.text,
        description: node.reason.detail,
        icon: 'info',
        contextValue: 'reason',
        accessibilityLabel: `Reason: ${node.reason.text}, ${node.reason.detail}`,
        collapsible: false,
      };
    case 'meta':
      return {
        id: `meta:${node.parent}`,
        label: node.text,
        icon: 'fold',
        contextValue: 'meta',
        accessibilityLabel: `In the city, ${node.parent} is drawn inside a block that stands for a whole folder: ${node.text}.`,
        collapsible: false,
      };
    case 'ignoredGroup':
      return {
        id: 'ignored',
        label: `Ignored (${String(node.count)})`,
        icon: 'eye-closed',
        contextValue: 'ignoredGroup',
        accessibilityLabel: `Ignored hotspots: ${String(node.count)}. Expand to see why, and to un-ignore them.`,
        collapsible: true,
      };
    case 'ignored': {
      const { entry } = node;
      const days = daysLeft(entry, now);
      return {
        id: `ignored:${entry.path}`,
        label: entry.path,
        description: `${String(days)} d left · ${reasonText(entry)}`,
        icon: 'eye-closed',
        contextValue: 'ignoredHotspot',
        accessibilityLabel: `Ignored ${entry.path} until ${untilDate(entry)}, ${String(days)} days left; reason: ${reasonText(entry)}.`,
        collapsible: false,
      };
    }
  }
}
