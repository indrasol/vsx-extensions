/**
 * Churnmap's local MCP server (stdio), bundled to `dist/mcp-server.js`. Started by the user's own
 * agent config (Cursor, Claude Code, VS Code): adding it there is the trust decision. It reads
 * git history with the extension's safety flags (ADR-0012), writes only under `--cache-dir` and a
 * repository's existing `.churnmap/`, and never opens a network connection. stdout carries the
 * protocol; logs go to stderr.
 */
import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { GitError, prepareHooksDir, resolveGit } from '../../src/analysis/gitProcess.js';
import type { AnalysisLogger } from '../../src/analysis/model.js';
import { listTrackedFiles } from '../../src/analysis/files.js';
import { runAnalysis } from '../../src/analysis/pipeline.js';
import { lastRepoFor } from '../../src/analysis/repoIndex.js';
import { parseArgs, USAGE } from './args.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { createChurnmapServer } from './tools.js';

/**
 * The extension's version, put in by esbuild (`define` in esbuild.mjs). A plain global: esbuild
 * cannot replace `process.env.…` here, because `process` is imported from `node:process`.
 */
declare const CHURNMAP_VERSION: string | undefined;

const logger: AnalysisLogger = {
  info: (message) => process.stderr.write(`[churnmap] ${message}\n`),
  warn: (message) => process.stderr.write(`[churnmap] warning: ${message}\n`),
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.kind === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (args.kind === 'error') {
    process.stderr.write(`${args.message}\n\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const { cacheDir } = args;
  let git: { gitPath: string; version: string } | undefined;
  const resolveGitOnce = async (): Promise<{ gitPath: string; version: string }> => {
    if (git) return git;
    const found = await resolveGit(args.git);
    if (!found.ok) {
      throw new GitError(
        'not-found',
        'Churnmap needs git, and it was not found. Install git, or pass --git <path> in the MCP server config.',
      );
    }
    git = { gitPath: found.gitPath, version: found.version };
    return git;
  };

  const server = createChurnmapServer({
    cacheDir,
    workspaces: args.workspaces,
    repo: args.repo,
    cwd: process.cwd(),
    version: typeof CHURNMAP_VERSION === 'string' ? CHURNMAP_VERSION : '0.0.0',
    logger,
    // The umbrella test: `git ls-files` with the same safety flags as a build (ADR-0012).
    trackedFiles: async (root) =>
      listTrackedFiles((await resolveGitOnce()).gitPath, root, await prepareHooksDir(cacheDir)),
    // The repository the extension last analysed for a workspace folder (cache/index.json).
    lastAnalysed: (folder) => lastRepoFor(cacheDir, folder),
    analyse: async (repoRoot, window) => {
      const { result } = await runAnalysis(
        {
          gitPath: resolveGitOnce,
          hooksDir: await prepareHooksDir(cacheDir),
          storageDir: cacheDir,
          cwd: repoRoot,
          settings: DEFAULT_SETTINGS,
          logger,
        },
        { window },
      );
      return result;
    },
  });

  const transport = new StdioServerTransport();
  transport.onclose = () => {
    process.exit(0);
  };
  process.stdin.on('end', () => {
    process.exit(0);
  });
  await server.connect(transport);
  const scope = args.workspaces?.join(', ') ?? args.repo ?? `${process.cwd()} (working directory)`;
  logger.info(`ready (cache: ${cacheDir}; scope: ${scope})`);
}

main().catch((err: unknown) => {
  process.stderr.write(`[churnmap] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
