import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isInside, NO_WORKSPACE, resolveScope, scopeLine } from '../../../mcp/src/scope.js';
import { createChurnmapServer, type ServerOptions } from '../../../mcp/src/tools.js';
import { normalizePath } from '../../../src/analysis/gitLog.js';
import type { Window } from '../../../src/analysis/model.js';
import { commitAll, initRepo, writeFiles } from '../../fixtures/gitRepo.mjs';
import { analysis, fileScore } from '../ai/helpers.js';
import { toolText } from './helpers.js';

/**
 * The report this guards against: an agent started the server in a folder above the project and
 * `list_hotspots({ repo: "all" })` answered "across 18 repos", most of them unrelated projects.
 * Here a parent folder (not a repository) holds three projects with real git repositories:
 *
 *   parent/Acme/{api,web}       the workspace
 *   parent/orbit-app            a sibling project, itself a repository
 *   parent/widgets/core         another sibling project
 *   parent/mono/packages/ui     a folder inside a repository (for the enclosing-repository rule)
 */
let parent: string;
let tasks: string;
const built: string[] = [];

function repo(dir: string): void {
  initRepo(dir);
  writeFiles(dir, { 'src/main.ts': 'export const x = 1;\n' });
  commitAll(dir, { message: 'start', date: '2026-01-01T00:00:00Z' });
}

beforeAll(() => {
  parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'cm-scope-')));
  tasks = join(parent, 'Acme');
  repo(join(tasks, 'api'));
  repo(join(tasks, 'web'));
  repo(join(parent, 'orbit-app'));
  repo(join(parent, 'widgets', 'core'));
  repo(join(parent, 'mono'));
  mkdirSync(join(parent, 'mono', 'packages', 'ui'), { recursive: true });
});

afterAll(() => {
  rmSync(parent, { recursive: true, force: true });
});

async function connect(opts: Partial<ServerOptions>) {
  const storage = join(parent, '.storage');
  const server = createChurnmapServer({
    cacheDir: storage,
    cwd: parent,
    version: '0.0.0-test',
    analyse: (root, window: Window) => {
      built.push(root);
      return Promise.resolve(
        analysis([fileScore('src/main.ts', 50)], { repoRoot: root, head: '1'.repeat(40), window }),
      );
    },
    ...opts,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: 'scope-test', version: '1.0.0' });
  await client.connect(a);
  return {
    call: async (name: string, args: Record<string, unknown> = {}) =>
      toolText(await client.callTool({ name, arguments: args })),
    close: () => client.close(),
  };
}

const TOOLS = [
  ['list_repositories', {}],
  ['list_hotspots', {}],
  ['list_hotspots', { repo: 'all' }],
  ['explain_file', { path: 'src/main.ts' }],
  ['hotspots_in_changes', { paths: ['src/main.ts'] }],
  ['get_prompt', { path: 'src/main.ts', template: 'tests-first' }],
  ['build', {}],
] as const;

describe('MCP scope: the workspace only', () => {
  it('started in the parent folder with --workspace Acme, repo "all" lists only its repositories', async () => {
    const s = await connect({ workspaces: [tasks] });
    try {
      const listed = await s.call('list_repositories');
      expect(listed.scope).toBe('Scope: Acme workspace, 2 repositories');
      const names = (listed.data?.repositories as { name: string }[]).map((r) => r.name);
      expect(names).toEqual(['api', 'web']);
      expect(listed.data?.scope).toEqual({
        source: 'workspace',
        roots: [normalizePath(tasks)],
        repositories: 2,
      });

      const all = await s.call('list_hotspots', { repo: 'all' });
      expect(all.scope).toBe('Scope: Acme workspace, 2 repositories');
      const repos = (all.data?.repositories as { repo: string }[]).map((r) => r.repo);
      expect(repos).toEqual([join(tasks, 'api'), join(tasks, 'web')].map(normalizePath));
      for (const r of repos) expect(isInside(r, tasks), r).toBe(true);

      // Several repositories and no `repo`: the list, still the workspace's only.
      const ask = await s.call('list_hotspots');
      expect((ask.data?.repositories as { name: string }[]).map((r) => r.name)).toEqual([
        'api',
        'web',
      ]);
      // A repository in the workspace, absolute or relative to it.
      for (const r of [join(tasks, 'api'), 'web']) {
        const res = await s.call('build', { repo: r });
        expect(res.isError, `${r}: ${res.texts.join(' ')}`).toBe(false);
      }
    } finally {
      await s.close();
    }
  });

  it('refuses a repository in a sibling project, naming the allowed folders, without building it', async () => {
    const s = await connect({ workspaces: [tasks] });
    built.length = 0;
    try {
      for (const sibling of [
        join(parent, 'orbit-app'),
        join(parent, 'widgets', 'core'),
        join(parent, 'widgets'),
        parent,
        '/',
      ]) {
        for (const [tool, args] of TOOLS) {
          if (tool === 'list_repositories' || 'repo' in args) continue;
          const res = await s.call(tool, { ...args, repo: sibling });
          expect(res.isError, `${tool} ${sibling}`).toBe(true);
          expect(res.scope).toBe('Scope: Acme workspace, 2 repositories');
          expect(res.texts[0]).toBe(
            `Refused "${sibling}": outside the workspace Churnmap is connected to. Allowed: ${normalizePath(tasks)}.`,
          );
        }
      }
      expect(built).toEqual([]);
    } finally {
      await s.close();
    }
  });

  it('without --workspace in a folder that is not inside a repository, every tool refuses', async () => {
    const s = await connect({});
    try {
      for (const [tool, args] of TOOLS) {
        const res = await s.call(tool, args);
        expect(res.isError, tool).toBe(true);
        expect(res.scope, tool).toBeUndefined();
        expect(res.texts, tool).toEqual([NO_WORKSPACE]);
      }
      expect(NO_WORKSPACE).toBe(
        'Churnmap MCP has no workspace configured; reconnect via Churnmap: Connect to AI agent',
      );
    } finally {
      await s.close();
    }
  });

  it('without --workspace in a repository, the working directory is the scope (older configs keep working)', async () => {
    const s = await connect({ cwd: join(parent, 'orbit-app') });
    try {
      const listed = await s.call('list_hotspots');
      expect(listed.scope).toBe('Scope: orbit-app folder, 1 repository');
      expect(listed.data?.repo).toBe(normalizePath(join(parent, 'orbit-app')));
      const sibling = await s.call('build', { repo: join(tasks, 'api') });
      expect(sibling.texts[0]).toMatch(/^Refused .*outside the workspace/);
    } finally {
      await s.close();
    }
  });

  it('--repo: the scope without --workspace; inside it is the default, outside it every call is refused', async () => {
    const pinned = await connect({ repo: join(parent, 'orbit-app') });
    try {
      const res = await pinned.call('list_hotspots');
      expect(res.scope).toBe('Scope: orbit-app repository, 1 repository');
      expect(res.data?.repo).toBe(normalizePath(join(parent, 'orbit-app')));
    } finally {
      await pinned.close();
    }
    const inside = await connect({ workspaces: [tasks], repo: join(tasks, 'web') });
    try {
      const res = await inside.call('list_hotspots');
      expect(res.data?.repo).toBe(normalizePath(join(tasks, 'web')));
    } finally {
      await inside.close();
    }
    const outside = await connect({ workspaces: [tasks], repo: join(parent, 'orbit-app') });
    try {
      const res = await outside.call('list_hotspots');
      expect(res.isError).toBe(true);
      expect(res.texts[0]).toMatch(/^Refused ".*orbit-app": outside the workspace/);
    } finally {
      await outside.close();
    }
  });

  it('several --workspace folders: both names, every repository in them, nothing else', async () => {
    const s = await connect({ workspaces: [tasks, join(parent, 'widgets')] });
    try {
      const listed = await s.call('list_repositories');
      expect(listed.scope).toBe('Scope: Acme + widgets workspace, 3 repositories');
      const names = (listed.data?.repositories as { name: string }[]).map((r) => r.name);
      expect(names).toEqual(['api', 'web', 'core']);
    } finally {
      await s.close();
    }
  });

  it('a workspace folder inside a repository (a monorepo package) uses that repository', async () => {
    const ui = join(parent, 'mono', 'packages', 'ui');
    const s = await connect({ workspaces: [ui] });
    try {
      const res = await s.call('list_hotspots');
      expect(res.scope).toBe('Scope: ui workspace, 1 repository');
      expect(res.data?.repo).toBe(normalizePath(join(parent, 'mono')));
      // The rest of that repository is the same repository; other projects are still refused.
      const other = await s.call('build', { repo: join(parent, 'orbit-app') });
      expect(other.isError).toBe(true);
    } finally {
      await s.close();
    }
  });
});

describe('resolveScope and helpers', () => {
  it('prefers --workspace, then --repo, then a working directory inside a repository', async () => {
    const api = join(tasks, 'api');
    expect(await resolveScope({ workspaces: [tasks, tasks], repo: api, cwd: parent })).toEqual({
      roots: [normalizePath(tasks)],
      source: 'workspace',
    });
    expect(await resolveScope({ repo: api, cwd: parent })).toEqual({
      roots: [normalizePath(api)],
      source: 'repo',
    });
    expect(await resolveScope({ cwd: join(api, 'src') })).toEqual({
      roots: [normalizePath(join(api, 'src'))],
      source: 'cwd',
    });
    expect(await resolveScope({ cwd: parent })).toBeUndefined();
    expect(await resolveScope({ workspaces: [], cwd: tasks })).toBeUndefined();
  });

  it('isInside compares whole path segments', () => {
    expect(isInside('/w/Acme/api', '/w/Acme')).toBe(true);
    expect(isInside('/w/Acme', '/w/Acme/')).toBe(true);
    expect(isInside('/w/Acme-old', '/w/Acme')).toBe(false);
    expect(isInside('/w', '/w/Acme')).toBe(false);
    expect(isInside('/anything', '/')).toBe(true);
  });

  it('scopeLine names the folders and counts the repositories', () => {
    expect(scopeLine({ roots: ['/w/Acme'], source: 'workspace' }, 5)).toBe(
      'Scope: Acme workspace, 5 repositories',
    );
    expect(scopeLine({ roots: ['/w/a', '/w/b'], source: 'workspace' }, 1)).toBe(
      'Scope: a + b workspace, 1 repository',
    );
  });
});
