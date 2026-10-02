import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  indexFile,
  lastRepoFor,
  MAX_INDEX_ENTRIES,
  readIndex,
  recordLastRepo,
} from '../../../src/analysis/repoIndex.js';

let work: string;
let storage: string;

beforeEach(() => {
  work = realpathSync.native(mkdtempSync(join(tmpdir(), 'cm-index-')));
  storage = join(work, 'storage');
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('cache index', () => {
  it('remembers the last repository analysed per workspace folder', async () => {
    const folder = join(work, 'umbrella');
    mkdirSync(folder);
    expect(await lastRepoFor(storage, folder)).toBeUndefined();
    await recordLastRepo(storage, [folder], '/r/umbrella/app');
    expect(await lastRepoFor(storage, folder)).toBe('/r/umbrella/app');
    await recordLastRepo(storage, [folder], '/r/umbrella/svc');
    expect(await lastRepoFor(storage, folder)).toBe('/r/umbrella/svc');
    expect(await lastRepoFor(storage, join(work, 'other'))).toBeUndefined();
  });

  it('finds a folder through a symbolic link too', async () => {
    const real = join(work, 'real');
    mkdirSync(real);
    const link = join(work, 'link');
    symlinkSync(real, link);
    await recordLastRepo(storage, [link], '/r/app');
    expect(await lastRepoFor(storage, real)).toBe('/r/app');
  });

  it('treats a corrupt index as empty and keeps at most MAX_INDEX_ENTRIES', async () => {
    mkdirSync(join(storage, 'cache'), { recursive: true });
    writeFileSync(indexFile(storage), '{"workspaces": {"a": {"repoRoot": 3}}');
    expect(await readIndex(storage)).toEqual({ version: 1, workspaces: {} });
    const folders = Array.from({ length: MAX_INDEX_ENTRIES + 5 }, (_, i) =>
      join(work, `f${String(i)}`),
    );
    for (const f of folders.slice(0, 10)) await recordLastRepo(storage, [f], '/r/x');
    await recordLastRepo(storage, folders, '/r/y');
    const index = await readIndex(storage);
    expect(Object.keys(index.workspaces)).toHaveLength(MAX_INDEX_ENTRIES);
  });
});
