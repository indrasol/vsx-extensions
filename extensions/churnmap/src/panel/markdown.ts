import type { Hotspot, Window } from '../analysis/model.js';
import { bandOfFile } from '../analysis/bands.js';
import { trendText } from '../analysis/explain.js';
import { bandLabel } from '../city/palette.js';
import { wholeScore } from './hotspotTree.js';

export const MARKDOWN_FOOTER = 'Made with Churnmap · Indrasol Labs';

export interface MarkdownInput {
  repoName: string;
  window: Window;
  /** Local date, `yyyy-mm-dd`. */
  date: string;
  top: readonly Hotspot[];
}

/** One table cell: `|` escaped, line breaks and runs of whitespace collapsed. */
export function tableCell(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/** `yyyy-mm-dd` in local time. */
export function localDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The hotspots as a GitHub-flavoured Markdown table, for pasting into an issue or a chat:
 * a header line, `| # | File | Score | Trend | Why | Owners |` (the reasons as plain sentences),
 * and the credit line.
 */
export function hotspotsMarkdown(input: MarkdownInput): string {
  const header = `**Churnmap hotspots** — ${tableCell(input.repoName)} · last ${String(input.window)} days · ${input.date}`;
  if (input.top.length === 0) {
    return [header, '', 'No hotspots yet.', '', MARKDOWN_FOOTER, ''].join('\n');
  }
  const rows = input.top.map((h) =>
    [
      String(h.rank),
      tableCell(h.file.path),
      `${wholeScore(h.file.score)} (${bandLabel(bandOfFile(h.file))})`,
      tableCell(trendText(h.trend) || '—'),
      tableCell(h.reasons.map((r) => r.text).join('; ')),
      tableCell(h.file.owners.slice(0, 2).join(', ')),
    ].join(' | '),
  );
  return [
    header,
    '',
    '| # | File | Score | Trend | Why | Owners |',
    '| --: | --- | --: | --- | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    '',
    MARKDOWN_FOOTER,
    '',
  ].join('\n');
}

/** "Copied 20 hotspots as Markdown." */
export function copiedMessage(count: number): string {
  return `Copied ${String(count)} ${count === 1 ? 'hotspot' : 'hotspots'} as Markdown.`;
}
