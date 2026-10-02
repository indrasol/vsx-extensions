/**
 * The `analysis` message the city webview draws: the layout, the ranked top list with its plain
 * sentences and weekly commits, short notes for other scoring files, and the ignore list. Only
 * paths, numbers and short strings (ADR-0011). Pure, so every cap is unit-tested.
 */
import { homedir } from 'node:os';
import { basename } from 'node:path';
import {
  clip,
  MAX_SENTENCE_LENGTH,
  notes,
  NOTE_MIN_SCORE,
  sentence,
  sentences,
} from '../analysis/explain.js';
import { type AnalysisResult, COMPONENTS, type IgnoredFile } from '../analysis/model.js';
import { reasons } from '../analysis/score.js';
import type { Layout } from '../city/model.js';
import {
  type AnalysisMessage,
  MAX_IGNORED,
  MAX_SHORT_STRING,
  toShortString,
} from '../city/protocol.js';

/** At most this many files get notes (the highest scores first). */
export const MAX_NOTED_FILES = 2000;

/**
 * The repository root for the HUD tooltip: the home folder as `~`, and a long path shortened
 * from the left (the end names the repository) to `MAX_SHORT_STRING` characters.
 */
export function displayRepoPath(root: string, home: string = homedir()): string {
  const slashes = root.replace(/\\/g, '/');
  const homeSlashes = home.replace(/\\/g, '/').replace(/\/+$/, '');
  const short =
    homeSlashes !== '' && (slashes === homeSlashes || slashes.startsWith(`${homeSlashes}/`))
      ? `~${slashes.slice(homeSlashes.length)}`
      : slashes;
  return short.length <= MAX_SHORT_STRING ? short : `…${short.slice(-(MAX_SHORT_STRING - 1))}`;
}

export function buildAnalysisMessage(
  result: AnalysisResult,
  layout: Layout,
  ignored: readonly IgnoredFile[],
): AnalysisMessage {
  const inTop = new Set(result.top.map((h) => h.file.path));
  const noted: AnalysisMessage['notes'] = {};
  const candidates = result.files
    .filter(
      (f) => f.eligible && f.ignored !== true && f.score >= NOTE_MIN_SCORE && !inTop.has(f.path),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_NOTED_FILES);
  for (const file of candidates) {
    noted[file.path] = notes(
      file,
      reasons(file, result.window).map((r) => r.component),
      result.window,
    );
  }
  return {
    type: 'analysis',
    layout,
    top: result.top.map((h) => ({
      path: h.file.path,
      rank: h.rank,
      score: h.file.score,
      heat: h.file.heat ?? h.file.score,
      reasons: h.reasons.map((r) => toShortString(r.detail)),
      sentences: sentences(
        h.file,
        h.reasons.map((r) => r.component),
        result.window,
      ),
      weekly: h.file.weekly.map((n) => (Number.isFinite(n) ? n : 0)),
      authors: h.file.authors,
      trend: h.trend,
      parts: COMPONENTS.map((component) => ({
        component,
        text: clip(sentence(h.file, component, result.window), MAX_SENTENCE_LENGTH),
        percentile: h.file.percentiles[component],
      })),
    })),
    window: result.window,
    repoName: toShortString(basename(result.repoRoot)),
    repoPath: displayRepoPath(result.repoRoot),
    rank: result.rank ?? 'code',
    ignored: ignored
      .slice(0, MAX_IGNORED)
      .map((e) => ({ path: e.path, reason: toShortString(e.reason), until: e.until })),
    notes: noted,
  };
}
