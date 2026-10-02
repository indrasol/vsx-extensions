import { EventEmitter } from 'node:events';
import { layoutCity } from '../city/layout.js';
import type { Layout } from '../city/model.js';
import { withBands } from './bands.js';
import type { AnalysisResult, IgnoredFile } from './model.js';
import { rank } from './score.js';

/**
 * Holds the latest analysis and tells subscribers (hotspots view, the city, the status bar) when
 * it changes. Ignored files are applied on read: `get()` is the analysis with those files left out
 * of `top` (the next-best files fill their slots) and marked `ignored` in `files`, while the
 * analysis itself (and the cache) stays as built.
 */
export class AnalysisStore {
  private readonly emitter = new EventEmitter();
  private current: AnalysisResult | undefined;
  private ignoreSource: () => readonly IgnoredFile[] = () => [];
  /** The result with ignores applied, memoised per result and ignore set. */
  private derived: { of: AnalysisResult; key: string; result: AnalysisResult } | undefined;
  /** The city layout of `get()`, computed on first use; never persisted in the cache. */
  private layout: { of: AnalysisResult; layout: Layout } | undefined;
  private changes = 0;

  /** The analysis as built, without ignores applied. */
  raw(): AnalysisResult | undefined {
    return this.current;
  }

  /** The analysis with ignored files left out of `top`. */
  get(): AnalysisResult | undefined {
    const result = this.current;
    if (!result) return undefined;
    const ignored = this.ignored();
    if (ignored.length === 0) return result;
    const key = ignored.map((e) => e.path).join('\0');
    if (this.derived?.of !== result || this.derived.key !== key) {
      const paths = new Set(ignored.map((e) => e.path));
      const trends = new Map(result.top.map((h) => [h.file.path, h.trend]));
      // Bands are positions among the ranked files, so ignoring one moves the others up.
      const files = withBands(
        result.files.map((f) => (paths.has(f.path) ? { ...f, ignored: true as const } : f)),
        paths,
      );
      // Newly promoted files had no trend computed (top-20 only): shown as unknown.
      const top = rank(files, result.window, paths).map((h) => ({
        ...h,
        trend: trends.get(h.file.path) ?? 'unknown',
      }));
      this.derived = { of: result, key, result: { ...result, files, top } };
    }
    return this.derived.result;
  }

  /** The last `n` commit subjects touching `path`, newest first (subjects only, never bodies). */
  recentCommits(path: string, n = 10): string[] {
    return this.current?.subjects?.[path]?.slice(0, n) ?? [];
  }

  /** The live ignore entries (the source purges expired ones as it is read). */
  ignored(): readonly IgnoredFile[] {
    return this.ignoreSource();
  }

  /** Where ignores come from; call `ignoresChanged` when they change. */
  setIgnoreSource(source: () => readonly IgnoredFile[]): void {
    this.ignoreSource = source;
  }

  ignoresChanged(): void {
    this.changes += 1;
    this.emitter.emit('change', this.get());
  }

  /** The city layout for `get()`, memoised per result; ranks (and so the glow) skip ignored files. */
  getLayout(): Layout | undefined {
    const result = this.get();
    if (!result) return undefined;
    if (this.layout?.of !== result) {
      const ranks: Record<string, number> = {};
      for (const hotspot of result.top) ranks[hotspot.file.path] = hotspot.rank;
      // Unranked files carry why (and, for too few commits, how many) so their card can say so.
      const files = result.files.map((f) =>
        f.why === undefined
          ? {
              path: f.path,
              loc: f.loc,
              score: f.score,
              ...(f.heat === undefined ? {} : { heat: f.heat }),
              ...(f.position === undefined ? {} : { position: f.position }),
            }
          : {
              path: f.path,
              loc: f.loc,
              score: f.score,
              why: f.why,
              ...(f.why === 'few-commits' ? { commits: f.commits } : {}),
            },
      );
      this.layout = { of: result, layout: layoutCity(files, {}, ranks) };
    }
    return this.layout.layout;
  }

  set(result: AnalysisResult | undefined): void {
    this.current = result;
    this.changes += 1;
    this.derived = undefined;
    this.layout = undefined;
    this.emitter.emit('change', this.get());
  }

  /** Counts every `set` and ignore change, so an async task can tell whether it went stale. */
  get version(): number {
    return this.changes;
  }

  onDidChange(listener: (result: AnalysisResult | undefined) => void): { dispose(): void } {
    this.emitter.on('change', listener);
    return {
      dispose: () => {
        this.emitter.off('change', listener);
      },
    };
  }

  dispose(): void {
    this.emitter.removeAllListeners();
  }
}
