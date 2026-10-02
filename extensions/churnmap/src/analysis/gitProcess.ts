import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * The only place Churnmap starts a process (ADR-0012). Every invocation:
 * - uses `spawn` with an argument array, never a shell;
 * - passes `-c core.pager=cat -c core.fsmonitor=false -c core.hooksPath=<empty dir>`, so a
 *   repository's own config cannot make git run a program;
 * - sets `GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 GIT_CONFIG_NOSYSTEM=1`.
 * Callers put `--` before every path list and never pass user text as an argument.
 */

export type GitErrorKind =
  'not-a-repository' | 'dubious-ownership' | 'not-found' | 'aborted' | 'failed';

export class GitError extends Error {
  override readonly name = 'GitError';

  constructor(
    readonly kind: GitErrorKind,
    /** Plain-language message with the fix, safe to show to the user. */
    readonly userMessage: string,
    detail?: string,
  ) {
    super(detail ?? userMessage);
  }
}

export function notFoundError(): GitError {
  return new GitError(
    'not-found',
    'Churnmap needs git, and it was not found. Install git, or set the "git.path" setting to the git executable.',
  );
}

export function abortedError(): GitError {
  return new GitError('aborted', 'Churnmap: analysis cancelled.');
}

/** Maps a failed git run to a typed error from its exit code and stderr. */
export function classifyGitFailure(exitCode: number | null, stderr: string, cwd: string): GitError {
  const text = stderr.toLowerCase();
  if (text.includes('detected dubious ownership') || text.includes('safe.directory')) {
    return new GitError(
      'dubious-ownership',
      `Git refuses to read this repository because another user owns it. If you trust it, add an exception. Run: git config --global --add safe.directory "${cwd}"`,
      firstLine(stderr),
    );
  }
  if (text.includes('not a git repository')) {
    return new GitError(
      'not-a-repository',
      'This folder is not inside a git repository. Open a folder that is a git clone, then run "Churnmap: Build city" again.',
      firstLine(stderr),
    );
  }
  const reason = firstLine(stderr) || `exit code ${String(exitCode)}`;
  return new GitError('failed', `Git failed: ${reason}`, reason);
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

/** The part of a child process that `runGit` uses, so tests can pass a fake. */
export interface ChildProcessLike {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  kill(): boolean;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessLike;

export interface GitProcessDeps {
  spawn: SpawnFn;
  /** Resolves when `file` exists and passes the access check for `mode`. */
  access: (file: string, mode: number) => Promise<void>;
  isDirectory: (dir: string) => Promise<boolean>;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

export const defaultDeps: GitProcessDeps = {
  spawn: (command, args, options) => nodeSpawn(command, args, options),
  access: (file, mode) => fs.access(file, mode),
  isDirectory: async (dir) => {
    try {
      return (await fs.stat(dir)).isDirectory();
    } catch {
      return false;
    }
  },
  env: process.env,
  platform: process.platform,
};

export const SAFETY_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_CONFIG_NOSYSTEM: '1',
} as const;

/** The `-c` flags that neutralise repository-supplied programs (ADR-0012). */
export function safetyArgs(hooksDir: string): string[] {
  return ['-c', 'core.pager=cat', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${hooksDir}`];
}

const STDERR_CAP = 64 * 1024;

export interface RunGitOptions {
  cwd: string;
  /** An existing empty directory, used as `core.hooksPath`. */
  hooksDir: string;
  signal?: AbortSignal | undefined;
  /** Receives stdout as it arrives; when set, the result's `stdout` is empty. */
  onStdout?: ((chunk: Buffer) => void) | undefined;
}

export interface RunGitResult {
  stdout: Buffer;
  stderr: string;
}

export type RunGit = (
  gitPath: string,
  args: readonly string[],
  opts: RunGitOptions,
) => Promise<RunGitResult>;

/** Runs git with the safety flags and environment. Rejects with a `GitError`. */
export async function runGit(
  gitPath: string,
  args: readonly string[],
  opts: RunGitOptions,
  deps: GitProcessDeps = defaultDeps,
): Promise<RunGitResult> {
  if (!path.isAbsolute(opts.hooksDir) || !(await deps.isDirectory(opts.hooksDir))) {
    throw new GitError(
      'failed',
      'Churnmap could not prepare its private hooks folder.',
      `hooks dir missing: ${opts.hooksDir}`,
    );
  }
  return execute(gitPath, [...safetyArgs(opts.hooksDir), ...args], opts, deps);
}

let spawned = 0;

/** How many processes Churnmap has started this session (tests assert nothing ran). */
export function spawnCount(): number {
  return spawned;
}

/** The single spawn call site. */
function execute(
  gitPath: string,
  argv: readonly string[],
  opts: Omit<RunGitOptions, 'hooksDir'>,
  deps: GitProcessDeps,
): Promise<RunGitResult> {
  const { signal, onStdout, cwd } = opts;
  if (signal?.aborted) return Promise.reject(abortedError());

  return new Promise<RunGitResult>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    spawned += 1;
    const child = deps.spawn(gitPath, argv, {
      cwd,
      env: { ...deps.env, ...SAFETY_ENV },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onAbort = (): void => {
      child.kill();
      finish(() => {
        reject(abortedError());
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stderrBytes = 0;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      if (onStdout) onStdout(chunk);
      else stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= STDERR_CAP) return;
      const room = STDERR_CAP - stderrBytes;
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      stderrChunks.push(kept);
      stderrBytes += kept.length;
    });

    child.on('error', (err) => {
      finish(() => {
        reject(
          err.code === 'ENOENT'
            ? notFoundError()
            : new GitError('failed', `Git could not be started: ${err.message}`, err.message),
        );
      });
    });

    child.on('close', (code) => {
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      finish(() => {
        if (code === 0) resolve({ stdout: Buffer.concat(stdoutChunks), stderr });
        else reject(classifyGitFailure(code, stderr, cwd));
      });
    });
  });
}

export type GitResolution =
  | { ok: true; gitPath: string; version: string }
  | { ok: false; reason: 'not-found' | 'not-executable' };

/**
 * Picks the git executable: the `git.path` setting if it is set and executable, else `git` on
 * PATH, resolved to an absolute path. Verified with `git --version`.
 */
export async function resolveGit(
  configuredPath: string | undefined,
  deps: GitProcessDeps = defaultDeps,
): Promise<GitResolution> {
  let configuredNotExecutable = false;
  const configured = configuredPath?.trim();
  if (configured) {
    if (await isExecutable(configured, deps)) {
      const version = await gitVersion(configured, deps);
      if (version) return { ok: true, gitPath: configured, version };
    }
    configuredNotExecutable = await exists(configured, deps);
  }

  const onPath = await findOnPath(deps);
  if (onPath) {
    const version = await gitVersion(onPath, deps);
    if (version) return { ok: true, gitPath: onPath, version };
  }
  return { ok: false, reason: configuredNotExecutable ? 'not-executable' : 'not-found' };
}

async function isExecutable(file: string, deps: GitProcessDeps): Promise<boolean> {
  if (!path.isAbsolute(file)) return false;
  try {
    await deps.access(file, deps.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return !(await deps.isDirectory(file));
  } catch {
    return false;
  }
}

async function exists(file: string, deps: GitProcessDeps): Promise<boolean> {
  try {
    await deps.access(file, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Looks `git` up on PATH ourselves, so the process is always started by absolute path. */
export async function findOnPath(deps: GitProcessDeps = defaultDeps): Promise<string | undefined> {
  const win = deps.platform === 'win32';
  const pathVar = deps.env.PATH ?? deps.env.Path ?? '';
  const dirs = pathVar.split(win ? ';' : ':').filter((dir) => dir && path.isAbsolute(dir));
  // git.cmd is a batch file and would need a shell, so only git.exe is accepted on Windows.
  const name = win ? 'git.exe' : 'git';
  const paths = win ? path.win32 : path.posix;
  for (const dir of dirs) {
    const candidate = paths.join(dir, name);
    if (await isExecutable(candidate, deps)) return candidate;
  }
  return undefined;
}

async function gitVersion(gitPath: string, deps: GitProcessDeps): Promise<string | undefined> {
  try {
    const { stdout } = await execute(gitPath, ['--version'], { cwd: path.dirname(gitPath) }, deps);
    const match = stdout
      .toString('utf8')
      .trim()
      .match(/^git version (\S+)/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Creates the directory used as `core.hooksPath` and makes sure it is empty, then returns its
 * absolute path. An empty hooks path means git finds no hook to run.
 */
export async function prepareHooksDir(storageDir: string): Promise<string> {
  const dir = path.join(storageDir, 'hooks-empty');
  await fs.mkdir(dir, { recursive: true });
  if ((await fs.readdir(dir)).length > 0) {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
  }
  return dir;
}
