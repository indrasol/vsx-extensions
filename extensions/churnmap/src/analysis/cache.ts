import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ANALYSIS_VERSION, type AnalysisResult, type Window } from './model.js';

/** The cache folder's name under the extension's global storage. */
export const CACHE_DIR = 'cache';

/** Forward slashes, and case-folded on Windows, so git's and Node's spellings of a root agree. */
export function normalizeRoot(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const slashes = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? slashes.toLowerCase() : slashes;
}

function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<Record<keyof AnalysisResult, unknown>>;
  return (
    v.version === ANALYSIS_VERSION &&
    typeof v.repoRoot === 'string' &&
    typeof v.head === 'string' &&
    typeof v.window === 'number' &&
    typeof v.settingsKey === 'string' &&
    Array.isArray(v.files) &&
    Array.isArray(v.top)
  );
}

/**
 * JSON cache of analysis results under `<storageDir>/cache/`, one file per repository root and
 * window. A result is served only for the same HEAD (and settings), so a new commit is a miss.
 */
export class AnalysisCache {
  readonly dir: string;

  constructor(storageDir: string) {
    this.dir = path.join(storageDir, CACHE_DIR);
  }

  /** `sha1(repoRoot)-<window>.json`. */
  static key(repoRoot: string, window: Window): string {
    const hash = createHash('sha1').update(normalizeRoot(repoRoot)).digest('hex');
    return `${hash}-${String(window)}.json`;
  }

  file(repoRoot: string, window: Window): string {
    return path.join(this.dir, AnalysisCache.key(repoRoot, window));
  }

  /**
   * The cached result, or undefined when there is none, it is for another HEAD or settings, or
   * it has another version. A corrupt file is deleted.
   */
  async read(
    repoRoot: string,
    window: Window,
    head: string,
    settingsKey?: string,
  ): Promise<AnalysisResult | undefined> {
    const file = this.file(repoRoot, window);
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      await fs.rm(file, { force: true });
      return undefined;
    }
    if (!isAnalysisResult(parsed)) return undefined;
    if (parsed.head !== head || parsed.window !== window) return undefined;
    if (settingsKey !== undefined && parsed.settingsKey !== settingsKey) return undefined;
    return parsed;
  }

  /**
   * The cached result for this root and window whatever HEAD or settings it was built for, so a
   * caller can tell a missing cache from a stale one (the MCP server). Never deletes anything.
   */
  async readAnyHead(repoRoot: string, window: Window): Promise<AnalysisResult | undefined> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.file(repoRoot, window), 'utf8'));
      return isAnalysisResult(parsed) && parsed.window === window ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** Writes atomically: a temp file in the same folder, then a rename over the old one. */
  async write(result: AnalysisResult): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.file(result.repoRoot, result.window);
    const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(result), 'utf8');
      await fs.rename(temp, file);
    } catch (err) {
      await fs.rm(temp, { force: true });
      throw err;
    }
  }

  /** Removes every cached result. */
  async clear(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
