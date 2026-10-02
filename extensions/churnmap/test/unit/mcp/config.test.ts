import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../../mcp/src/args.js';
import { normalizePath } from '../../../src/analysis/gitLog.js';
import { resolveRepo, toRepoPath } from '../../../mcp/src/repo.js';
import { DEFAULT_SETTINGS, DEFAULT_WINDOW } from '../../../mcp/src/settings.js';
import {
  AGENT_CONFIGS,
  ConfigParseError,
  configuredServerPath,
  entryUpdate,
  mergeServerConfig,
  serverEntry,
  updateServerEntry,
} from '../../../src/ai/mcpConfig.js';

const OLD = '/home/u/.vscode/extensions/indrasol.churnmap-0.1.0/dist/mcp-server.js';
const NEW = '/home/u/.vscode/extensions/indrasol.churnmap-0.2.0/dist/mcp-server.js';
const entry = serverEntry('cursor', { serverPath: OLD, cacheDir: '/store' });

describe('mergeServerConfig', () => {
  it('creates a new file with just the churnmap server', () => {
    expect(JSON.parse(mergeServerConfig(undefined, 'mcpServers', entry))).toEqual({
      mcpServers: { churnmap: { command: 'node', args: [OLD, '--cache-dir', '/store'] } },
    });
  });

  it('keeps unknown keys and other servers, updates the path, indents with 2 spaces', () => {
    const existing = JSON.stringify({
      mcpServers: { other: { command: 'x' }, churnmap: { command: 'node', args: ['/old.js'] } },
      extra: { keep: true },
    });
    const text = mergeServerConfig(existing, 'mcpServers', entry);
    expect(JSON.parse(text)).toEqual({
      mcpServers: { other: { command: 'x' }, churnmap: entry },
      extra: { keep: true },
    });
    expect(text).toContain('\n  "mcpServers": {\n    "other"');
    expect(text.endsWith('}\n')).toBe(true);
  });

  it('refuses files it cannot read safely (comments, arrays, a non-object servers key)', () => {
    for (const bad of ['// comment\n{}', '[]', '{"mcpServers": []}', '{ broken']) {
      expect(() => mergeServerConfig(bad, 'mcpServers', entry)).toThrow(ConfigParseError);
    }
  });

  it('VS Code files use "servers" and a stdio type; --repo is added when given', () => {
    const vs = serverEntry('vscode', { serverPath: NEW, cacheDir: '/s', repo: '/r' });
    expect(vs).toEqual({
      type: 'stdio',
      command: 'node',
      args: [NEW, '--cache-dir', '/s', '--repo', '/r'],
    });
    expect(AGENT_CONFIGS.vscode).toEqual({
      target: 'vscode',
      file: '.vscode/mcp.json',
      key: 'servers',
    });
    expect(AGENT_CONFIGS.cursor.file).toBe('.cursor/mcp.json');
    expect(AGENT_CONFIGS.claude.file).toBe('.mcp.json');
  });

  it('names every workspace folder with its own --workspace, before --repo', () => {
    expect(
      serverEntry('cursor', {
        serverPath: NEW,
        cacheDir: '/s',
        workspaces: ['/w/Acme', '/w/other'],
        repo: '/w/Acme/api',
      }).args,
    ).toEqual([
      NEW,
      '--cache-dir',
      '/s',
      '--workspace',
      '/w/Acme',
      '--workspace',
      '/w/other',
      '--repo',
      '/w/Acme/api',
    ]);
    expect(serverEntry('claude', { serverPath: NEW, cacheDir: '/s', workspaces: [] }).args).toEqual(
      [NEW, '--cache-dir', '/s'],
    );
  });
});

describe('updating existing entries (server path and workspace)', () => {
  const text = mergeServerConfig(undefined, 'mcpServers', entry);
  const current = serverEntry('cursor', {
    serverPath: NEW,
    cacheDir: '/store',
    workspaces: ['/w'],
  });
  const currentText = mergeServerConfig(undefined, 'mcpServers', current);

  it('finds a churnmap entry pointing at another dist/mcp-server.js, or naming no workspace', () => {
    expect(configuredServerPath(text, 'mcpServers')).toBe(OLD);
    expect(entryUpdate(text, 'mcpServers', NEW)).toEqual({ stalePath: true, noWorkspace: true });
    expect(entryUpdate(text, 'mcpServers', OLD)).toEqual({ stalePath: false, noWorkspace: true });
    expect(entryUpdate(currentText, 'mcpServers', NEW)).toBeUndefined();
    expect(entryUpdate(currentText, 'mcpServers', OLD)).toEqual({
      stalePath: true,
      noWorkspace: false,
    });
    expect(entryUpdate(undefined, 'mcpServers', NEW)).toBeUndefined();
    expect(entryUpdate('{ nope', 'mcpServers', NEW)).toBeUndefined();
    // Servers Churnmap did not write (the Cursor plugin's npx entry, a user's own) are left alone.
    const foreign = JSON.stringify({ mcpServers: { churnmap: { args: ['/my/own/server.js'] } } });
    expect(entryUpdate(foreign, 'mcpServers', NEW)).toBeUndefined();
    const npx = JSON.stringify({
      mcpServers: { churnmap: { command: 'npx', args: ['-y', '@indrasol/churnmap-mcp'] } },
    });
    expect(entryUpdate(npx, 'mcpServers', NEW)).toBeUndefined();
  });

  it('one update fixes both: the current path, --workspace after --cache-dir, other arguments kept', () => {
    const old = mergeServerConfig(
      JSON.stringify({ mcpServers: { other: { command: 'x' } }, keep: 1 }),
      'mcpServers',
      serverEntry('cursor', { serverPath: OLD, cacheDir: '/store', repo: '/w/api' }),
    );
    const updated = JSON.parse(
      updateServerEntry(old, 'mcpServers', { serverPath: NEW, workspaces: ['/w', '/v'] }),
    ) as { mcpServers: Record<string, { command: string; args: string[] }>; keep: number };
    expect(updated.mcpServers.churnmap).toEqual({
      command: 'node',
      args: [
        NEW,
        '--cache-dir',
        '/store',
        '--workspace',
        '/w',
        '--workspace',
        '/v',
        '--repo',
        '/w/api',
      ],
    });
    expect(updated.mcpServers.other).toEqual({ command: 'x' });
    expect(updated.keep).toBe(1);
  });

  it('keeps the workspaces an entry already names; only the path changes', () => {
    const stale = mergeServerConfig(
      undefined,
      'servers',
      serverEntry('vscode', { serverPath: OLD, cacheDir: '/s', workspaces: ['/mine'] }),
    );
    const updated = JSON.parse(
      updateServerEntry(stale, 'servers', { serverPath: NEW, workspaces: ['/other'] }),
    ) as { servers: { churnmap: { type: string; args: string[] } } };
    expect(updated.servers.churnmap).toEqual({
      type: 'stdio',
      command: 'node',
      args: [NEW, '--cache-dir', '/s', '--workspace', '/mine'],
    });
  });
});

describe('server arguments', () => {
  it('parses --cache-dir, --repo and --git', () => {
    expect(parseArgs(['--cache-dir', '/s', '--repo', '/r', '--git', '/usr/bin/git'])).toEqual({
      kind: 'run',
      cacheDir: '/s',
      repo: '/r',
      git: '/usr/bin/git',
    });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('collects repeated --workspace flags in order; each must be absolute', () => {
    expect(
      parseArgs(['--cache-dir', '/s', '--workspace', '/a', '--repo', '/a/r', '--workspace', '/b']),
    ).toEqual({ kind: 'run', cacheDir: '/s', workspaces: ['/a', '/b'], repo: '/a/r' });
    expect(parseArgs(['--cache-dir', '/s'])).toEqual({ kind: 'run', cacheDir: '/s' });
    expect(parseArgs(['--cache-dir', '/s', '--workspace', 'rel'])).toMatchObject({
      kind: 'error',
      message: '--workspace must be an absolute path',
    });
    expect(parseArgs(['--cache-dir', '/s', '--workspace'])).toMatchObject({
      kind: 'error',
      message: '--workspace needs a value',
    });
  });

  it('rejects a missing or relative cache dir, unknown flags and missing values', () => {
    expect(parseArgs([])).toMatchObject({ kind: 'error', message: '--cache-dir is required' });
    expect(parseArgs(['--cache-dir', 'rel'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['--cache-dir', '/s', '--repo', 'rel'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['--cache-dir'])).toMatchObject({ kind: 'error' });
    expect(parseArgs(['--cache-dir', '/s', '--evil', 'x'])).toMatchObject({ kind: 'error' });
  });
});

describe('repository resolution', () => {
  it('uses the argument, then --repo, then cwd; refuses "..", missing and non-repository folders', async () => {
    const work = realpathSync.native(mkdtempSync(join(tmpdir(), 'cm-repo-')));
    try {
      mkdirSync(join(work, 'r', '.git'), { recursive: true });
      mkdirSync(join(work, 'r', 'sub'));
      mkdirSync(join(work, 'plain'));
      writeFileSync(join(work, 'r', '.git', 'HEAD'), `${'a'.repeat(40)}\n`);
      const repo = join(work, 'r');
      const fromCwd = await resolveRepo(undefined, { cwd: join(repo, 'sub') });
      expect(fromCwd).toEqual({ ok: true, repoRoot: normalizePath(repo), head: 'a'.repeat(40) });
      expect(await resolveRepo(undefined, { repo, cwd: '/' })).toMatchObject({ ok: true });
      expect(await resolveRepo('sub', { repo, cwd: '/' })).toMatchObject({
        ok: true,
        repoRoot: normalizePath(repo),
      });
      for (const bad of [`${repo}/../r`, '../r', join(work, 'missing'), join(work, 'plain')]) {
        expect(await resolveRepo(bad, { cwd: work })).toMatchObject({ ok: false });
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('toRepoPath keeps paths inside the repository only', () => {
    expect(toRepoPath('/r', 'src/a.ts')).toBe('src/a.ts');
    expect(toRepoPath('/r', './src/a.ts')).toBe('src/a.ts');
    expect(toRepoPath('/r', '/r/src/a.ts')).toBe('src/a.ts');
    for (const bad of ['/etc/passwd', '../x', 'a/../../x', '/r', '']) {
      expect(toRepoPath('/r', bad)).toBeUndefined();
    }
  });
});

describe('server defaults', () => {
  it('match the extension’s settings defaults, so both share a cache entry', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      contributes: { configuration: { properties: Record<string, { default: unknown }> } };
    };
    const props = manifest.contributes.configuration.properties;
    expect(DEFAULT_SETTINGS.exclude).toEqual(props['churnmap.exclude']?.default);
    expect(DEFAULT_SETTINGS.maxFiles).toBe(props['churnmap.maxFiles']?.default);
    expect(DEFAULT_SETTINGS.fixKeywords).toBe(props['churnmap.fixKeywords']?.default);
    expect(DEFAULT_SETTINGS.rank).toBe(props['churnmap.rank']?.default);
    expect(DEFAULT_WINDOW).toBe(props['churnmap.window']?.default);
  });
});
