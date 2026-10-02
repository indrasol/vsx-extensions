// Builds the "umbrella" integration fixture in a temp folder and returns its path: the shape of a
// real workspace where the root is a small git repository of notes and the code lives in a nested
// clone the root ignores. Used by .vscode-test.mjs. Run directly to inspect one:
//   node test/fixtures/make-umbrella.mjs
//
// - <root>/            a repository holding NOTES.md (edited in 12 commits, far more churn than
//                      any code file), PLAN.md and a screenshot; its .gitignore ignores app/.
// - <root>/app/        the standard fixture repository (make-repo.mjs, not hostile): code with
//                      history, src/core/engine.js ranking #1.
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { commitAll, initRepo, lines, writeFiles } from './gitRepo.mjs';
import { makeRepo } from './make-repo.mjs';

export const NESTED = 'app';

/** @param {number} daysAgo */
function ago(daysAgo) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

/** @param {string} [dir] */
export function makeUmbrella(dir = mkdtempSync(join(tmpdir(), 'churnmap-umbrella-'))) {
  initRepo(dir);
  writeFiles(dir, {
    '.gitignore': `${NESTED}/\n`,
    'PLAN.md': lines(30),
    'screenshots/home.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 0x49, 0x48]),
    'NOTES.md': lines(40),
  });
  commitAll(dir, { message: 'Start the notes', date: ago(85) });
  // The notes are rewritten again and again: under rank "all" they would be the #1 hotspot.
  for (let i = 1; i <= 11; i++) {
    writeFiles(dir, { 'NOTES.md': lines(40 + i * 12, i % 2 === 0 ? '' : '  ') });
    commitAll(dir, { message: `Session notes ${String(i)}`, date: ago(85 - i * 7) });
  }
  writeFiles(dir, { 'PLAN.md': lines(34) });
  commitAll(dir, { message: 'Plan update', date: ago(3) });

  makeRepo(join(dir, NESTED), { hostile: false });
  return dir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(makeUmbrella());
}
