import { GitError, runGit as defaultRunGit, type RunGit } from './gitProcess.js';
import type { CommitRecord, FileChange, GitInfo, GitLogOptions } from './model.js';

const RS = 0x1e; // record separator: opens a commit (%x1e)
const US = 0x1f; // unit separator: between header fields (%x1f)
const NUL = 0x00;
const TAB = 0x09;
const LF = 0x0a;

const HEADER_FIELDS = 5; // sha, author name, author email, author time, subject

/** The exact `git log` arguments the parser understands. */
export function logArgs(since: string): string[] {
  return [
    'log',
    '-z',
    '--numstat',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--date=raw',
    '--find-renames',
    '--format=%x1e%H%x1f%aN%x1f%aE%x1f%at%x1f%s',
    `--since=${since}`,
    'HEAD',
    '--',
    '.',
  ];
}

const enum State {
  /** Before the first record, or skipping junk until the next RS. */
  Seek,
  Header,
  /** After the header's NUL: newlines, numstat rows, or the next RS. */
  Body,
  Added,
  Deleted,
  /** After "A\tD\t": a NUL means a rename (old NUL new NUL), anything else starts the path. */
  AfterCounts,
  Path,
  RenameOld,
  RenameNew,
}

/**
 * A one-pass byte state machine over `git log -z --numstat` output. Chunks may split records,
 * fields or multi-byte characters anywhere: delimiters are ASCII, so a field's bytes are only
 * decoded (as UTF-8) once the field is complete. Pending bytes are kept as slices, never
 * re-concatenated per chunk, so work is linear in the input.
 */
export class NumstatParser {
  private readonly commits: CommitRecord[] = [];
  private state = State.Seek;
  private parts: Buffer[] = [];
  private header: string[] = [];
  private current: CommitRecord | undefined;
  private added = '';
  private deleted = '';
  private renameOld = '';

  push(chunk: Buffer): void {
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      switch (this.state) {
        case State.Seek:
          if (byte === RS) {
            this.openRecord();
            start = i + 1;
          }
          break;
        case State.Header:
          if (byte === US && this.header.length < HEADER_FIELDS - 1) {
            this.header.push(this.take(chunk, start, i));
            start = i + 1;
          } else if (byte === NUL) {
            this.header.push(this.take(chunk, start, i));
            this.closeHeader();
            this.state = State.Body;
          }
          break;
        case State.Body:
          if (byte === RS) {
            this.openRecord();
            start = i + 1;
          } else if (byte !== LF && byte !== NUL) {
            this.state = State.Added;
            start = i;
          }
          break;
        case State.Added:
          if (byte === TAB) {
            this.added = this.take(chunk, start, i);
            this.state = State.Deleted;
            start = i + 1;
          }
          break;
        case State.Deleted:
          if (byte === TAB) {
            this.deleted = this.take(chunk, start, i);
            this.state = State.AfterCounts;
            start = i + 1;
          }
          break;
        case State.AfterCounts:
          if (byte === NUL) {
            this.state = State.RenameOld;
            start = i + 1;
          } else {
            this.state = State.Path;
            start = i;
          }
          break;
        case State.Path:
          if (byte === NUL) {
            this.addFile(this.take(chunk, start, i));
            this.state = State.Body;
          }
          break;
        case State.RenameOld:
          if (byte === NUL) {
            this.renameOld = this.take(chunk, start, i);
            this.state = State.RenameNew;
            start = i + 1;
          }
          break;
        case State.RenameNew:
          if (byte === NUL) {
            this.addFile(this.take(chunk, start, i), this.renameOld);
            this.state = State.Body;
          }
          break;
      }
    }
    if (this.isCollecting() && start < chunk.length) this.parts.push(chunk.subarray(start));
  }

  /** Flushes a trailing record that had no final NUL and returns every commit, in git order. */
  end(): CommitRecord[] {
    if (this.state === State.Header && this.header.length === HEADER_FIELDS - 1) {
      this.header.push(this.take(Buffer.alloc(0), 0, 0));
      this.closeHeader();
    } else if (this.state === State.Path && this.parts.length > 0) {
      this.addFile(this.take(Buffer.alloc(0), 0, 0));
    }
    this.finishRecord();
    this.state = State.Seek;
    return this.commits;
  }

  private isCollecting(): boolean {
    return (
      this.state !== State.Seek && this.state !== State.Body && this.state !== State.AfterCounts
    );
  }

  /** Decodes the pending parts plus `chunk[start, end)` as one UTF-8 string. */
  private take(chunk: Buffer, start: number, end: number): string {
    let text: string;
    if (this.parts.length === 0) {
      text = chunk.toString('utf8', start, end);
    } else {
      this.parts.push(chunk.subarray(start, end));
      text = Buffer.concat(this.parts).toString('utf8');
      this.parts = [];
    }
    return text;
  }

  private openRecord(): void {
    this.finishRecord();
    this.parts = [];
    this.header = [];
    this.state = State.Header;
  }

  private closeHeader(): void {
    const [sha = '', authorName = '', authorEmail = '', time = '', subject = ''] = this.header;
    const timestamp = Number.parseInt(time, 10);
    this.current = {
      sha,
      authorName,
      authorEmail,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      subject,
      files: [],
    };
  }

  private finishRecord(): void {
    if (this.current) this.commits.push(this.current);
    this.current = undefined;
  }

  private addFile(rawPath: string, renamedFrom?: string): void {
    if (!this.current) return;
    const binary = this.added === '-' && this.deleted === '-';
    const change: FileChange = {
      path: normalizePath(rawPath),
      added: binary ? 0 : toCount(this.added),
      deleted: binary ? 0 : toCount(this.deleted),
      binary,
    };
    if (renamedFrom !== undefined) change.renamedFrom = normalizePath(renamedFrom);
    this.current.files.push(change);
  }
}

function toCount(text: string): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Repository-relative paths always use forward slashes. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Parses a complete log held in memory. */
export function parseNumstatLogText(buf: Buffer): CommitRecord[] {
  const parser = new NumstatParser();
  parser.push(buf);
  return parser.end();
}

/** Parses a log arriving in chunks. */
export async function parseNumstatLog(
  chunks: AsyncIterable<Buffer> | Iterable<Buffer>,
): Promise<CommitRecord[]> {
  const parser = new NumstatParser();
  for await (const chunk of chunks) parser.push(chunk);
  return parser.end();
}

/** The unix-seconds start of the window, from `opts.since` or `now − window days`. */
export function windowStart(opts: GitLogOptions, nowMs = Date.now()): number {
  const since = opts.since?.getTime() ?? nowMs - opts.window * 86_400_000;
  return Math.floor(since / 1000);
}

/**
 * Commits reachable from HEAD in the window, newest first. Streams git's stdout into the parser,
 * then also filters on `timestamp >= since`, because `--since` stops at the first old commit it
 * meets and author dates can be out of order.
 */
export async function readCommits(
  gitPath: string,
  repoRoot: string,
  hooksDir: string,
  opts: GitLogOptions,
  run: RunGit = defaultRunGit,
): Promise<CommitRecord[]> {
  const since = windowStart(opts);
  const sinceArg = opts.since
    ? new Date(since * 1000).toISOString()
    : `${String(opts.window)}.days`;
  const parser = new NumstatParser();
  await run(gitPath, logArgs(sinceArg), {
    cwd: repoRoot,
    hooksDir,
    signal: opts.signal,
    onStdout: (chunk) => {
      parser.push(chunk);
    },
  });
  return parser.end().filter((commit) => commit.timestamp >= since);
}

async function revParse(
  gitPath: string,
  cwd: string,
  hooksDir: string,
  args: string[],
  run: RunGit,
  signal?: AbortSignal,
): Promise<string> {
  const { stdout } = await run(gitPath, ['rev-parse', ...args], { cwd, hooksDir, signal });
  return stdout.toString('utf8').trim();
}

export interface GitInfoOptions {
  /** From `resolveGit`, carried into the result. */
  version?: string;
  run?: RunGit;
  signal?: AbortSignal | undefined;
}

/** Repository root, HEAD and shallow state for the folder `cwd`. */
export async function getGitInfo(
  gitPath: string,
  cwd: string,
  hooksDir: string,
  opts: GitInfoOptions = {},
): Promise<GitInfo> {
  const { version = '', run = defaultRunGit, signal } = opts;
  const repoRoot = await revParse(gitPath, cwd, hooksDir, ['--show-toplevel'], run, signal);
  let head: string;
  try {
    head = await revParse(
      gitPath,
      repoRoot,
      hooksDir,
      ['--verify', '--quiet', 'HEAD'],
      run,
      signal,
    );
  } catch (err) {
    if (err instanceof GitError && err.kind !== 'failed') throw err;
    head = '';
  }
  if (!/^[0-9a-f]{40,64}$/.test(head)) {
    throw new GitError(
      'failed',
      'This repository has no commits yet, so there is no history to analyse.',
      'no commits yet',
    );
  }
  const shallow =
    (await revParse(gitPath, repoRoot, hooksDir, ['--is-shallow-repository'], run, signal)) ===
    'true';
  return { gitPath, version, repoRoot: normalizePath(repoRoot), head, shallow };
}
