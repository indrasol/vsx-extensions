import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod';
import { createChurnmapServer } from '../../../mcp/src/tools.js';
import { AnalysisCache } from '../../../src/analysis/cache.js';
import { normalizePath } from '../../../src/analysis/gitLog.js';
import type { Window } from '../../../src/analysis/model.js';
import { analysis, fileScore } from '../ai/helpers.js';
import { type ToolText, toolText } from './helpers.js';

const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);

let work: string;
let repoDir: string;
let repoRoot: string;
let cacheDir: string;
let builds: number;
/** How long the fake pipeline takes, ms (0 = resolves at once). */
let buildMs: number;
let client: Client;

/** A folder that looks like a git repository to `readRepoHead` (a `.git/HEAD` with a sha). */
function setHead(sha: string): void {
  writeFileSync(join(repoDir, '.git', 'HEAD'), `${sha}\n`);
}

function head(): string {
  return readFileSync(join(repoDir, '.git', 'HEAD'), 'utf8').trim();
}

beforeEach(async () => {
  work = realpathSync.native(mkdtempSync(join(tmpdir(), 'cm-mcp-')));
  repoDir = join(work, 'repo');
  mkdirSync(join(repoDir, '.git'), { recursive: true });
  mkdirSync(join(work, 'plain'));
  setHead(SHA1);
  repoRoot = normalizePath(repoDir);
  cacheDir = join(work, 'storage');
  builds = 0;
  buildMs = 0;
  const server = createChurnmapServer({
    cacheDir,
    cwd: repoDir,
    version: '0.0.0-test',
    // A fake pipeline: the result for the current HEAD, written to the cache like runAnalysis.
    analyse: async (root, window: Window) => {
      builds += 1;
      if (buildMs > 0) await new Promise((resolve) => setTimeout(resolve, buildMs));
      const result = analysis(
        [
          fileScore('src/core/engine.ts', 91, { commits: 41 }),
          fileScore('src/api/handler.ts', 70),
          fileScore('src/util/format.ts', 40),
          fileScore('docs/guide.md', 0, { eligible: false, why: 'docs', commits: 3 }),
        ],
        {
          repoRoot: root,
          head: head(),
          window,
          subjects: { 'src/core/engine.ts': ['fix: crash'] },
        },
      );
      await new AnalysisCache(cacheDir).write(result);
      return result;
    },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
});

afterEach(async () => {
  await client.close();
  rmSync(work, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolText> {
  return toolText(await client.callTool({ name, arguments: args }));
}

describe('MCP tools', () => {
  it('lists the six tools; every description starts with "Use this" and never says "top N%"', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'build',
        'explain_file',
        'get_prompt',
        'hotspots_in_changes',
        'list_hotspots',
        'list_repositories',
      ].sort(),
    );
    for (const tool of tools) {
      expect(tool.description, tool.name).toMatch(/^Use this /);
      expect(tool.description, tool.name).not.toMatch(/\btop \d+%/);
    }
    expect(tools.find((t) => t.name === 'list_hotspots')?.description).toMatch(
      /^Use this FIRST whenever the user asks which files are risky, hot, messy, fragile, frequently changed/,
    );
  });

  it('runs zod jitless, so validating a call never generates code (no new Function)', async () => {
    expect(z.config().jitless).toBe(true);
    const res = await client.callTool({ name: 'list_hotspots', arguments: { window: 90 } });
    expect(res.isError).not.toBe(true);
  });

  it('marks every tool but build read-only; build only writes the cache', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      if (tool.name === 'build') {
        expect(tool.annotations).toEqual({
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        });
        expect(tool.description).toMatch(
          /only reads the repository's git history and writes Churnmap's own analysis cache/,
        );
      } else {
        expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      }
    }
  });

  it('list_hotspots: stale (missing) → build → fresh; a new HEAD makes it stale again', async () => {
    const missing = await call('list_hotspots');
    expect(missing.data?.stale).toBe(true);
    expect(missing.data?.top).toEqual([]);
    expect(missing.texts[0]).toBe(
      `Cache is missing for ${repoRoot}. Call \`build\` to refresh (takes a few seconds).`,
    );

    const built = await call('build');
    expect(built.isError).toBe(false);
    expect(built.texts[0]).toMatch(
      /^Built repo \(last 90 days\): 3 hotspots from 50 commits in \d+ ms\. Rank 1: src\/core\/engine\.ts/,
    );
    expect(builds).toBe(1);

    const fresh = await call('list_hotspots', { limit: 2 });
    expect(fresh.texts).toHaveLength(1);
    expect(fresh.data).toMatchObject({
      version: 1,
      repo: repoRoot,
      head: SHA1,
      stale: false,
      window: 90,
    });
    const top = fresh.data?.top as {
      rank: number;
      path: string;
      band: string;
      reasons: string[];
    }[];
    expect(top.map((t) => t.path)).toEqual(['src/core/engine.ts', 'src/api/handler.ts']);
    expect(top[0]?.band).toBe('hotspot');
    expect(top[0]?.reasons).toContain('Changed 41 times in 90 days');

    setHead(SHA2);
    const stale = await call('list_hotspots');
    expect(stale.data?.stale).toBe(true);
    expect(stale.data?.currentHead).toBe(SHA2);
    expect((stale.data?.top as unknown[]).length).toBe(3); // the old list, marked stale
    expect(stale.texts[0]).toMatch(/^Cache is stale for /);
  });

  it('hotspots_in_changes returns the top-20 subset of the paths, relative or absolute', async () => {
    await call('build');
    const res = await call('hotspots_in_changes', {
      paths: [
        'src/api/handler.ts',
        join(repoDir, 'src', 'core', 'engine.ts'),
        'docs/guide.md',
        'README.md',
        '../outside.ts',
      ],
    });
    const hits = res.data?.hotspots as { rank: number; path: string }[];
    expect(hits.map((h) => [h.rank, h.path])).toEqual([
      [1, 'src/core/engine.ts'],
      [2, 'src/api/handler.ts'],
    ]);
    expect(res.data?.checked).toBe(5);
  });

  it('explain_file: a hotspot with subjects; an unranked file with its why; unknown files', async () => {
    await call('build');
    const engine = await call('explain_file', { path: 'src/core/engine.ts' });
    expect(engine.data).toMatchObject({
      rank: 1,
      band: 'hotspot',
      commits: 41,
      trend: 'rising',
      trendText: 'Complexity rising ↑ (compared with the start of the window)',
      recentCommits: ['fix: crash'],
    });
    const reasons = engine.data?.reasons as { text: string; numbers: string }[];
    expect(reasons[0]).toEqual({
      text: 'Changed 41 times in 90 days',
      numbers: 'more often than 90% of files',
    });
    for (const r of reasons) expect(r.numbers).not.toMatch(/\btop \d+%/);
    const docs = await call('explain_file', { path: 'docs/guide.md' });
    expect(docs.data?.rank).toBeNull();
    expect(docs.data?.notRanked).toMatch(/Not ranked: documentation/);
    const unknown = await call('explain_file', { path: 'nope.ts' });
    expect(unknown.texts[0]).toMatch(/not in the analysis/);
    const outside = await call('explain_file', { path: '/etc/passwd' });
    expect(outside.isError).toBe(true);
  });

  it('get_prompt returns the same AI prompt as the editor', async () => {
    await call('build');
    const brief = await call('get_prompt', { path: 'src/core/engine.ts', template: 'tests-first' });
    expect(brief.texts[0]).toMatch(/^AI prompt · engine\.ts\nChurnmap · repo · last 90 days\n/);
    expect(brief.texts[0]).toContain('- fix: crash');
    expect(brief.texts[0]).toContain('Rules: keep behaviour, add tests first');
    const review = await call('get_prompt', {
      path: 'src/core/engine.ts',
      template: 'review-changes',
      paths: ['src/api/handler.ts'],
    });
    expect(review.texts[0]).toContain(
      'Hotspots in my changes: `src/core/engine.ts`, `src/api/handler.ts`',
    );
    const bad = await call('get_prompt', {
      path: 'src/core/engine.ts',
      template: 'rewrite-it-all',
    });
    expect(bad.isError).toBe(true);
  });

  it('refuses bad repository paths: "..", missing folders and folders that are not repositories', async () => {
    for (const repo of [`${repoDir}/../repo`, join(work, 'missing'), join(work, 'plain')]) {
      for (const tool of ['list_hotspots', 'build'] as const) {
        const res = await call(tool, { repo });
        expect(res.isError, `${tool} ${repo}`).toBe(true);
        expect(res.texts[0]).toMatch(/^Refused /);
      }
    }
    expect(builds).toBe(0);
  });

  it('build refreshes .churnmap/ only when the repository already has it', async () => {
    await call('build');
    expect(() => readFileSync(join(repoDir, '.churnmap', 'hotspots.json'))).toThrow();
    mkdirSync(join(repoDir, '.churnmap'));
    writeFileSync(join(repoDir, '.churnmap', 'hotspots.json'), '{}');
    await call('build');
    const json = JSON.parse(readFileSync(join(repoDir, '.churnmap', 'hotspots.json'), 'utf8')) as {
      top: unknown[];
    };
    expect(json.top).toHaveLength(3);
  });

  it('every answer starts with the scope line; JSON answers carry it as `scope`', async () => {
    for (const [tool, args] of [
      ['list_repositories', {}],
      ['list_hotspots', {}],
      ['explain_file', { path: 'nope.ts' }],
      ['hotspots_in_changes', { paths: [] }],
      ['get_prompt', { path: 'nope.ts', template: 'tests-first' }],
      ['build', {}],
    ] as const) {
      const res = await call(tool, args);
      // Started in the repository with no --workspace: the working directory is the scope.
      expect(res.scope, tool).toBe('Scope: repo folder, 1 repository');
    }
    const listed = await call('list_repositories');
    expect(listed.data?.scope).toEqual({ source: 'cwd', roots: [repoRoot], repositories: 1 });
  });

  it('shares one build between concurrent calls', async () => {
    // Keep the first build in flight until the second call arrives; an instant fake build can
    // finish first on a fast machine, and two builds in a row are then correct.
    buildMs = 200;
    await Promise.all([call('build'), call('build')]);
    expect(builds).toBe(1);
  });
});

/**
 * Repository resolution without `repo`: an umbrella folder (a notes repository at the root) with
 * nested code repositories. Fake `.git` folders; the umbrella test's `git ls-files` is injected.
 */
describe('MCP tools in an umbrella folder', () => {
  let root: string;
  let storage: string;
  let analysed: string[];
  let last: string | undefined;

  /** A folder that `readRepoHead` accepts as a repository. */
  function fakeRepo(dir: string, sha: string): void {
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), `${sha}\n`);
  }

  async function connect(): Promise<Client> {
    const server = createChurnmapServer({
      cacheDir: storage,
      cwd: root,
      version: '0.0.0-test',
      trackedFiles: (repo) =>
        Promise.resolve(
          repo === normalizePath(root)
            ? ['NOTES.md', 'PLAN.md', 'docs/a.md', 'screens/home.png']
            : ['src/main.ts', 'src/util.ts', 'README.md'],
        ),
      lastAnalysed: () => Promise.resolve(last),
      analyse: async (repo, window: Window) => {
        analysed.push(repo);
        const result = analysis([fileScore(`src/${basename(repo)}.ts`, 90, { commits: 9 })], {
          repoRoot: repo,
          head: SHA1,
          window,
        });
        await new AnalysisCache(storage).write(result);
        return result;
      },
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const c = new Client({ name: 'umbrella-test', version: '1.0.0' });
    await c.connect(a);
    return c;
  }

  async function callOn(c: Client, name: string, args: Record<string, unknown> = {}) {
    return toolText(await c.callTool({ name, arguments: args }));
  }

  beforeEach(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cm-umbrella-')));
    storage = realpathSync.native(mkdtempSync(join(tmpdir(), 'cm-umbrella-storage-')));
    fakeRepo(root, SHA1);
    fakeRepo(join(root, 'app'), SHA1);
    analysed = [];
    last = undefined;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(storage, { recursive: true, force: true });
  });

  it('with one nested code repository, calls without repo use it, never the umbrella', async () => {
    const c = await connect();
    const listed = await callOn(c, 'list_repositories');
    const repos = listed.data?.repositories as {
      name: string;
      umbrella: boolean;
      nested: boolean;
    }[];
    expect(repos.map((r) => [r.name, r.umbrella, r.nested])).toEqual([
      [basename(root), true, false],
      ['app', false, true],
    ]);
    const built = await callOn(c, 'build');
    expect(built.isError).toBe(false);
    expect(analysed).toEqual([normalizePath(join(root, 'app'))]);
    const hot = await callOn(c, 'list_hotspots');
    expect(hot.data?.repo).toBe(normalizePath(join(root, 'app')));
    expect((hot.data?.top as { path: string }[]).map((t) => t.path)).toEqual(['src/app.ts']);
    await c.close();
  });

  it('with two code repositories, calls without repo return the list instead of guessing', async () => {
    fakeRepo(join(root, 'svc'), SHA1);
    const c = await connect();
    for (const tool of ['list_hotspots', 'build', 'explain_file'] as const) {
      const res = await callOn(c, tool, tool === 'explain_file' ? { path: 'src/a.ts' } : {});
      expect(res.isError, tool).toBe(false);
      expect(res.texts[0], tool).toMatch(/several git repositories\. Pass `repo`/);
      const repos = res.data?.repositories as { name: string }[];
      expect(repos.map((r) => r.name).sort(), tool).toEqual(['app', basename(root), 'svc'].sort());
    }
    expect(analysed).toEqual([]);
    await c.close();
  });

  it('uses the repository the extension analysed last for this folder', async () => {
    fakeRepo(join(root, 'svc'), SHA1);
    last = normalizePath(join(root, 'svc'));
    const c = await connect();
    await callOn(c, 'build');
    expect(analysed).toEqual([last]);
    const listed = await callOn(c, 'list_repositories');
    const repos = listed.data?.repositories as { name: string; lastAnalysed: boolean }[];
    expect(repos.find((r) => r.lastAnalysed)?.name).toBe('svc');
    await c.close();
  });

  it('repo "all": every code repository, top 5 each, stale ones say to build (none built)', async () => {
    fakeRepo(join(root, 'svc'), SHA1);
    const c = await connect();
    await callOn(c, 'build', { repo: join(root, 'app') });
    analysed = [];
    const all = await callOn(c, 'list_hotspots', { repo: 'all' });
    expect(analysed).toEqual([]);
    expect(all.texts[0]).toMatch(/^1 of 2 repositories need `build` first/);
    const repos = all.data?.repositories as {
      name: string;
      cache: string;
      needsBuild: boolean;
      next?: string;
      top: unknown[];
    }[];
    expect(repos.map((r) => [r.name, r.cache, r.needsBuild, r.top.length])).toEqual([
      ['app', 'fresh', false, 1],
      ['svc', 'missing', true, 0],
    ]);
    expect(repos[1]?.next).toBe(
      `call build({ repo: ${JSON.stringify(normalizePath(join(root, 'svc')))} })`,
    );
    await c.close();
  });
});
