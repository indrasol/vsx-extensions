import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getGitInfo,
  logArgs,
  NumstatParser,
  parseNumstatLog,
  parseNumstatLogText,
  readCommits,
  windowStart,
} from '../../../src/analysis/gitLog.js';
import { GitError, type RunGit, type RunGitOptions } from '../../../src/analysis/gitProcess.js';
import type { CommitRecord } from '../../../src/analysis/model.js';

const FIXTURES = join(__dirname, '../../fixtures/gitlog');
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, `${name}.bin`));

function* chunked(buf: Buffer, size: number): Generator<Buffer> {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

const bot = { authorName: 'Fixture Bot', authorEmail: 'bot@example.com' };

describe('parseNumstatLogText', () => {
  it('parses basic.bin: commits newest first, numstat rows, authors', () => {
    expect(parseNumstatLogText(fixture('basic'))).toEqual<CommitRecord[]>([
      {
        sha: 'c97767e403c52d790fed43cbee94b7f945bdce89',
        ...bot,
        timestamp: 1767434400,
        subject: 'fix: shrink a',
        files: [
          { path: 'src/a.ts', added: 0, deleted: 1, binary: false },
          { path: 'src/b.ts', added: 1, deleted: 2, binary: false },
        ],
      },
      {
        sha: '6182d0a02cdd52dd77ed94d2d52d8c9cd5d3009d',
        authorName: 'Ada Lovelace',
        authorEmail: 'ada@example.com',
        timestamp: 1767348000,
        subject: 'Add b and grow a',
        files: [
          { path: 'src/a.ts', added: 2, deleted: 0, binary: false },
          { path: 'src/b.ts', added: 2, deleted: 0, binary: false },
        ],
      },
      {
        sha: '6544a5d754ec1738452a007d83d595ac425fced5',
        ...bot,
        timestamp: 1767261600,
        subject: 'Initial commit',
        files: [
          { path: 'README.md', added: 1, deleted: 0, binary: false },
          { path: 'src/a.ts', added: 3, deleted: 0, binary: false },
        ],
      },
    ]);
  });

  it('parses renames.bin: -z rename rows become path = new, renamedFrom = old', () => {
    expect(parseNumstatLogText(fixture('renames'))).toEqual<CommitRecord[]>([
      {
        sha: 'ea7b37bf3f315290eb734f99790b21d3918bd629',
        ...bot,
        timestamp: 1770112800,
        subject: 'Pure rename',
        files: [{ path: 'kept.ts', added: 0, deleted: 0, binary: false, renamedFrom: 'keep.ts' }],
      },
      {
        sha: 'a6cd28b370b97674c7cf2259f73c2f8d0c2196da',
        ...bot,
        timestamp: 1770026400,
        subject: 'Move and edit',
        files: [
          {
            path: 'new/name.ts',
            added: 1,
            deleted: 0,
            binary: false,
            renamedFrom: 'old/name.ts',
          },
        ],
      },
      {
        sha: '68fb6b2b3cfbe7e202c8791eab1dcbfdd35b6d85',
        ...bot,
        timestamp: 1769940000,
        subject: 'Add files',
        files: [
          { path: 'keep.ts', added: 1, deleted: 0, binary: false },
          { path: 'old/name.ts', added: 10, deleted: 0, binary: false },
        ],
      },
    ]);
  });

  it('parses binary.bin: "-\\t-" rows are binary with zero counts', () => {
    expect(parseNumstatLogText(fixture('binary'))).toEqual<CommitRecord[]>([
      {
        sha: 'b54e06fd53e4ef262c9dfc8ecd2707a561196af1',
        ...bot,
        timestamp: 1772445600,
        subject: 'Update logo',
        files: [
          { path: 'media/logo.png', added: 0, deleted: 0, binary: true },
          { path: 'notes.txt', added: 1, deleted: 0, binary: false },
        ],
      },
      {
        sha: 'bb9d37f44f29541e42f8593182ada82e82269fe6',
        ...bot,
        timestamp: 1772359200,
        subject: 'Add logo',
        files: [
          { path: 'media/logo.png', added: 0, deleted: 0, binary: true },
          { path: 'notes.txt', added: 1, deleted: 0, binary: false },
        ],
      },
    ]);
  });

  it('parses merges.bin: keeps the merge with no files, and an empty subject', () => {
    expect(parseNumstatLogText(fixture('merges'))).toEqual<CommitRecord[]>([
      {
        sha: '341300986b68be190f31ba3f2a614d9601cb7b54',
        ...bot,
        timestamp: 1775383200,
        subject: '',
        files: [{ path: 'main.ts', added: 1, deleted: 0, binary: false }],
      },
      {
        sha: '274f9f5c4f4f7af33f693027c570dc7aa3f5cebd',
        ...bot,
        timestamp: 1775296800,
        subject: "Merge branch 'feature'",
        files: [],
      },
      {
        sha: 'd925220177af4b45dc7696b544228f80cc9ea4cc',
        ...bot,
        timestamp: 1775210400,
        subject: 'Main work',
        files: [{ path: 'main.ts', added: 2, deleted: 0, binary: false }],
      },
      {
        sha: 'e4666a0de69233be6ed0343109e43c03234e27f9',
        ...bot,
        timestamp: 1775124000,
        subject: 'Feature work',
        files: [{ path: 'feature.ts', added: 3, deleted: 0, binary: false }],
      },
      {
        sha: 'fcfb7f812f552b07ed409e5e4c2bcfb5f410cb5f',
        ...bot,
        timestamp: 1775037600,
        subject: 'Base',
        files: [{ path: 'main.ts', added: 2, deleted: 0, binary: false }],
      },
    ]);
  });

  it('parses unicode.bin: multi-byte names, paths with spaces, emoji subjects', () => {
    const zoe = { authorName: 'Zoë Ñúñez', authorEmail: 'zoe@example.com' };
    expect(parseNumstatLogText(fixture('unicode'))).toEqual<CommitRecord[]>([
      {
        sha: 'b7f28f0ffe787d6cbf2071720f40b77b1be39c41',
        ...zoe,
        timestamp: 1777716000,
        subject: 'Más texto',
        files: [
          { path: 'docs/ñandú/résumé.md', added: 1, deleted: 0, binary: false },
          { path: '日本/ファイル.txt', added: 1, deleted: 0, binary: false },
        ],
      },
      {
        sha: '280c90bc496a199910a631048182f38ea866bc27',
        ...zoe,
        timestamp: 1777629600,
        subject: 'Añadir résumé 🚀',
        files: [
          { path: 'docs/ñandú/résumé.md', added: 1, deleted: 0, binary: false },
          { path: 'src/with space.ts', added: 2, deleted: 0, binary: false },
        ],
      },
    ]);
  });

  it('returns no commits for empty output', () => {
    expect(parseNumstatLogText(Buffer.alloc(0))).toEqual([]);
  });

  it('keeps a trailing record whose header has no final NUL', () => {
    const text = '\x1eabc\x1fA\x1fa@x\x1f100\x1fsubject';
    expect(parseNumstatLogText(Buffer.from(text))).toEqual([
      {
        sha: 'abc',
        authorName: 'A',
        authorEmail: 'a@x',
        timestamp: 100,
        subject: 'subject',
        files: [],
      },
    ]);
  });

  it('keeps unit separators inside a subject', () => {
    const text = '\x1eabc\x1fA\x1fa@x\x1f100\x1fone\x1ftwo\x00';
    expect(parseNumstatLogText(Buffer.from(text))[0]?.subject).toBe('one\x1ftwo');
  });

  it('normalizes backslashes and tolerates junk counts and a missing final NUL', () => {
    const text = '\x1eabc\x1fA\x1fa@x\x1fnope\x1fs\x00\nx\ty\tdir\\file.ts';
    expect(parseNumstatLogText(Buffer.from(text))).toEqual([
      {
        sha: 'abc',
        authorName: 'A',
        authorEmail: 'a@x',
        timestamp: 0,
        subject: 's',
        files: [{ path: 'dir/file.ts', added: 0, deleted: 0, binary: false }],
      },
    ]);
  });
});

describe('chunk boundaries', () => {
  for (const name of ['basic', 'renames', 'binary', 'merges', 'unicode']) {
    it(`${name}.bin parses the same in 1-, 7- and 4096-byte chunks`, async () => {
      const buf = fixture(name);
      const whole = parseNumstatLogText(buf);
      for (const size of [1, 7, 4096]) {
        expect(await parseNumstatLog(chunked(buf, size))).toEqual(whole);
      }
    });
  }

  it('accepts an async iterable', async () => {
    const buf = fixture('basic');
    async function* source(): AsyncGenerator<Buffer> {
      for (const chunk of chunked(buf, 3)) yield await Promise.resolve(chunk);
    }
    expect(await parseNumstatLog(source())).toEqual(parseNumstatLogText(buf));
  });
});

/** A synthetic log of `commits` commits touching `filesPer` files each. */
function synthesize(commits: number, filesPer: number): Buffer {
  const parts: string[] = [];
  for (let c = 0; c < commits; c++) {
    const sha = c.toString(16).padStart(40, '0');
    parts.push(
      `\x1e${sha}\x1fAuthor ${String(c % 17)}\x1fa${String(c % 17)}@example.com\x1f${String(1_700_000_000 + c)}\x1fcommit ${String(c)}\x00\n`,
    );
    for (let f = 0; f < filesPer; f++) {
      parts.push(
        `${String(c % 50)}\t${String(f)}\tsrc/module${String((c + f) % 400)}/file${String(f)}.ts\x00`,
      );
    }
  }
  return Buffer.from(parts.join(''), 'utf8');
}

describe('performance', () => {
  it.skipIf(process.env.CHURNMAP_SKIP_PERF)(
    'parses 10 000 commits × 3 files in under 3 s',
    () => {
      const buf = synthesize(10_000, 3);
      const start = performance.now();
      const commits = parseNumstatLogText(buf);
      const elapsed = performance.now() - start;
      console.log(`      10k-commit parse: ${elapsed.toFixed(1)} ms (${String(buf.length)} bytes)`);
      expect(commits).toHaveLength(10_000);
      expect(commits[9_999]?.files).toHaveLength(3);
      expect(elapsed).toBeLessThan(3000);
    },
    10_000,
  );
});

describe('windowStart', () => {
  it('uses the window in days before now', () => {
    expect(windowStart({ window: 30 }, 40 * 86_400_000)).toBe(10 * 86_400);
  });

  it('prefers an explicit since', () => {
    expect(windowStart({ window: 365, since: new Date(5_000) }, 1e12)).toBe(5);
  });
});

/** A fake runGit that records calls and answers from a table keyed by the first argument. */
function fakeRun(answers: Record<string, Buffer | Error>): {
  run: RunGit;
  calls: { args: readonly string[]; opts: RunGitOptions }[];
} {
  const calls: { args: readonly string[]; opts: RunGitOptions }[] = [];
  const run: RunGit = (_gitPath, args, opts) => {
    calls.push({ args, opts });
    const key = args.join(' ');
    const answer = Object.entries(answers).find(([prefix]) => key.startsWith(prefix))?.[1];
    if (answer instanceof Error) return Promise.reject(answer);
    const out = answer ?? Buffer.alloc(0);
    if (opts.onStdout) {
      for (const chunk of chunked(out, 5)) opts.onStdout(chunk);
      return Promise.resolve({ stdout: Buffer.alloc(0), stderr: '' });
    }
    return Promise.resolve({ stdout: out, stderr: '' });
  };
  return { run, calls };
}

describe('readCommits', () => {
  it('streams git log into the parser and filters by the window start', async () => {
    const { run, calls } = fakeRun({ log: fixture('basic') });
    // Window start between the second (1767348000) and third (1767261600) commit.
    const commits = await readCommits(
      '/usr/bin/git',
      '/repo',
      '/hooks',
      { window: 30, since: new Date(1767300000 * 1000) },
      run,
    );
    expect(commits.map((c) => c.subject)).toEqual(['fix: shrink a', 'Add b and grow a']);
    const args = calls[0]?.args ?? [];
    expect(args).toEqual(logArgs(new Date(1767300000 * 1000).toISOString()));
    expect(args.slice(-2)).toEqual(['--', '.']);
    expect(calls[0]?.opts).toMatchObject({ cwd: '/repo', hooksDir: '/hooks' });
  });

  it('passes "<N>.days" when no explicit since is given', async () => {
    const { run, calls } = fakeRun({ log: Buffer.alloc(0) });
    await readCommits('/git', '/repo', '/hooks', { window: 90 }, run);
    expect(calls[0]?.args).toContain('--since=90.days');
  });
});

describe('getGitInfo', () => {
  const head = 'a'.repeat(40);

  it('returns root, head and shallow state', async () => {
    const { run } = fakeRun({
      'rev-parse --show-toplevel': Buffer.from('/work/repo\n'),
      'rev-parse --verify --quiet HEAD': Buffer.from(`${head}\n`),
      'rev-parse --is-shallow-repository': Buffer.from('true\n'),
    });
    expect(
      await getGitInfo('/git', '/work/repo/sub', '/hooks', { version: '2.50.1', run }),
    ).toEqual({
      gitPath: '/git',
      version: '2.50.1',
      repoRoot: '/work/repo',
      head,
      shallow: true,
    });
  });

  it('reports an unborn HEAD as "no commits yet"', async () => {
    const { run } = fakeRun({
      'rev-parse --show-toplevel': Buffer.from('/work/repo\n'),
      'rev-parse --verify': new GitError('failed', 'Git failed: exit code 1'),
    });
    await expect(getGitInfo('/git', '/work/repo', '/hooks', { run })).rejects.toMatchObject({
      kind: 'failed',
      message: 'no commits yet',
    });
  });

  it('passes through typed errors other than "failed"', async () => {
    const { run } = fakeRun({ 'rev-parse --show-toplevel': new GitError('not-a-repository', 'x') });
    await expect(getGitInfo('/git', '/tmp', '/hooks', { run })).rejects.toMatchObject({
      kind: 'not-a-repository',
    });
  });

  it('is not shallow when git says false', async () => {
    const { run } = fakeRun({
      'rev-parse --show-toplevel': Buffer.from('C:\\work\\repo\n'),
      'rev-parse --verify --quiet HEAD': Buffer.from(`${head}\n`),
      'rev-parse --is-shallow-repository': Buffer.from('false\n'),
    });
    const info = await getGitInfo('/git', '/x', '/hooks', { run });
    expect(info.shallow).toBe(false);
    expect(info.repoRoot).toBe('C:/work/repo');
  });
});

describe('NumstatParser', () => {
  it('can be fed incrementally and ended once', () => {
    const parser = new NumstatParser();
    for (const chunk of chunked(fixture('renames'), 2)) parser.push(chunk);
    expect(parser.end()).toHaveLength(3);
  });
});
