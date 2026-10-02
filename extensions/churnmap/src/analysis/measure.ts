/**
 * Pure size and indentation-complexity measures (README: How scoring works). Bundled into both the
 * extension and the worker.
 */

const BINARY_SNIFF_BYTES = 8 * 1024;
/** Lines longer than this (minified or generated) count as depth 0 and do not set the indent unit. */
export const LONG_LINE = 10_000;
const FALLBACK_INDENT_UNIT = 4;
const MIN_INDENT_UNIT = 2;
const MAX_INDENT_UNIT = 8;

/** True when the first 8 KiB contain a NUL byte. */
export function isBinary(buf: Buffer): boolean {
  const end = Math.min(buf.length, BINARY_SNIFF_BYTES);
  return buf.subarray(0, end).includes(0);
}

export interface TextMeasure {
  /** Non-blank lines. */
  loc: number;
  maxDepth: number;
  /** Mean depth over non-blank lines, rounded to 3 decimals. */
  meanDepth: number;
  /** 0.6 · maxDepth + 0.4 · meanDepth (unrounded mean), rounded to 3 decimals. */
  complexity: number;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Indentation complexity. Blank (whitespace-only) lines are ignored. A line's depth is its
 * leading tabs plus its leading spaces divided by the file's indent unit, rounded down. The unit
 * is the most common positive difference between consecutive non-blank lines' leading-space
 * counts (ties go to the smaller difference), clamped to [2, 8]; 4 when there is none.
 * Block-comment bodies (first non-space character `*`) and very long lines do not take part in
 * finding the unit, so a JSDoc ` * ` line cannot shrink it to 1.
 */
export function measureText(text: string): TextMeasure {
  const tabs: number[] = [];
  const spaces: number[] = [];
  let loc = 0;
  /** How often each positive leading-space difference occurs. */
  const diffs = new Map<number, number>();
  let previousSpaces: number | undefined;

  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim().length === 0) continue;
    loc += 1;
    if (line.length > LONG_LINE) {
      tabs.push(0);
      spaces.push(-1); // depth 0, not used for the unit
      continue;
    }
    let t = 0;
    let s = 0;
    for (let i = 0; i < line.length; i++) {
      const code = line.charCodeAt(i);
      if (code === 0x09) t += 1;
      else if (code === 0x20) s += 1;
      else break;
    }
    tabs.push(t);
    spaces.push(s);
    if (line.charCodeAt(t + s) === 0x2a) continue; // `*`: a block-comment body line
    if (previousSpaces !== undefined) {
      const diff = Math.abs(s - previousSpaces);
      if (diff > 0) diffs.set(diff, (diffs.get(diff) ?? 0) + 1);
    }
    previousSpaces = s;
  }

  if (loc === 0) return { loc: 0, maxDepth: 0, meanDepth: 0, complexity: 0 };
  const indentUnit = indentUnitFrom(diffs);
  let maxDepth = 0;
  let total = 0;
  for (let i = 0; i < loc; i++) {
    const s = spaces[i] ?? 0;
    const depth = s < 0 ? 0 : (tabs[i] ?? 0) + Math.floor(s / indentUnit);
    if (depth > maxDepth) maxDepth = depth;
    total += depth;
  }
  const mean = total / loc;
  return {
    loc,
    maxDepth,
    meanDepth: round3(mean),
    complexity: round3(0.6 * maxDepth + 0.4 * mean),
  };
}

/** The mode of the differences (ties → smaller), clamped to [2, 8]; 4 when there are none. */
function indentUnitFrom(diffs: ReadonlyMap<number, number>): number {
  let unit = 0;
  let best = 0;
  for (const [diff, count] of diffs) {
    if (count > best || (count === best && diff < unit)) {
      unit = diff;
      best = count;
    }
  }
  if (best === 0) return FALLBACK_INDENT_UNIT;
  return Math.min(MAX_INDENT_UNIT, Math.max(MIN_INDENT_UNIT, unit));
}
