// Performance on real repositories (development only; never shipped):
//
//   node scripts/perf-real.mjs [--repo <path>]... [--blobless] [--skip-editor] [--out <file>]
//
// With no --repo, clones microsoft/vscode (≈ 20k files), facebook/react (the 5k-file class of the
// spec's target) and expressjs/express (small) read-only with full history into
// <tmp>/churnmap-perf/ (kept between runs; git-lfs filters off). --blobless clones with
// --filter=blob:none instead: git then fetches the blobs `git log --numstat` needs one by one
// during the first build, which on microsoft/vscode took minutes and then failed in plain git
// ("could not fetch … from promisor remote"), so full clones are the default. For each repository:
// 1. Headless: the analysis pipeline the MCP `build` tool runs (same settings), with the worker
//    pool the extension uses: a first build (cold disk cache), a second from an empty cache (the
//    reported time to the first result), then one from the cache. Records files measured, commits
//    read, those times and the peak RSS of this process (the workers are threads in it; git's own
//    processes are not counted).
// 2. In the editor (unless --skip-editor): the `perf` integration configuration on VS Code stable
//    (perf.test.ts): Build city, the city drawn (buildings, first frame) and a 240-frame orbit.
// Prints a Markdown table for RELEASE-CHECKLIST.md and writes everything to --out
// (default test-output/perf-real.json). Run `pnpm build` first (it uses dist/worker.js).
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { clearInterval, setInterval } from 'node:timers';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const CLONES = [
  'https://github.com/microsoft/vscode',
  'https://github.com/facebook/react',
  'https://github.com/expressjs/express',
];
const WINDOW = 90;

const argv = process.argv.slice(2);
const valuesOf = (/** @type {string} */ flag) =>
  argv.flatMap((arg, i) => (arg === flag && argv[i + 1] ? [argv[i + 1]] : []));
const outFile = resolve(valuesOf('--out')[0] ?? 'test-output/perf-real.json');
const skipEditor = argv.includes('--skip-editor');
const blobless = argv.includes('--blobless');

/** @param {string} command @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [opts] */
function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
  return result;
}

function repositories() {
  const given = valuesOf('--repo').map((p) => resolve(p));
  if (given.length > 0) return given;
  const dir = join(tmpdir(), 'churnmap-perf');
  mkdirSync(dir, { recursive: true });
  return CLONES.map((url) => {
    const target = join(dir, `${basename(url)}${blobless ? '-blobless' : '-full'}`);
    if (!existsSync(join(target, '.git'))) {
      console.log(`Cloning ${url} (${blobless ? 'blobless' : 'full'} history) into ${target}…`);
      const lfsOff = ['filter.lfs.process=', 'filter.lfs.smudge=cat', 'filter.lfs.required=false'];
      run('git', [
        'clone',
        ...lfsOff.flatMap((c) => ['-c', c]),
        ...(blobless ? ['--filter=blob:none'] : []),
        url,
        target,
      ]);
    }
    return target;
  });
}

/** The pipeline, the worker pool and the MCP server's settings, bundled from source. */
async function loadPipeline() {
  const dir = mkdtempSync(join(tmpdir(), 'cm-perf-bundle-'));
  const outfile = join(dir, 'pipeline.cjs');
  await esbuild.build({
    stdin: {
      contents: `
        export { runAnalysis } from './src/analysis/pipeline.ts';
        export { createWorkerPool } from './src/analysis/pool.ts';
        export { prepareHooksDir, resolveGit } from './src/analysis/gitProcess.ts';
        export { DEFAULT_SETTINGS } from './mcp/src/settings.ts';
      `,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile,
    logLevel: 'warning',
  });
  return import(pathToFileURL(outfile).href);
}

/** Peak RSS (MB) while `fn` runs: sampled every 10 ms, plus the kernel's high-water mark. */
async function withPeakRss(/** @type {() => Promise<unknown>} */ fn) {
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 10);
  try {
    const value = await fn();
    peak = Math.max(peak, process.memoryUsage().rss);
    return { value, peakMb: Math.round(peak / 1024 / 1024) };
  } finally {
    clearInterval(timer);
  }
}

async function headless(/** @type {any} */ lib, /** @type {string} */ repo) {
  const storage = mkdtempSync(join(tmpdir(), 'cm-perf-cache-'));
  const git = await lib.resolveGit(undefined);
  if (!git.ok) throw new Error('git not found');
  const deps = {
    gitPath: git.gitPath,
    hooksDir: await lib.prepareHooksDir(storage),
    storageDir: storage,
    cwd: repo,
    settings: lib.DEFAULT_SETTINGS,
    logger: { info() {}, warn() {} },
    pool: lib.createWorkerPool({ workerPath: resolve('dist/worker.js') }),
  };
  /** @param {boolean} force */
  const once = async (force) => {
    const start = performance.now();
    const { value, peakMb } = await withPeakRss(() =>
      lib.runAnalysis(deps, { window: WINDOW, force }),
    );
    return { ms: Math.round(performance.now() - start), peakMb, ...value };
  };
  const cold = await once(true); // cold disk cache
  const first = await once(true); // from an empty cache (force skips the cache read)
  const cached = await once(false);
  rmSync(storage, { recursive: true, force: true });
  const { result } = first;
  return {
    filesMeasured: result.files.length,
    filesExcluded: result.excludedCount,
    capped: result.capped,
    commits: result.commitCount,
    hotspots: result.top.length,
    coldMs: cold.ms,
    firstResultMs: first.ms,
    cachedMs: cached.ms,
    cachedHit: cached.cached,
    peakRssMb: Math.max(first.peakMb, cold.peakMb),
    maxRssKernelMb: Math.round(process.resourceUsage().maxRSS / 1024),
    timings: result.timings,
  };
}

function inEditor(/** @type {string} */ repo) {
  const out = join(mkdtempSync(join(tmpdir(), 'cm-perf-out-')), 'perf.json');
  run('node', ['esbuild.mjs', '--tests'], { stdio: 'ignore' });
  run('pnpm', ['exec', 'vscode-test', '--label', 'perf'], {
    env: { ...process.env, CHURNMAP_PERF_REPO: repo, CHURNMAP_PERF_OUT: out },
  });
  return JSON.parse(readFileSync(out, 'utf8'));
}

const lib = await loadPipeline();
/** @type {Record<string, unknown>} */
const report = { date: new Date().toISOString(), window: WINDOW, node: process.version, repos: {} };
for (const repo of repositories()) {
  const name = basename(repo);
  console.log(`\n== ${name} (${repo})`);
  try {
    const h = await headless(lib, repo);
    console.log(JSON.stringify(h, null, 2));
    const e = skipEditor ? undefined : inEditor(repo);
    if (e) console.log(JSON.stringify(e, null, 2));
    /** @type {any} */ (report.repos)[name] = { path: repo, headless: h, editor: e };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`FAILED: ${error}`);
    /** @type {any} */ (report.repos)[name] = { path: repo, error };
  }
}
mkdirSync(join(outFile, '..'), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  '\n| Repository | Files measured | Commits (90 d) | First build (cold disk) | First result | Cached | Peak RSS | Build + city (editor) | Buildings | First frame | Orbit frame (mean / p95) |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const [name, r] of Object.entries(/** @type {Record<string, any>} */ (report.repos))) {
  const { headless: h, editor: e } = r;
  if (!h) {
    console.log(`| ${name} | failed: ${String(r.error)} |`);
    continue;
  }
  console.log(
    `| ${name} | ${String(h.filesMeasured)} | ${String(h.commits)} | ${String(h.coldMs)} ms | ${String(h.firstResultMs)} ms | ${String(h.cachedMs)} ms | ${String(h.peakRssMb)} MB | ${e ? `${String(e.cityAndHotspotsMs)} ms` : 'not run'} | ${e ? String(e.buildings) : '–'} | ${e ? `${String(e.firstFrameMs)} ms` : '–'} | ${e ? `${String(e.orbit.meanFrameMs)} / ${String(e.orbit.p95FrameMs)} ms` : '–'} |`,
  );
}
console.log(`\nWrote ${outFile}`);
