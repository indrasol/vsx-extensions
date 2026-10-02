// Regenerates the git log fixtures in this folder. Run from the extension folder:
//   node test/fixtures/gitlog/generate.mjs
// Each fixture is a temporary repository built with real git and fixed dates/authors, so the
// commit hashes (and therefore the .bin files) are reproducible. The .bin file is git's raw stdout
// for the same command `src/analysis/gitLog.ts` runs, except `--since`, which is pinned to 2000-01-01
// so the fixtures never age out. Commit the .bin files; the unit tests read only those.
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitAll, git, initRepo, lines, writeFiles } from '../gitRepo.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// Keep in sync with logArgs() in src/analysis/gitLog.ts.
const LOG_ARGS = [
  'log',
  '-z',
  '--numstat',
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--date=raw',
  '--find-renames',
  '--format=%x1e%H%x1f%aN%x1f%aE%x1f%at%x1f%s',
  '--since=2000-01-01T00:00:00Z',
  'HEAD',
  '--',
  '.',
];

/** @param {string} name @param {(dir: string) => void} build */
function fixture(name, build) {
  const dir = mkdtempSync(join(tmpdir(), `cm-fixture-${name}-`));
  try {
    initRepo(dir);
    build(dir);
    const out = git(dir, LOG_ARGS);
    writeFileSync(join(here, `${name}.bin`), out);
    console.log(`${name}.bin: ${String(out.length)} bytes`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

fixture('basic', (dir) => {
  writeFiles(dir, { 'src/a.ts': lines(3), 'README.md': 'hello\n' });
  commitAll(dir, { message: 'Initial commit', date: '2026-01-01T10:00:00Z' });
  writeFiles(dir, { 'src/a.ts': lines(5), 'src/b.ts': lines(2) });
  commitAll(dir, {
    message: 'Add b and grow a',
    date: '2026-01-02T10:00:00Z',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  });
  writeFiles(dir, { 'src/a.ts': lines(4), 'src/b.ts': 'changed\n' });
  commitAll(dir, { message: 'fix: shrink a', date: '2026-01-03T10:00:00Z' });
});

fixture('renames', (dir) => {
  writeFiles(dir, { 'old/name.ts': lines(10), 'keep.ts': lines(1) });
  commitAll(dir, { message: 'Add files', date: '2026-02-01T10:00:00Z' });
  mkdirSync(join(dir, 'new'));
  git(dir, ['mv', 'old/name.ts', 'new/name.ts']);
  writeFiles(dir, { 'new/name.ts': lines(11) });
  commitAll(dir, { message: 'Move and edit', date: '2026-02-02T10:00:00Z' });
  git(dir, ['mv', 'keep.ts', 'kept.ts']);
  commitAll(dir, { message: 'Pure rename', date: '2026-02-03T10:00:00Z' });
});

fixture('binary', (dir) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  writeFiles(dir, { 'media/logo.png': png, 'notes.txt': 'a\n' });
  commitAll(dir, { message: 'Add logo', date: '2026-03-01T10:00:00Z' });
  writeFiles(dir, {
    'media/logo.png': Buffer.concat([png, Buffer.from([0, 1, 2, 3])]),
    'notes.txt': 'a\nb\n',
  });
  commitAll(dir, { message: 'Update logo', date: '2026-03-02T10:00:00Z' });
});

fixture('merges', (dir) => {
  writeFiles(dir, { 'main.ts': lines(2) });
  commitAll(dir, { message: 'Base', date: '2026-04-01T10:00:00Z' });
  git(dir, ['checkout', '-q', '-b', 'feature']);
  writeFiles(dir, { 'feature.ts': lines(3) });
  commitAll(dir, { message: 'Feature work', date: '2026-04-02T10:00:00Z' });
  git(dir, ['checkout', '-q', 'main']);
  writeFiles(dir, { 'main.ts': lines(4) });
  commitAll(dir, { message: 'Main work', date: '2026-04-03T10:00:00Z' });
  git(dir, ['merge', '-q', '--no-ff', '--no-edit', 'feature'], {
    GIT_AUTHOR_DATE: '2026-04-04T10:00:00Z',
    GIT_COMMITTER_DATE: '2026-04-04T10:00:00Z',
    GIT_AUTHOR_NAME: 'Fixture Bot',
    GIT_AUTHOR_EMAIL: 'bot@example.com',
    GIT_COMMITTER_NAME: 'Fixture Bot',
    GIT_COMMITTER_EMAIL: 'bot@example.com',
  });
  writeFiles(dir, { 'main.ts': lines(5) });
  commitAll(dir, { message: '', date: '2026-04-05T10:00:00Z' });
});

fixture('unicode', (dir) => {
  writeFiles(dir, { 'docs/ñandú/résumé.md': 'olá\n', 'src/with space.ts': lines(2) });
  commitAll(dir, {
    message: 'Añadir résumé 🚀',
    date: '2026-05-01T10:00:00Z',
    name: 'Zoë Ñúñez',
    email: 'zoe@example.com',
  });
  writeFiles(dir, { 'docs/ñandú/résumé.md': 'olá\nmundo\n', '日本/ファイル.txt': 'x\n' });
  commitAll(dir, {
    message: 'Más texto',
    date: '2026-05-02T10:00:00Z',
    name: 'Zoë Ñúñez',
    email: 'zoe@example.com',
  });
});
