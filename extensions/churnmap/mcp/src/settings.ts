import type { AnalysisSettings } from '../../src/analysis/pipeline.js';
import { DEFAULT_FIX_KEYWORDS } from '../../src/analysis/score.js';

/**
 * The settings the server analyses with: the extension's defaults (package.json), so a build here
 * and a build in the editor share a cache entry. A unit test keeps the two in step.
 */
export const DEFAULT_SETTINGS: AnalysisSettings = {
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/*.min.*',
    '**/*.lock',
    '**/pnpm-lock.yaml',
    '**/package-lock.json',
    '**/*.snap',
  ],
  maxFiles: 20_000,
  fixKeywords: DEFAULT_FIX_KEYWORDS,
  rank: 'code',
};

/** The window a tool uses when the call names none (the extension's default). */
export const DEFAULT_WINDOW = 90;
