import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyGitFailure,
  findOnPath,
  GitError,
  type GitProcessDeps,
  prepareHooksDir,
  resolveGit,
  runGit,
  SAFETY_ENV,
  type SpawnFn,
} from '../../../src/analysis/gitProcess.js';

interface Spawned {
  command: string;
  args: readonly string[];
  options: Parameters<SpawnFn>[2];
  child: FakeChild;
}

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }

  /** Emits stdout/stderr, then closes with `code`. */
  finish(code: number | null, stdout = '', stderr = ''): void {
    if (stdout) this.stdout.write(stdout);
    if (stderr) this.stderr.write(stderr);
    setImmediate(() => this.emit('close', code));
  }
}

type Behaviour = (child: FakeChild, args: readonly string[], command: string) => void;

/** Deps whose spawn records every call and lets `behave` drive the fake child. */
function fakeDeps(
  behave: Behaviour,
  overrides: Partial<GitProcessDeps> = {},
): { deps: GitProcessDeps; spawned: Spawned[] } {
  const spawned: Spawned[] = [];
  const deps: GitProcessDeps = {
    spawn: (command, args, options) => {
      const child = new FakeChild();
      spawned.push({ command, args, options, child });
      setImmediate(() => {
        behave(child, args, command);
      });
      return child;
    },
    access: () => Promise.resolve(),
    isDirectory: (dir) => Promise.resolve(dir === '/hooks'),
    env: { PATH: '/usr/local/bin:/usr/bin', HOME: '/home/me' },
    platform: 'linux',
    ...overrides,
  };
  return { deps, spawned };
}

const OPTS = { cwd: '/repo', hooksDir: '/hooks' };

describe('runGit', () => {
  it('starts git with the three -c safety flags first, and the safety environment', async () => {
    const { deps, spawned } = fakeDeps((child) => {
      child.finish(0, 'ok');
    });
    const result = await runGit('/usr/bin/git', ['ls-files', '-z', '--', '.'], OPTS, deps);
    expect(result.stdout.toString()).toBe('ok');

    const call = spawned[0];
    expect(call?.command).toBe('/usr/bin/git');
    expect(call?.args).toEqual([
      '-c',
      'core.pager=cat',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/hooks',
      'ls-files',
      '-z',
      '--',
      '.',
    ]);
    expect(call?.options.env).toMatchObject({ ...SAFETY_ENV, HOME: '/home/me' });
    expect(call?.options).toMatchObject({ cwd: '/repo', shell: false, windowsHide: true });
    expect(call?.options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
  });

  it('keeps "--" immediately before the path list', async () => {
    const { deps, spawned } = fakeDeps((child) => {
      child.finish(0);
    });
    await runGit('/git', ['log', '--numstat', 'HEAD', '--', '.'], OPTS, deps);
    const args = spawned[0]?.args ?? [];
    expect(args[args.indexOf('--') + 1]).toBe('.');
  });

  it('streams stdout to onStdout instead of collecting it', async () => {
    const { deps } = fakeDeps((child) => {
      child.stdout.write('ab');
      child.stdout.write('cd');
      child.finish(0);
    });
    const seen: string[] = [];
    const result = await runGit(
      '/git',
      ['log'],
      {
        ...OPTS,
        onStdout: (chunk) => {
          seen.push(chunk.toString());
        },
      },
      deps,
    );
    expect(seen.join('')).toBe('abcd');
    expect(result.stdout.length).toBe(0);
  });

  it('maps "not a git repository" to kind not-a-repository', async () => {
    const { deps } = fakeDeps((child) => {
      child.finish(
        128,
        '',
        'fatal: not a git repository (or any of the parent directories): .git\n',
      );
    });
    await expect(runGit('/git', ['log'], OPTS, deps)).rejects.toMatchObject({
      kind: 'not-a-repository',
    });
  });

  it('maps dubious ownership to kind dubious-ownership, with the safe.directory fix', async () => {
    const stderr =
      "fatal: detected dubious ownership in repository at '/repo'\n" +
      'To add an exception for this directory, call:\n\n\tgit config --global --add safe.directory /repo\n';
    const { deps } = fakeDeps((child) => {
      child.finish(128, '', stderr);
    });
    const err = await runGit('/git', ['log'], OPTS, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    expect(err).toMatchObject({ kind: 'dubious-ownership' });
    expect((err as GitError).userMessage).toContain(
      'Run: git config --global --add safe.directory "/repo"',
    );
  });

  it('maps other failures to kind failed with the first stderr line', async () => {
    const { deps } = fakeDeps((child) => {
      child.finish(1, '', '\nerror: something broke\nmore\n');
    });
    await expect(runGit('/git', ['log'], OPTS, deps)).rejects.toMatchObject({
      kind: 'failed',
      userMessage: 'Git failed: error: something broke',
    });
  });

  it('caps stderr at 64 KB', async () => {
    const { deps } = fakeDeps((child) => {
      child.stderr.write('x'.repeat(40 * 1024));
      child.stderr.write('y'.repeat(40 * 1024));
      child.stderr.write('z');
      child.finish(0);
    });
    const { stderr } = await runGit('/git', ['log'], OPTS, deps);
    expect(stderr.length).toBe(64 * 1024);
    expect(stderr.endsWith('y')).toBe(true);
  });

  it('maps ENOENT from spawn to kind not-found', async () => {
    const { deps } = fakeDeps((child) => {
      child.emit('error', Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
    });
    await expect(runGit('/nope/git', ['log'], OPTS, deps)).rejects.toMatchObject({
      kind: 'not-found',
    });
  });

  it('maps other spawn errors to kind failed', async () => {
    const { deps } = fakeDeps((child) => {
      child.emit('error', Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    });
    await expect(runGit('/git', ['log'], OPTS, deps)).rejects.toMatchObject({ kind: 'failed' });
  });

  it('kills the process and rejects with kind aborted when the signal fires', async () => {
    const controller = new AbortController();
    const { deps, spawned } = fakeDeps(() => {
      controller.abort();
    });
    await expect(
      runGit('/git', ['log'], { ...OPTS, signal: controller.signal }, deps),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(spawned[0]?.child.killed).toBe(true);
  });

  it('does not start git when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, spawned } = fakeDeps(() => undefined);
    await expect(
      runGit('/git', ['log'], { ...OPTS, signal: controller.signal }, deps),
    ).rejects.toMatchObject({ kind: 'aborted' });
    expect(spawned).toHaveLength(0);
  });

  it('refuses to run when the hooks directory does not exist', async () => {
    const { deps, spawned } = fakeDeps(() => undefined);
    await expect(
      runGit('/git', ['log'], { cwd: '/repo', hooksDir: '/missing' }, deps),
    ).rejects.toMatchObject({ kind: 'failed' });
    await expect(
      runGit('/git', ['log'], { cwd: '/repo', hooksDir: 'relative' }, deps),
    ).rejects.toBeInstanceOf(GitError);
    expect(spawned).toHaveLength(0);
  });
});

describe('classifyGitFailure', () => {
  it('recognises safe.directory hints on their own', () => {
    expect(classifyGitFailure(128, 'hint: safe.directory', '/r').kind).toBe('dubious-ownership');
  });

  it('falls back to the exit code when stderr is empty', () => {
    expect(classifyGitFailure(3, '', '/r').userMessage).toBe('Git failed: exit code 3');
  });
});

describe('resolveGit', () => {
  const versionOk: Behaviour = (child, args) => {
    child.finish(args[0] === '--version' ? 0 : 1, 'git version 2.50.1 (Apple Git-155)\n');
  };

  it('uses the configured path when it is executable', async () => {
    const { deps, spawned } = fakeDeps(versionOk);
    expect(await resolveGit('/opt/git/bin/git', deps)).toEqual({
      ok: true,
      gitPath: '/opt/git/bin/git',
      version: '2.50.1',
    });
    expect(spawned[0]?.args).toEqual(['--version']);
  });

  it('falls back to git on PATH, resolved to an absolute path', async () => {
    const { deps } = fakeDeps(versionOk, {
      access: (file) =>
        file === '/usr/bin/git' ? Promise.resolve() : Promise.reject(new Error('ENOENT')),
    });
    expect(await resolveGit(undefined, deps)).toMatchObject({ ok: true, gitPath: '/usr/bin/git' });
    expect(await resolveGit('   ', deps)).toMatchObject({ ok: true, gitPath: '/usr/bin/git' });
  });

  it('reports not-executable when the configured file exists but cannot run and PATH has none', async () => {
    const { deps } = fakeDeps(versionOk, {
      access: (file, mode) =>
        file === '/opt/git' && mode === 0 ? Promise.resolve() : Promise.reject(new Error('EACCES')),
    });
    expect(await resolveGit('/opt/git', deps)).toEqual({ ok: false, reason: 'not-executable' });
  });

  it('reports not-found when nothing works', async () => {
    const { deps } = fakeDeps(versionOk, { access: () => Promise.reject(new Error('ENOENT')) });
    expect(await resolveGit('relative/git', deps)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('rejects a binary whose --version output is not git', async () => {
    const { deps } = fakeDeps((child) => {
      child.finish(0, 'something else\n');
    });
    // The configured file exists but is not a working git, and PATH has no git either.
    expect(await resolveGit('/usr/bin/git', deps)).toEqual({ ok: false, reason: 'not-executable' });
    expect(await resolveGit(undefined, deps)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('rejects a directory', async () => {
    const { deps } = fakeDeps(versionOk, {
      env: { PATH: '' },
      isDirectory: () => Promise.resolve(true),
    });
    expect(await resolveGit('/usr/bin', deps)).toMatchObject({ ok: false });
  });
});

describe('findOnPath', () => {
  it('looks for git.exe on Windows with ; separators', async () => {
    const tried: string[] = [];
    const { deps } = fakeDeps(() => undefined, {
      platform: 'win32',
      env: { Path: 'C:\\Windows;C:\\Program Files\\Git\\cmd' },
      access: (file) => {
        tried.push(file);
        return file.endsWith('Git\\cmd\\git.exe') ? Promise.resolve() : Promise.reject(new Error());
      },
      isDirectory: () => Promise.resolve(false),
    });
    // path.isAbsolute on a POSIX host rejects C:\ paths, so nothing is found there; on Windows it is.
    const found = await findOnPath(deps);
    if (process.platform === 'win32') expect(found).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
    else expect(found).toBeUndefined();
  });

  it('skips relative PATH entries', async () => {
    const tried: string[] = [];
    const { deps } = fakeDeps(() => undefined, {
      env: { PATH: '.:bin:/usr/bin' },
      access: (file) => {
        tried.push(file);
        return Promise.reject(new Error());
      },
    });
    await findOnPath(deps);
    expect(tried).toEqual(['/usr/bin/git']);
  });
});

describe('prepareHooksDir', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates an empty hooks-empty folder and empties it if something appeared there', async () => {
    const storage = mkdtempSync(join(tmpdir(), 'cm-hooks-'));
    dirs.push(storage);
    const dir = await prepareHooksDir(storage);
    expect(dir).toBe(join(storage, 'hooks-empty'));
    writeFileSync(join(dir, 'pre-commit'), '#!/bin/sh\n');
    expect(await prepareHooksDir(storage)).toBe(dir);
    expect(readdirSync(dir)).toEqual([]);
  });
});
