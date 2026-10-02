import { describe, expect, it } from 'vitest';
import {
  changedHotspots,
  isWarningRank,
  rankText,
  rankTooltip,
  repoRelative,
  repoRoots,
  scmAccessibilityLabel,
  scmText,
} from '../../../src/daily/format.js';
import { hotspot } from '../panel/helpers.js';

describe('status text', () => {
  it('formats the rank item and warns for the top three', () => {
    expect(rankText(3)).toBe('$(flame) Hotspot #3');
    expect(rankText(7, 'watch')).toBe('$(flame) Watch #7');
    expect([1, 2, 3, 4, 20].map(isWarningRank)).toEqual([true, true, true, false, false]);
  });

  it('formats the SCM item in the singular and the plural', () => {
    expect(scmText(1)).toBe('$(warning) 1 hotspot in your changes');
    expect(scmText(2)).toBe('$(warning) 2 hotspots in your changes');
    expect(scmAccessibilityLabel(1)).toBe('1 hotspot is in your staged or working-tree changes');
    expect(scmAccessibilityLabel(3)).toBe('3 hotspots are in your staged or working-tree changes');
  });

  it('puts rank, band, score, trend and reasons in the tooltip', () => {
    const tip = rankTooltip(hotspot(2, 'src/a_b.ts', { trend: 'falling' }));
    expect(tip).toContain('**#2**: src/a\\_b.ts');
    expect(tip).toContain('Hotspot · score 82 · Complexity falling ↓');
    expect(tip).toContain('- Changed 41 times in 90 days (more often than 98% of files)');
  });
});

describe('repoRelative', () => {
  it('maps a file under a root to a forward-slash repository path', () => {
    expect(repoRelative(['/r/repo'], '/r/repo/src/a.ts', 'linux')).toBe('src/a.ts');
    expect(repoRelative(['/x', '/r/repo'], '/r/repo/a.ts', 'darwin')).toBe('a.ts');
  });

  it('refuses files outside every root, and the root itself', () => {
    expect(repoRelative(['/r/repo'], '/r/other/a.ts', 'linux')).toBeUndefined();
    expect(repoRelative(['/r/repo'], '/r/repository/a.ts', 'linux')).toBeUndefined();
    expect(repoRelative(['/r/repo'], '/r/repo', 'linux')).toBeUndefined();
    expect(repoRelative([], '/r/repo/a.ts', 'linux')).toBeUndefined();
  });

  it('handles Windows separators and case, keeping the file’s own spelling', () => {
    expect(repoRelative(['C:\\Work\\Repo'], 'c:\\work\\repo\\Src\\App.ts', 'win32')).toBe(
      'Src/App.ts',
    );
    expect(repoRelative(['C:\\Work\\Repo'], 'D:\\Work\\Repo\\a.ts', 'win32')).toBeUndefined();
    expect(repoRelative(['C:\\Work\\Repo'], 'C:\\Work\\Repo2\\a.ts', 'win32')).toBeUndefined();
  });
});

describe('repoRoots', () => {
  const realpath = (map: Record<string, string>) => (p: string) =>
    map[p] === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(map[p]);

  it('adds the spelling a symlinked workspace folder uses (macOS /var → /private/var)', async () => {
    const roots = await repoRoots(
      '/private/var/t/repo',
      ['/var/t/repo'],
      realpath({ '/var/t/repo': '/private/var/t/repo' }),
      'darwin',
    );
    expect(roots).toEqual(['/private/var/t/repo', '/var/t/repo']);
  });

  it('maps a subfolder workspace back to the repository root', async () => {
    const roots = await repoRoots(
      '/private/var/t/repo',
      ['/var/t/repo/packages/app/'],
      realpath({ '/var/t/repo/packages/app/': '/private/var/t/repo/packages/app' }),
      'darwin',
    );
    expect(roots).toEqual(['/private/var/t/repo', '/var/t/repo']);
  });

  it('ignores folders outside the repository and unreadable ones; no duplicates', async () => {
    const roots = await repoRoots(
      '/r/repo',
      ['/r/repo', '/elsewhere', '/missing', '/r/repository'],
      realpath({
        '/r/repo': '/r/repo',
        '/elsewhere': '/elsewhere',
        '/r/repository': '/r/repository',
      }),
      'linux',
    );
    expect(roots).toEqual(['/r/repo']);
  });

  it('compares Windows roots without regard to case or slashes', async () => {
    const roots = await repoRoots(
      'C:/Work/Repo',
      ['c:\\work\\repo'],
      realpath({ 'c:\\work\\repo': 'c:\\work\\repo' }),
      'win32',
    );
    expect(roots).toEqual(['C:/Work/Repo', 'c:\\work\\repo']);
  });
});

describe('changedHotspots', () => {
  const top = [
    hotspot(1, 'src/core/engine.js'),
    hotspot(2, 'src/api/handler.js'),
    hotspot(3, 'README.md'),
  ];

  it('intersects changed files with the top, in rank order, once each', () => {
    const hits = changedHotspots(
      '/r/repo',
      [
        '/r/repo/README.md',
        '/r/repo/src/core/engine.js',
        '/r/repo/src/core/engine.js',
        '/r/repo/new.ts',
      ],
      top,
      'linux',
    );
    expect(hits.map((h) => h.rank)).toEqual([1, 3]);
  });

  it('drops files outside the repository', () => {
    expect(changedHotspots('/r/repo', ['/r/other/README.md', '/README.md'], top, 'linux')).toEqual(
      [],
    );
  });

  it('maps Windows paths (backslashes, case) onto repository paths', () => {
    const hits = changedHotspots(
      'C:\\Repo',
      ['c:\\repo\\SRC\\api\\handler.js', 'C:\\Other\\README.md'],
      top,
      'win32',
    );
    expect(hits.map((h) => h.file.path)).toEqual(['src/api/handler.js']);
  });
});
