import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRepoHead } from '../../../src/analysis/repoHead.js';
import { commitAll, git as runGit, initRepo, writeFiles } from '../../fixtures/gitRepo.mjs';

describe('readRepoHead', () => {
  let root: string;
  let repo: string;
  let head: string;

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cm-head-')));
    repo = join(root, 'repo');
    initRepo(repo);
    writeFiles(repo, { 'a/b/c.txt': 'x\n' });
    commitAll(repo, { message: 'one', date: '2026-01-01T00:00:00Z' });
    head = runGit(repo, ['rev-parse', 'HEAD']).toString().trim();
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads root and HEAD from a loose ref, from any folder inside the repo', async () => {
    expect(await readRepoHead(join(repo, 'a', 'b'))).toEqual({
      repoRoot: repo.replace(/\\/g, '/'),
      head,
    });
  });

  it('agrees with git rev-parse --show-toplevel', async () => {
    const top = runGit(repo, ['rev-parse', '--show-toplevel']).toString().trim();
    expect((await readRepoHead(repo))?.repoRoot).toBe(top);
  });

  it('reads packed refs', async () => {
    runGit(repo, ['pack-refs', '--all']);
    expect((await readRepoHead(repo))?.head).toBe(head);
  });

  it('reads a detached HEAD', async () => {
    runGit(repo, ['checkout', '-q', '--detach']);
    expect((await readRepoHead(repo))?.head).toBe(head);
    runGit(repo, ['checkout', '-q', 'main']);
  });

  it('follows a worktree .git file and its commondir', async () => {
    const wt = join(root, 'wt');
    runGit(repo, ['worktree', 'add', '-q', '-b', 'side', wt]);
    expect(await readRepoHead(wt)).toEqual({ repoRoot: wt.replace(/\\/g, '/'), head });
  });

  it('gives up on anything unusual, so the caller asks git', async () => {
    const odd = join(root, 'odd');
    mkdirSync(join(odd, '.git'), { recursive: true });
    writeFileSync(join(odd, '.git', 'HEAD'), 'ref: refs/heads/.invalid\n');
    expect(await readRepoHead(odd)).toBeUndefined();

    const unborn = join(root, 'unborn');
    initRepo(unborn);
    expect(await readRepoHead(unborn)).toBeUndefined();

    const badFile = join(root, 'badfile');
    mkdirSync(badFile);
    writeFileSync(join(badFile, '.git'), 'not a gitdir line\n');
    expect(await readRepoHead(badFile)).toBeUndefined();

    const escape = join(root, 'escape');
    mkdirSync(join(escape, '.git'), { recursive: true });
    writeFileSync(join(escape, '.git', 'HEAD'), 'ref: refs/../../etc\n');
    expect(await readRepoHead(escape)).toBeUndefined();
  });
});
