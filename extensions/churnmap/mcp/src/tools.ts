/**
 * Churnmap's MCP tools. The server reads the analysis cache the extension writes (same folder,
 * same key and version) and can build it itself with the same pipeline and git safety (ADR-0012).
 * Paths, numbers and commit subjects only; never file contents. Nothing goes over the network.
 * Every tool sees only the repositories in the scope (`scope.ts`) and says which scope it used.
 */
import { basename, isAbsolute, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';
import { hotspotEntries, renderHotspotsJson } from '../../src/ai/agentContext.js';
import {
  BRIEF_TEMPLATES,
  type BriefFile,
  briefFileFromHotspot,
  briefFileFromScore,
  buildBrief,
} from '../../src/ai/brief.js';
import { hasContextFiles, writeContextFiles } from '../../src/ai/writers.js';
import { AnalysisCache } from '../../src/analysis/cache.js';
import { bandOfFile } from '../../src/analysis/bands.js';
import { TREND_TOOLTIP, trendText, whyText } from '../../src/analysis/explain.js';
import { GitError } from '../../src/analysis/gitProcess.js';
import type { AnalysisLogger, AnalysisResult, Window } from '../../src/analysis/model.js';
import { readRepoHead } from '../../src/analysis/repoHead.js';
import { reasons as scoreReasons } from '../../src/analysis/score.js';
import { resolveRepo, toRepoPath } from './repo.js';
import {
  defaultRepo,
  findRepositories,
  listRepositories,
  type RepoInfo,
  type RepoSources,
  type ScopeRepo,
} from './repos.js';
import {
  isInside,
  NO_WORKSPACE,
  outsideScope,
  realRoot,
  resolveScope,
  type Scope,
  scopeLine,
} from './scope.js';
import { DEFAULT_SETTINGS, DEFAULT_WINDOW } from './settings.js';

export const SERVER_NAME = 'churnmap';

/** Runs the analysis for the repository at `repoRoot` and writes the cache (the `build` tool). */
export type Analyse = (repoRoot: string, window: Window) => Promise<AnalysisResult>;

export interface ServerOptions {
  /** Churnmap's storage folder; the cache is `<cacheDir>/cache`. */
  cacheDir: string;
  /** `--workspace`: the folders the tools may see (see `resolveScope`). */
  workspaces?: readonly string[] | undefined;
  /** `--repo`: the repository when a call names none. */
  repo?: string | undefined;
  /** The server's working directory (the scope only without `--workspace` and `--repo`). */
  cwd: string;
  version: string;
  analyse: Analyse;
  /** `git ls-files` for a repository (the umbrella test); none: every repository counts as code. */
  trackedFiles?: (root: string) => Promise<string[]>;
  /** The repository the extension last analysed for a workspace folder (the cache index). */
  lastAnalysed?: (folder: string) => Promise<string | undefined>;
  readHead?: typeof readRepoHead;
  logger?: AnalysisLogger;
}

const windowSchema = z
  .union([z.literal(30), z.literal(90), z.literal(365)])
  .optional()
  .describe('History window in days: 30, 90 (default) or 365.');
const repoSchema = z
  .string()
  .max(4096)
  .optional()
  .describe(
    'Repository folder inside the workspace (absolute, or relative to it). Default: the repository Churnmap analysed last for this workspace, else the only code repository in it; when there are several, the tool returns the list (see `list_repositories`).',
  );

/** One call's view of the scope: its folders and the repositories in them. */
interface Ctx {
  scope: Scope;
  repos: ScopeRepo[];
  sources: RepoSources;
  /** The repository (or folder) is in the scope: below a scope folder, or the one holding it. */
  allows(dir: string): boolean;
}

/** The repository list an ambiguous call returns, so the agent can pass `repo`. */
function askForRepo(ctx: Ctx, repositories: readonly RepoInfo[]): CallToolResult {
  return json(
    ctx,
    'This workspace holds several git repositories. Pass `repo` with one of the roots below (or `repo: "all"` to `list_hotspots` for every code repository).',
    { repositories },
  );
}

function text(value: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

/** A note (optional) and the JSON, which carries the scope as `scope`. */
function json(ctx: Ctx, note: string | undefined, value: Record<string, unknown>): CallToolResult {
  const content: CallToolResult['content'] = [];
  if (note) content.push({ type: 'text', text: note });
  const scope = {
    source: ctx.scope.source,
    roots: ctx.scope.roots,
    repositories: ctx.repos.length,
  };
  content.push({ type: 'text', text: JSON.stringify({ ...value, scope }, null, 2) });
  return { content };
}

function staleNote(repoRoot: string, missing: boolean): string {
  return `Cache is ${missing ? 'missing' : 'stale'} for ${repoRoot}. Call \`build\` to refresh (takes a few seconds).`;
}

/** Tool errors are answers the agent can act on, never exceptions. */
function failure(err: unknown): CallToolResult {
  if (err instanceof GitError) return text(err.userMessage, true);
  return text(`Churnmap failed: ${err instanceof Error ? err.message : String(err)}`, true);
}

export function createChurnmapServer(opts: ServerOptions): McpServer {
  // No generated code: zod otherwise compiles object parsers with `new Function` (and probes for
  // it). The validation is the same, only interpreted (security-practices: no dynamic code).
  z.config({ jitless: true });
  const readHead = opts.readHead ?? readRepoHead;
  const cache = new AnalysisCache(opts.cacheDir);
  const building = new Map<string, Promise<AnalysisResult>>();

  /**
   * The scope and the repositories in it, worked out afresh for each call (repositories come and
   * go). Undefined when the server has no scope.
   */
  const context = async (): Promise<Ctx | undefined> => {
    const scope = await resolveScope(
      { workspaces: opts.workspaces, repo: opts.repo, cwd: opts.cwd },
      readHead,
    );
    if (!scope) return undefined;
    const repos = await findRepositories({
      roots: scope.roots,
      exclude: DEFAULT_SETTINGS.exclude,
      readHead,
    });
    const allows = (dir: string): boolean =>
      scope.roots.some((r) => isInside(dir, r)) ||
      repos.some((r) => r.enclosing && isInside(dir, r.root));
    const sources: RepoSources = {
      roots: scope.roots,
      exclude: DEFAULT_SETTINGS.exclude,
      trackedFiles: opts.trackedFiles ?? (() => Promise.reject(new Error('no git'))),
      // The first scope folder the extension has a last build for, when that is in scope.
      lastAnalysed: async () => {
        for (const root of scope.roots) {
          const last = await opts.lastAnalysed?.(root);
          if (last !== undefined && allows(last)) return last;
        }
        return undefined;
      },
      readHead,
    };
    return { scope, repos, sources, allows };
  };

  /**
   * Runs a tool inside the scope: refuses without one, and puts the scope line on top of the
   * answer (errors included), so the agent can tell the user what it looked at.
   */
  const scoped = async (run: (ctx: Ctx) => Promise<CallToolResult>): Promise<CallToolResult> => {
    let ctx: Ctx | undefined;
    try {
      ctx = await context();
    } catch (err) {
      return failure(err);
    }
    if (!ctx) return text(NO_WORKSPACE, true);
    const result = await run(ctx).catch(failure);
    const line = { type: 'text' as const, text: scopeLine(ctx.scope, ctx.repos.length) };
    return { ...result, content: [line, ...result.content] };
  };

  /**
   * The repository a call is about: its `repo`, else `--repo`, else the default for the workspace
   * (`defaultRepo`). Several candidates and nothing to go on: the list, never a guess. Anything
   * outside the scope is refused before the folder is even looked at.
   */
  const target = async (
    ctx: Ctx,
    repoArg: string | undefined,
  ): Promise<
    { ok: true; repoRoot: string; head: string } | { ok: false; result: CallToolResult }
  > => {
    let arg = repoArg;
    if ((arg === undefined || arg.trim() === '') && opts.repo === undefined) {
      const found = await defaultRepo(ctx.sources, ctx.repos);
      if (found.kind === 'ask') return { ok: false, result: askForRepo(ctx, found.repositories) };
      arg = found.root;
    }
    const base = ctx.scope.roots[0] ?? opts.cwd;
    const raw = arg === undefined || arg.trim() === '' ? (opts.repo ?? base) : arg;
    const refuse = { ok: false as const, result: text(outsideScope(raw, ctx.scope), true) };
    // ".." and NUL are refused by resolveRepo with their own message.
    if (!raw.includes('\0') && !raw.split(/[\\/]/).includes('..')) {
      const dir = await realRoot(isAbsolute(raw) ? raw : resolve(opts.repo ?? base, raw));
      if (!ctx.allows(dir)) return refuse;
    }
    const repo = await resolveRepo(arg, { repo: opts.repo, cwd: base }, readHead);
    if (!repo.ok) return { ok: false, result: text(repo.message, true) };
    // A folder in scope can still sit in a repository that is not (git finds the root above it).
    if (!ctx.allows(repo.repoRoot)) return refuse;
    return { ok: true, repoRoot: repo.repoRoot, head: repo.head };
  };

  /** The repository and its cached analysis (whatever HEAD it was built for). */
  const load = async (
    ctx: Ctx,
    repoArg: string | undefined,
    window: Window,
  ): Promise<
    | { ok: false; result: CallToolResult }
    | {
        ok: true;
        repoRoot: string;
        head: string;
        cached: AnalysisResult | undefined;
        stale: boolean;
      }
  > => {
    const repo = await target(ctx, repoArg);
    if (!repo.ok) return repo;
    const cached = await cache.readAnyHead(repo.repoRoot, window);
    return {
      ok: true,
      repoRoot: repo.repoRoot,
      head: repo.head,
      cached,
      stale: cached === undefined || cached.head !== repo.head,
    };
  };

  const server = new McpServer({ name: SERVER_NAME, version: opts.version });

  /** One repository's cached top list for `repo: "all"`: fresh, stale or missing. */
  const summary = async (
    repo: RepoInfo,
    window: Window,
    limit: number,
  ): Promise<Record<string, unknown>> => {
    const head = await readHead(repo.root);
    const cached = await cache.readAnyHead(repo.root, window);
    const stale = cached === undefined || cached.head !== head?.head;
    return {
      name: repo.name,
      repo: repo.root,
      lastAnalysed: repo.lastAnalysed,
      cache: cached === undefined ? 'missing' : stale ? 'stale' : 'fresh',
      generatedAt: cached?.generatedAt ?? null,
      needsBuild: stale,
      ...(stale ? { next: `call build({ repo: ${JSON.stringify(repo.root)} })` } : {}),
      top: cached ? hotspotEntries(cached).slice(0, limit) : [],
    };
  };

  server.registerTool(
    'list_repositories',
    {
      title: 'List the repositories in this workspace',
      description:
        'Use this when the workspace may hold several git repositories (an umbrella folder with nested clones, submodules or worktrees), or when another Churnmap tool asks for `repo`. Returns every repository in the workspace Churnmap is connected to (never anything outside it) with its root, whether it is mostly documentation (an umbrella, never analysed unless asked for), and which one the Churnmap extension analysed last.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      scoped(async (ctx) => {
        const repositories = await listRepositories(ctx.sources, ctx.repos);
        return json(
          ctx,
          repositories.length === 0
            ? `No git repository was found in ${ctx.scope.roots.join(', ')} (searched 3 folders deep).`
            : undefined,
          { repositories },
        );
      }),
  );

  server.registerTool(
    'list_hotspots',
    {
      title: 'List code hotspots',
      description:
        'Use this FIRST whenever the user asks which files are risky, hot, messy, fragile, frequently changed, or where to refactor or add tests. Returns the ranked hotspots of a git repository from Churnmap\'s analysis (churn × complexity × authors × bug fixes), with reasons. Prefer it to running git log yourself. Pass `repo: "all"` for every code repository in an umbrella folder. If the result says the cache is stale or missing, call `build` first.',
      inputSchema: {
        repo: z
          .string()
          .max(4096)
          .optional()
          .describe(
            'Repository folder inside the workspace (absolute, or relative to it), or "all" for every code repository in the workspace (top `limit` each, default 5). Default: the repository Churnmap analysed last, else the only code repository.',
          ),
        window: windowSchema,
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('How many to return (default 20; 5 per repository with repo "all").'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ repo, window, limit }) =>
      scoped(async (ctx) => {
        const w = window ?? DEFAULT_WINDOW;
        if (repo?.trim().toLowerCase() === 'all') {
          const repositories = (await listRepositories(ctx.sources, ctx.repos)).filter(
            (r) => !r.umbrella,
          );
          const per = limit ?? 5;
          const summaries = [];
          for (const r of repositories) summaries.push(await summary(r, w, per));
          const stale = summaries.filter((s) => s.needsBuild === true).length;
          return json(
            ctx,
            repositories.length === 0
              ? `No code repository was found in ${ctx.scope.roots.join(', ')}.`
              : stale > 0
                ? `${String(stale)} of ${String(summaries.length)} repositories need \`build\` first (see "next"). Nothing was built automatically.`
                : undefined,
            { window: w, repositories: summaries },
          );
        }
        const found = await load(ctx, repo, w);
        if (!found.ok) return found.result;
        const { repoRoot, head, cached, stale } = found;
        const payload = cached
          ? {
              ...renderHotspotsJson(cached),
              top: renderHotspotsJson(cached).top.slice(0, limit ?? 20),
              repo: repoRoot,
              currentHead: head,
              stale,
            }
          : {
              version: 1,
              repo: repoRoot,
              head,
              generatedAt: null,
              window: w,
              stale: true,
              top: [],
            };
        return json(ctx, stale ? staleNote(repoRoot, cached === undefined) : undefined, payload);
      }),
  );

  server.registerTool(
    'explain_file',
    {
      title: 'Explain one file',
      description:
        'Use this when the user asks why a file is risky or whether it is a hotspot, and before changing a file that may be one. Returns its rank, band (Hotspot = top 5 % of the code files, Watch = next 15 %, Stable), score, the reasons as plain sentences with the numbers behind them, lines, changes, people, complexity trend and recent commit subjects.',
      inputSchema: {
        repo: repoSchema,
        path: z.string().min(1).max(4096).describe('File path, repository-relative or absolute.'),
        window: windowSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ repo, path, window }) =>
      scoped(async (ctx) => {
        const found = await load(ctx, repo, window ?? DEFAULT_WINDOW);
        if (!found.ok) return found.result;
        const { repoRoot, cached, stale } = found;
        if (!cached) return text(staleNote(repoRoot, true));
        const rel = toRepoPath(repoRoot, path);
        if (rel === undefined)
          return text(`Refused "${path}": not a path inside ${repoRoot}.`, true);
        const file = cached.files.find((f) => f.path === rel);
        if (!file) {
          return text(
            `${rel} is not in the analysis (not tracked by git, excluded, or outside the analysed files).`,
          );
        }
        const hotspot = cached.top.find((h) => h.file.path === rel);
        const reasons =
          hotspot?.reasons ?? (file.eligible ? scoreReasons(file, cached.window) : []);
        const trend = hotspot?.trend ?? 'unknown';
        return json(ctx, stale ? staleNote(repoRoot, false) : undefined, {
          repo: repoRoot,
          path: rel,
          stale,
          rank: hotspot?.rank ?? file.position ?? null,
          score: file.score,
          band: file.eligible ? bandOfFile(file) : null,
          reasons: reasons.map((r) => ({ text: r.text, numbers: r.detail })),
          ...(file.eligible || file.why === undefined
            ? {}
            : { notRanked: whyText(file.why, file.commits, cached.window) }),
          loc: file.loc,
          commits: file.commits,
          people: file.authors,
          owners: file.owners.slice(0, 2),
          trend,
          ...(trend === 'unknown' ? {} : { trendText: `${trendText(trend)} (${TREND_TOOLTIP})` }),
          window: cached.window,
          recentCommits: cached.subjects?.[rel] ?? [],
        });
      }),
  );

  server.registerTool(
    'hotspots_in_changes',
    {
      title: 'Hotspots in a change set',
      description:
        'Use this before committing, reviewing or merging a change: pass the changed file paths (from git status or a diff) and it returns which of them are top-20 hotspots, with rank and reasons, so you review those files with extra care.',
      inputSchema: {
        repo: repoSchema,
        paths: z.array(z.string().min(1).max(4096)).max(5000).describe('Changed file paths.'),
        window: windowSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ repo, paths, window }) =>
      scoped(async (ctx) => {
        const found = await load(ctx, repo, window ?? DEFAULT_WINDOW);
        if (!found.ok) return found.result;
        const { repoRoot, cached, stale } = found;
        if (!cached) return text(staleNote(repoRoot, true));
        const wanted = new Set(
          paths.map((p) => toRepoPath(repoRoot, p)).filter((p): p is string => p !== undefined),
        );
        const hits = hotspotEntries(cached).filter((e) => wanted.has(e.path));
        return json(ctx, stale ? staleNote(repoRoot, false) : undefined, {
          repo: repoRoot,
          stale,
          checked: paths.length,
          hotspots: hits,
        });
      }),
  );

  server.registerTool(
    'get_prompt',
    {
      title: 'AI prompt for a hotspot',
      description:
        "Use this when the user wants help refactoring, testing, understanding or reviewing a hotspot. Returns a ready-to-follow Markdown prompt with the file's numbers, reasons, recent commit subjects and a guarded ask (refactor-plan, tests-first, explain-history, review-changes). Follow its rules: tests first, small diffs, unchanged behaviour.",
      inputSchema: {
        repo: repoSchema,
        path: z.string().min(1).max(4096).describe('The file the prompt is about.'),
        template: z.enum(BRIEF_TEMPLATES).describe('Which kind of help the prompt asks for.'),
        paths: z
          .array(z.string().min(1).max(4096))
          .max(100)
          .optional()
          .describe('review-changes only: more changed files to include.'),
        window: windowSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ repo, path, template, paths, window }) =>
      scoped(async (ctx) => {
        const found = await load(ctx, repo, window ?? DEFAULT_WINDOW);
        if (!found.ok) return found.result;
        const { repoRoot, cached, stale } = found;
        if (!cached) return text(staleNote(repoRoot, true));
        const files: BriefFile[] = [];
        for (const p of [path, ...(template === 'review-changes' ? (paths ?? []) : [])]) {
          const rel = toRepoPath(repoRoot, p);
          if (rel === undefined || files.some((f) => f.path === rel)) continue;
          const subjects = cached.subjects?.[rel] ?? [];
          const hotspot = cached.top.find((h) => h.file.path === rel);
          const file = cached.files.find((f) => f.path === rel);
          if (hotspot) files.push(briefFileFromHotspot(hotspot, cached.window, subjects));
          else if (file) files.push(briefFileFromScore(file, cached.window, subjects));
        }
        if (files.length === 0) return text(`${path} is not in the analysis.`, true);
        const prompt = buildBrief(
          { repoName: basename(repoRoot), window: cached.window, files },
          template,
        );
        return text(stale ? `${staleNote(repoRoot, false)}\n\n${prompt}` : prompt);
      }),
  );

  server.registerTool(
    'build',
    {
      title: 'Build the hotspot analysis',
      description:
        "Use this when another Churnmap tool says the cache is missing or stale. It only reads the repository's git history and writes Churnmap's own analysis cache (and refreshes an existing .churnmap/ folder); it changes nothing else in the repository. Takes a few seconds.",
      inputSchema: { repo: repoSchema, window: windowSchema },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ repo, window }) =>
      scoped(async (ctx) => {
        const w = window ?? DEFAULT_WINDOW;
        const resolved = await target(ctx, repo);
        if (!resolved.ok) return resolved.result;
        const key = `${resolved.repoRoot}\0${String(w)}`;
        const start = performance.now();
        let run = building.get(key);
        if (!run) {
          run = opts.analyse(resolved.repoRoot, w).finally(() => building.delete(key));
          building.set(key, run);
        }
        const result = await run;
        // A repository that has .churnmap/ keeps it in step, as a build in the editor does.
        if (await hasContextFiles(result.repoRoot)) await writeContextFiles(result);
        const ms = Math.round(performance.now() - start);
        const first = result.top[0];
        opts.logger?.info(`build ${result.repoRoot} (${String(w)} d) in ${String(ms)} ms`);
        return json(
          ctx,
          `Built ${basename(result.repoRoot)} (last ${String(w)} days): ${String(result.top.length)} hotspots from ${String(result.commitCount)} commits in ${String(ms)} ms.` +
            (first ? ` Rank 1: ${first.file.path} (score ${first.file.score.toFixed(1)}).` : ''),
          {
            repo: result.repoRoot,
            head: result.head,
            window: result.window,
            generatedAt: result.generatedAt,
            commits: result.commitCount,
            hotspots: result.top.length,
            ms,
            top: hotspotEntries(result).slice(0, 3),
          },
        );
      }),
  );

  return server;
}
