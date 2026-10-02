// Builds the integration-test fixture repository in a temp folder and returns its path.
// Used by .vscode-test.mjs (the folder becomes the test workspace). Run directly to inspect one:
//   node test/fixtures/make-repo.mjs          (the test fixture below)
//   node test/fixtures/make-repo.mjs --demo   (the README demo repository, makeDemoRepo)
//
// History (dates relative to now, so the default 90-day window always covers it):
// - 120 days ago: src/core/engine.js created, shallow (the trend baseline before the window)
// - 13 commits inside the window, including one rename (docs/intro.md → docs/guide.md),
//   one binary file (media/logo.png), two "fix" commits and one --no-ff merge.
// src/core/engine.js has the most commits, the most churn, the deepest nesting, three authors and
// both fix commits, so it must rank #1.
//
// ADR-0012 trap (`hostile: true`, the default): after the history is written, the repo's own
// .git/config points core.pager, core.fsmonitor and core.hooksPath at a script that writes PWNED
// into .git/churnmap-pwned. Churnmap must never run it. The hostile fixture also turns VS Code's
// own Git extension off in its .vscode/settings.json (that extension runs `git status` without
// Churnmap's safety flags, so it would trip the trap). `hostile: false` is a plain repository for
// the tests that need the Git extension (the SCM warning).
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { commitAll, git, initRepo, lines, writeFiles } from './gitRepo.mjs';

export const MARKER = 'churnmap-pwned';

/** @param {number} depth @param {number} n */
function nested(depth, n) {
  const out = [];
  for (let d = 0; d < depth; d++) out.push(`${'  '.repeat(d)}if (a${String(d)}) {`);
  for (let i = 0; i < n; i++) out.push(`${'  '.repeat(depth)}step(${String(i)});`);
  for (let d = depth - 1; d >= 0; d--) out.push(`${'  '.repeat(d)}}`);
  return out.join('\n') + '\n';
}

/** @param {number} daysAgo */
function ago(daysAgo) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString();
}

const ALICE = { name: 'Alice Example', email: 'alice@example.com' };
const BOB = { name: 'Bob Example', email: 'bob@example.com' };
const CAROL = { name: 'Carol Example', email: 'carol@example.com' };

/** @param {string} [dir] @param {{ hostile?: boolean }} [options] */
export function makeRepo(
  dir = mkdtempSync(join(tmpdir(), 'churnmap-repo-')),
  { hostile = true } = {},
) {
  initRepo(dir);
  const c = (/** @type {string} */ message, /** @type {number} */ days, author = ALICE) => {
    commitAll(dir, { message, date: ago(days), ...author });
  };

  writeFiles(dir, { 'src/core/engine.js': nested(1, 20), 'README.md': lines(3) });
  c('Initial engine', 120);

  // Inside the 90-day window from here on.
  writeFiles(dir, {
    'src/api/handler.js': nested(2, 26),
    'src/util/format.js': nested(1, 22),
    'docs/intro.md': lines(24),
    'media/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 0x49, 0x48]),
  });
  c('Add api, util, docs and logo', 80, BOB);
  writeFiles(dir, { 'src/core/engine.js': nested(3, 30) });
  c('Engine: nested rules', 70);
  writeFiles(dir, { 'src/api/handler.js': nested(2, 28) });
  c('Handler: pagination', 60, BOB);
  writeFiles(dir, { 'src/core/engine.js': nested(4, 34) });
  c('fix: engine crash on empty input', 50, BOB);
  writeFiles(dir, { 'src/util/format.js': nested(1, 24) });
  c('Format dates', 45, CAROL);
  git(dir, ['mv', 'docs/intro.md', 'docs/guide.md']);
  writeFiles(dir, { 'docs/guide.md': lines(26) });
  c('Rename intro to guide', 40, CAROL);

  git(dir, ['checkout', '-q', '-b', 'feature/flags']);
  writeFiles(dir, { 'src/feature/flags.js': nested(1, 21) });
  c('Feature flags', 35, CAROL);
  git(dir, ['checkout', '-q', 'main']);
  writeFiles(dir, { 'src/core/engine.js': nested(5, 36) });
  c('Engine: caching', 30, CAROL);
  git(dir, ['merge', '-q', '--no-ff', '--no-edit', 'feature/flags'], {
    GIT_AUTHOR_DATE: ago(25),
    GIT_COMMITTER_DATE: ago(25),
    GIT_AUTHOR_NAME: ALICE.name,
    GIT_AUTHOR_EMAIL: ALICE.email,
    GIT_COMMITTER_NAME: ALICE.name,
    GIT_COMMITTER_EMAIL: ALICE.email,
  });

  writeFiles(dir, {
    'media/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 0x49, 0x48, 0, 1]),
  });
  c('New logo', 20, BOB);
  writeFiles(dir, { 'src/core/engine.js': nested(6, 40) });
  c('fix: engine regression in rules', 10);
  writeFiles(dir, { 'src/api/handler.js': nested(3, 30) });
  c('Handler: validation', 5, BOB);
  writeFiles(dir, { 'src/core/engine.js': nested(6, 44) });
  c('Engine: metrics', 2, BOB);

  if (!hostile) return dir;

  // The trap. Written last so building the fixture never triggers it.
  writeFiles(dir, { '.vscode/settings.json': JSON.stringify({ 'git.enabled': false }) });
  const script = join(dir, '.git', 'pwn.sh');
  // Records the calling git command line, so a failure says who ran it.
  writeFileSync(
    script,
    `#!/bin/sh\necho "PWNED by: $(ps -o command= -p $PPID) <- $(ps -o command= -p $(ps -o ppid= -p $PPID) | cut -c1-200)" >> "${join(dir, '.git', MARKER)}"\ncat\n`,
  );
  chmodSync(script, 0o755);
  const hooks = join(dir, '.git', 'evil-hooks');
  writeFiles(dir, {});
  for (const hook of [
    'pre-commit',
    'post-checkout',
    'post-index-change',
    'reference-transaction',
  ]) {
    writeFiles(hooks, { [hook]: `#!/bin/sh\n"${script}"\n` });
    chmodSync(join(hooks, hook), 0o755);
  }
  git(dir, ['config', 'core.pager', script]);
  git(dir, ['config', 'core.fsmonitor', script]);
  git(dir, ['config', 'core.hooksPath', hooks]);
  return dir;
}

/** A small seeded PRNG (mulberry32), so the demo repository is the same on every run. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Eight folders of 15 files each; the first few names per folder are the ones that get edited. */
const DEMO_FOLDERS = {
  billing:
    'invoice tax ledger refunds currency discounts pricing receipts dunning statements credits coupons exports webhooks plans',
  orders:
    'checkout cart fulfilment returns shipping inventory quotes tracking notes events history bundles gifts limits status',
  auth: 'session tokens password oauth roles audit mfa lockout invites sso scopes keys devices consent profile',
  api: 'router middleware errors pagination validation versioning rateLimit cors health metrics openapi auth uploads search admin',
  search:
    'indexer query ranking synonyms facets suggest spell filters highlight cache analyzer tokens boosts export stats',
  ui: 'table form modal toast menu tabs chart datePicker select tooltip layout theme icons avatar breadcrumbs',
  jobs: 'scheduler retry queue mailer cleanup reports backup digest reminders imports sync rollups archive alerts heartbeat',
  shared:
    'dates money strings ids logger config featureFlags http retry cache errors types assert collections env',
};

/** How often each hot file is edited, relative to 1 for the rest (rank order follows roughly). */
const DEMO_HEAT = {
  'src/billing/invoice.ts': 26,
  'src/orders/checkout.ts': 18,
  'src/auth/session.ts': 14,
  'src/search/indexer.ts': 11,
  'src/api/router.ts': 9,
  'src/billing/tax.ts': 7,
  'src/jobs/scheduler.ts': 6,
  'src/orders/cart.ts': 5,
  'src/ui/table.ts': 4,
  'src/shared/dates.ts': 4,
};

const DEMO_AUTHORS = ['Ana', 'Ben', 'Chen', 'Dev', 'Eli', 'Fay'].map((name) => ({
  name: `${name} Example`,
  email: `${name.toLowerCase()}@example.com`,
}));

/**
 * The richer repository the README demo GIF and screenshots are recorded from: 120 TypeScript
 * files in 8 folders under src/, and about 6 months of history from 6 authors, with a few files
 * much busier, deeper and more bug-fixed than the rest. Seeded, so every run draws the same city.
 * The folder is named `acme-shop`, the name the city's header and the GIF show.
 * @param {string} [dir]
 */
export function makeDemoRepo(
  dir = join(mkdtempSync(join(tmpdir(), 'churnmap-demo-')), 'acme-shop'),
) {
  initRepo(dir);
  const rand = random(20260930);
  const pick = (/** @type {readonly any[]} */ list) => list[Math.floor(rand() * list.length)];

  /** @type {Map<string, { depth: number, size: number }>} */
  const files = new Map();
  for (const [folder, names] of Object.entries(DEMO_FOLDERS)) {
    for (const name of names.split(' ')) {
      files.set(`src/${folder}/${name}.ts`, {
        depth: 1 + Math.floor(rand() * 2),
        size: 25 + Math.floor(rand() * 140),
      });
    }
  }
  const paths = [...files.keys()];
  const write = (/** @type {string[]} */ list) => {
    writeFiles(
      dir,
      Object.fromEntries(
        list.map((p) => {
          const f = files.get(p) ?? { depth: 1, size: 30 };
          return [p, nested(f.depth, f.size)];
        }),
      ),
    );
  };

  write(paths);
  writeFiles(dir, { 'README.md': lines(12) });
  commitAll(dir, { message: 'Initial import', date: ago(182), ...DEMO_AUTHORS[0] });

  const weights = paths.map((p) => DEMO_HEAT[p] ?? 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const weighted = () => {
    let r = rand() * total;
    for (let i = 0; i < paths.length; i++) {
      r -= weights[i] ?? 0;
      if (r <= 0) return paths[i] ?? '';
    }
    return paths[0] ?? '';
  };

  for (let day = 180; day >= 1; day--) {
    // Busier towards the present, as a codebase under active development.
    const commits = rand() < 0.35 + (180 - day) / 360 ? 1 + Math.floor(rand() * 2) : 0;
    for (let c = 0; c < commits; c++) {
      const touched = new Set([weighted()]);
      while (rand() < 0.35 && touched.size < 4) touched.add(weighted());
      const hot = [...touched].some((p) => (DEMO_HEAT[p] ?? 1) > 5);
      for (const p of touched) {
        const f = files.get(p);
        if (!f) continue;
        const heat = DEMO_HEAT[p] ?? 1;
        f.size = Math.max(20, f.size + Math.floor(rand() * (6 + heat * 2)) - 4);
        if (heat > 5 && rand() < 0.12) f.depth = Math.min(7, f.depth + 1);
      }
      write([...touched]);
      const first = [...touched][0] ?? '';
      const noun = first.split('/').pop()?.replace(/\.ts$/, '') ?? 'code';
      const message =
        rand() < (hot ? 0.3 : 0.1)
          ? `fix: ${noun} ${String(pick(['edge case', 'regression', 'crash', 'rounding']))}`
          : `${noun}: ${String(pick(['refactor', 'new option', 'cleanup', 'tests', 'perf']))}`;
      const author = hot ? pick(DEMO_AUTHORS) : pick(DEMO_AUTHORS.slice(0, 3));
      commitAll(dir, { message, date: ago(day - c * 0.1), ...author });
    }
  }
  return dir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(process.argv.includes('--demo') ? makeDemoRepo() : makeRepo());
}
