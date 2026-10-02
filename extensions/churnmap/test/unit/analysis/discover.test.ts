import { describe, expect, it, vi } from 'vitest';
import {
  type DirEntry,
  discoverRepositories,
  type DiscoveryFs,
  MAX_CANDIDATES,
} from '../../../src/analysis/discover.js';

// The fake filesystem below uses POSIX paths on every OS, so discovery joins them the POSIX way
// (on Windows the real folders come in with backslashes and `path.join` keeps them).
vi.mock('node:path', async () => {
  const { posix } = await vi.importActual<typeof import('node:path')>('node:path');
  return { ...posix, default: posix };
});

/**
 * A fake filesystem from a list of paths: a trailing `/` is a folder, anything else a file.
 * Parent folders are implied. Counts `readdir` calls per folder.
 */
function fakeFs(paths: readonly string[]): DiscoveryFs & { reads: string[] } {
  const children = new Map<string, Map<string, DirEntry['kind']>>();
  const folder = (dir: string): Map<string, DirEntry['kind']> => {
    let entries = children.get(dir);
    if (!entries) {
      entries = new Map();
      children.set(dir, entries);
    }
    return entries;
  };
  for (const raw of paths) {
    const parts = raw.replace(/\/$/, '').split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const parent = folder(`/${parts.slice(0, i).join('/')}`);
      const isDir = i < parts.length - 1 || raw.endsWith('/');
      const name = parts[i] ?? '';
      if (isDir) {
        parent.set(name, 'dir');
        folder(`/${parts.slice(0, i + 1).join('/')}`);
      } else if (!parent.has(name)) {
        parent.set(name, 'file');
      }
    }
  }
  const reads: string[] = [];
  return {
    reads,
    readdir(dir) {
      reads.push(dir);
      const entries = children.get(dir);
      if (!entries) return Promise.reject(new Error(`ENOENT ${dir}`));
      return Promise.resolve([...entries].map(([name, kind]) => ({ name, kind })));
    },
  };
}

/** A real-world shape: an umbrella repo of docs, with the code in four nested repos. */
const ACME = [
  '/w/Acme/.git/HEAD',
  '/w/Acme/.git/refs/heads/main',
  '/w/Acme/.gitignore',
  '/w/Acme/STATUS.md',
  '/w/Acme/SESSION_HANDOFF.md',
  '/w/Acme/STATUS_TRACKER.html',
  '/w/Acme/screenshots/home.png',
  '/w/Acme/Acme-Backend/.git/HEAD',
  '/w/Acme/Acme-Backend/app/main.py',
  '/w/Acme/Acme-Backend/.venv/lib/site/.git/HEAD', // never walked
  '/w/Acme/acme-frontend/.git/HEAD',
  '/w/Acme/acme-frontend/src/App.tsx',
  '/w/Acme/acme-frontend/node_modules/pkg/.git/HEAD', // never walked
  '/w/Acme/acmekit-docs/.git', // a worktree: `.git` is a file
  '/w/Acme/acmekit-docs/index.md',
  '/w/Acme/acmekit-python/.git/HEAD',
  '/w/Acme/acmekit-python/sdk/client.py',
];

describe('discoverRepositories', () => {
  it('finds the umbrella and its four nested repositories (one a worktree `.git` file)', async () => {
    const dfs = fakeFs(ACME);
    const { candidates, truncated } = await discoverRepositories(['/w/Acme'], dfs);
    expect(truncated).toBe(false);
    expect(candidates).toEqual([
      { root: '/w/Acme', name: 'Acme', isNested: false, workspaceFolder: '/w/Acme' },
      {
        root: '/w/Acme/Acme-Backend',
        name: 'Acme-Backend',
        isNested: true,
        parentRoot: '/w/Acme',
        workspaceFolder: '/w/Acme',
      },
      {
        root: '/w/Acme/acme-frontend',
        name: 'acme-frontend',
        isNested: true,
        parentRoot: '/w/Acme',
        workspaceFolder: '/w/Acme',
      },
      {
        root: '/w/Acme/acmekit-docs',
        name: 'acmekit-docs',
        isNested: true,
        parentRoot: '/w/Acme',
        workspaceFolder: '/w/Acme',
      },
      {
        root: '/w/Acme/acmekit-python',
        name: 'acmekit-python',
        isNested: true,
        parentRoot: '/w/Acme',
        workspaceFolder: '/w/Acme',
      },
    ]);
  });

  it('never walks node_modules, virtual environments, build output or .git internals', async () => {
    const dfs = fakeFs([
      ...ACME,
      '/w/Acme/dist/x/.git/HEAD',
      '/w/Acme/build/y/.git/HEAD',
      '/w/Acme/venv/z/.git/HEAD',
    ]);
    await discoverRepositories(['/w/Acme'], dfs);
    const walked = dfs.reads.join('\n');
    for (const skipped of ['node_modules', '.venv', '/venv', '/dist', '/build', '/.git']) {
      expect(walked).not.toContain(skipped);
    }
  });

  it('skips folders matching churnmap.exclude', async () => {
    const { candidates } = await discoverRepositories(['/w/Acme'], fakeFs(ACME), {
      exclude: ['**/acmekit-*/**', 'Acme-Backend/'],
    });
    expect(candidates.map((c) => c.name)).toEqual(['Acme', 'acme-frontend']);
  });

  it('looks 3 folders deep and no deeper', async () => {
    const dfs = fakeFs([
      '/w/a/b/c/.git/HEAD', // depth 3: found
      '/w/a/b/c/d/.git/HEAD', // depth 4: not
      '/w/e/f/.git/HEAD', // depth 2: found
    ]);
    const { candidates } = await discoverRepositories(['/w'], dfs);
    expect(candidates.map((c) => c.root)).toEqual(['/w/e/f', '/w/a/b/c']);
    expect(candidates.every((c) => c.isNested && c.parentRoot === undefined)).toBe(true);
    expect(dfs.reads).not.toContain('/w/a/b/c/d');
  });

  it('records the closest enclosing repository as the parent', async () => {
    const { candidates } = await discoverRepositories(
      ['/w'],
      fakeFs(['/w/.git/HEAD', '/w/apps/.git/HEAD', '/w/apps/web/.git/HEAD']),
    );
    expect(candidates.map((c) => [c.root, c.parentRoot])).toEqual([
      ['/w', undefined],
      ['/w/apps', '/w'],
      ['/w/apps/web', '/w/apps'],
    ]);
  });

  it(`stops at ${String(MAX_CANDIDATES)} candidates`, async () => {
    const many = Array.from(
      { length: 80 },
      (_, i) => `/w/r${String(i).padStart(2, '0')}/.git/HEAD`,
    );
    const { candidates, truncated } = await discoverRepositories(['/w'], fakeFs(many));
    expect(candidates).toHaveLength(MAX_CANDIDATES);
    expect(truncated).toBe(true);
  });

  it('stops the walk after the directory budget', async () => {
    const wide = Array.from({ length: 300 }, (_, i) => `/w/d${String(i)}/`);
    const dfs = fakeFs([...wide, '/w/zzz/.git/HEAD']);
    const { dirs, truncated, candidates } = await discoverRepositories(['/w'], dfs, {
      maxDirs: 100,
    });
    expect(dirs).toBe(100);
    expect(dfs.reads).toHaveLength(100);
    expect(truncated).toBe(true);
    expect(candidates).toEqual([]);
  });

  it('handles multi-root workspaces, once per repository, in folder order', async () => {
    const dfs = fakeFs(['/w/b/.git/HEAD', '/w/a/.git/HEAD', '/w/a/sub/.git/HEAD', '/w/docs/x.md']);
    const { candidates } = await discoverRepositories(['/w/b', '/w/a', '/w/a/sub', '/w/docs'], dfs);
    expect(candidates.map((c) => [c.root, c.isNested])).toEqual([
      ['/w/b', false],
      ['/w/a', false],
      ['/w/a/sub', true],
    ]);
  });

  it('skips folders it cannot read, and symbolic links', async () => {
    const dfs: DiscoveryFs = {
      readdir: (dir) =>
        dir === '/w'
          ? Promise.resolve([
              { name: 'locked', kind: 'dir' },
              { name: 'link', kind: 'other' },
              { name: 'ok', kind: 'dir' },
            ])
          : dir === '/w/ok'
            ? Promise.resolve([{ name: '.git', kind: 'dir' }])
            : Promise.reject(new Error('EACCES')),
    };
    const { candidates } = await discoverRepositories(['/w'], dfs);
    expect(candidates.map((c) => c.root)).toEqual(['/w/ok']);
  });
});
