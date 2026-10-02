import type { RunGit, RunGitOptions } from '../../../src/analysis/gitProcess.js';
import type { CommitRecord } from '../../../src/analysis/model.js';

/** Encodes commits the way `git log -z --numstat --format=%x1e%H%x1f…` prints them. */
export function formatLog(commits: readonly CommitRecord[]): Buffer {
  const parts: string[] = [];
  for (const c of commits) {
    parts.push(
      `\x1e${c.sha}\x1f${c.authorName}\x1f${c.authorEmail}\x1f${String(c.timestamp)}\x1f${c.subject}\x00`,
    );
    if (c.files.length > 0) parts.push('\n');
    for (const f of c.files) {
      const counts = f.binary ? '-\t-\t' : `${String(f.added)}\t${String(f.deleted)}\t`;
      parts.push(
        f.renamedFrom ? `${counts}\x00${f.renamedFrom}\x00${f.path}\x00` : `${counts}${f.path}\x00`,
      );
    }
  }
  return Buffer.from(parts.join(''), 'utf8');
}

export interface FakeGit {
  run: RunGit;
  calls: string[][];
}

/**
 * A fake `runGit` answering by the first matching argument prefix. A function answer receives the
 * args; an Error answer rejects. Streams to `onStdout` when asked.
 */
export function fakeGit(
  answers: [
    prefix: string,
    answer: Buffer | string | Error | ((args: readonly string[]) => Buffer | string | Error),
  ][],
): FakeGit {
  const calls: string[][] = [];
  const run: RunGit = (_gitPath, args, opts: RunGitOptions) => {
    calls.push([...args]);
    const key = args.join(' ');
    const found = answers.find(([prefix]) => key.startsWith(prefix));
    let answer = found?.[1] ?? '';
    if (typeof answer === 'function') answer = answer(args);
    if (answer instanceof Error) return Promise.reject(answer);
    const out = typeof answer === 'string' ? Buffer.from(answer) : answer;
    if (opts.onStdout) {
      opts.onStdout(out);
      return Promise.resolve({ stdout: Buffer.alloc(0), stderr: '' });
    }
    return Promise.resolve({ stdout: out, stderr: '' });
  };
  return { run, calls };
}

/** Fisher–Yates with a seeded LCG, so a "shuffled" test is reproducible. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = s % (i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
