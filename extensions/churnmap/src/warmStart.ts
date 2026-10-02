import { AnalysisCache } from './analysis/cache.js';
import type { AnalysisLogger, AnalysisResult, Window } from './analysis/model.js';
import { type AnalysisSettings, settingsKey } from './analysis/pipeline.js';
import { readRepoHead } from './analysis/repoHead.js';
import type { AnalysisStore } from './analysis/store.js';

export type WarmStartOutcome =
  | 'loaded'
  | 'untrusted'
  | 'no-folder'
  | 'no-repository'
  | 'miss'
  /** The store changed while the cache was read (a build or Clear cache won the race). */
  | 'superseded';

export interface WarmStartDeps {
  store: AnalysisStore;
  /** The extension's global storage folder (the cache is `<storageDir>/cache`). */
  storageDir: string;
  /**
   * The folders to try, best first (the chosen repository, else every candidate): the first with
   * a cached analysis for its HEAD wins. Called only in a trusted workspace; reads no git.
   */
  folders: () => Promise<readonly string[]>;
  trusted: boolean;
  window: Window;
  settings: AnalysisSettings;
  logger: AnalysisLogger;
  readHead?: typeof readRepoHead;
}

/**
 * After activation, load the cached analysis for this repository's root + HEAD so the
 * panel, city and status bar fill in without a build. Reads `.git` files and one JSON file; never
 * starts a process and shows no progress. Anything unusual gives up quietly (a build still works).
 */
export async function warmStart(
  deps: WarmStartDeps,
): Promise<{ outcome: WarmStartOutcome; ms: number }> {
  const start = performance.now();
  const version = deps.store.version;
  const done = (outcome: WarmStartOutcome): { outcome: WarmStartOutcome; ms: number } => {
    const ms = Math.round((performance.now() - start) * 10) / 10;
    deps.logger.info(`Warm start: ${outcome} (${String(ms)} ms).`);
    return { outcome, ms };
  };

  if (!deps.trusted) return done('untrusted');
  const folders = await deps.folders();
  if (folders.length === 0) return done('no-folder');
  const cache = new AnalysisCache(deps.storageDir);
  const key = settingsKey(deps.settings);
  let hit: AnalysisResult | undefined;
  let readable = false;
  for (const folder of folders) {
    const disk = await (deps.readHead ?? readRepoHead)(folder);
    if (!disk) continue;
    readable = true;
    hit = await cache.read(disk.repoRoot, deps.window, disk.head, key);
    if (hit) break;
  }
  if (!readable) return done('no-repository');
  if (!hit) return done('miss');
  if (deps.store.version !== version) return done('superseded');
  const ms = Math.round(performance.now() - start);
  deps.store.set({
    ...hit,
    rank: deps.settings.rank ?? 'code',
    timings: { ...hit.timings, cache: ms },
  });
  return done('loaded');
}
