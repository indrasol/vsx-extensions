import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';
import { downloadAndUnzipVSCode, SilentReporter } from '@vscode/test-electron';
import { makeDemoRepo, makeRepo } from './test/fixtures/make-repo.mjs';
import { makeUmbrella } from './test/fixtures/make-umbrella.mjs';

// Tests open freshly generated fixture repositories (real git, fake dates), so nothing on the
// developer's machine influences them. Three kinds of run, each on the engines.vscode minimum and
// on stable:
// - clean:     a plain repository with VS Code's Git extension on; every test but the two below.
// - hostile:   a .git/config that tries to run a program (ADR-0012), with the Git extension
//              turned off in the fixture's .vscode/settings.json (it runs `git status` without
//              Churnmap's safety flags); only adr0012.test.ts.
// - untrusted: Workspace Trust on and the folder not trusted; only untrusted.test.ts.
//   @vscode/test-electron adds --disable-workspace-trust to every launch, so this run starts VS Code
//   through a wrapper that drops that one argument (untrustedExecutable below).
// - umbrella:  a clean, trusted workspace whose root is a repository of notes with the code in a
//              nested repository it ignores (make-umbrella.mjs); only umbrella.test.ts.
// - demo:      only with CHURNMAP_DEMO=1 (scripts/make-demo-gif.mjs): the README demo repository
//              (makeDemoRepo) on stable; only demo.test.ts, which records the GIF frames.
// - cursor:    only with CHURNMAP_CURSOR=<path to the Cursor executable>: the clean run inside
//              Cursor (its webviews get far fewer animation frames than VS Code's).
// - perf:      only with CHURNMAP_PERF_REPO=<a real repository> (scripts/perf-real.mjs), stable
//              only: perf.test.ts times build, city and orbit there (results to CHURNMAP_PERF_OUT).
const DEMO = process.env.CHURNMAP_DEMO === '1';
const CURSOR = process.env.CHURNMAP_CURSOR ?? '';
const PERF_REPO = process.env.CHURNMAP_PERF_REPO ?? '';
const SPECIAL = {
  hostile: 'adr0012.test.ts',
  untrusted: 'untrusted.test.ts',
  umbrella: 'umbrella.test.ts',
  demo: 'demo.test.ts',
  perf: 'perf.test.ts',
};

const compiled = (/** @type {string} */ file) =>
  `out/test/integration/${file.replace(/\.ts$/, '.js')}`;

const cleanFiles = readdirSync('test/integration')
  .filter((file) => file.endsWith('.test.ts') && !Object.values(SPECIAL).includes(file))
  .map(compiled);

const fixtures = {
  clean: makeRepo(undefined, { hostile: false }),
  hostile: makeRepo(undefined, { hostile: true }),
  untrusted: makeRepo(undefined, { hostile: false }),
  umbrella: makeUmbrella(),
  demo: DEMO ? makeDemoRepo() : '',
  perf: PERF_REPO,
};

/**
 * A launcher for VS Code `version` that passes on every argument except
 * --disable-workspace-trust, so Workspace Trust stays on. The download is the cached one.
 * @param {string} version
 */
async function untrustedExecutable(version) {
  const real = await downloadAndUnzipVSCode({ version, reporter: new SilentReporter() });
  const dir = mkdtempSync(join(tmpdir(), 'cm-trust-'));
  if (process.platform === 'win32') {
    const script = join(dir, 'launch.cjs');
    writeFileSync(
      script,
      `const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2).filter((a) => a !== '--disable-workspace-trust');
const run = spawnSync(${JSON.stringify(real)}, args, { stdio: 'inherit' });
process.exit(run.status ?? 1);
`,
    );
    const cmd = join(dir, 'code.cmd');
    writeFileSync(cmd, `@node "${script}" %*\r\n`);
    return cmd;
  }
  const quoted = real.replace(/["\\$`]/g, '\\$&');
  const sh = join(dir, 'code');
  writeFileSync(
    sh,
    `#!/bin/sh
for arg in "$@"; do
  shift
  [ "$arg" = "--disable-workspace-trust" ] || set -- "$@" "$arg"
done
exec "${quoted}" "$@"
`,
  );
  chmodSync(sh, 0o755);
  return sh;
}

/**
 * @param {string} label
 * @param {string} version
 * @param {'clean' | 'hostile' | 'untrusted' | 'umbrella' | 'demo' | 'perf'} kind
 */
async function config(label, version, kind) {
  // A short user-data dir: VS Code's IPC socket path must stay under 104 characters on macOS.
  const userDataDir = mkdtempSync(join(tmpdir(), `cm-${label}-`));
  mkdirSync(join(userDataDir, 'User'), { recursive: true });
  // No trust dialog at startup: the untrusted run opens straight into Restricted Mode.
  writeFileSync(
    join(userDataDir, 'User', 'settings.json'),
    JSON.stringify({ 'security.workspace.trust.startupPrompt': 'never' }),
  );
  const trusted = kind !== 'untrusted';
  return {
    label,
    version,
    files: kind === 'clean' ? cleanFiles : [compiled(SPECIAL[kind])],
    workspaceFolder: fixtures[kind],
    launchArgs: [
      '--disable-extensions',
      // GPU-less Linux (CI under xvfb): newer Chromium no longer falls back to software WebGL on
      // its own, and the city would open in its 2D fallback. Unknown flags are ignored by older builds.
      ...(process.platform === 'linux'
        ? ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
        : []),
      // Analysis needs a trusted folder; only the untrusted run keeps Workspace Trust on.
      ...(trusted ? ['--disable-workspace-trust'] : []),
      `--user-data-dir=${userDataDir}`,
    ],
    mocha: { ui: 'tdd', timeout: 20000 },
    ...(trusted ? {} : { useInstallation: { fromPath: await untrustedExecutable(version) } }),
  };
}

// VS Code downloads are cached in .vscode-test/ (gitignored).
export default defineConfig(
  await Promise.all([
    ...(DEMO ? [config('demo', 'stable', 'demo')] : []),
    ...(PERF_REPO ? [config('perf', 'stable', 'perf')] : []),
    // The engines.vscode minimum.
    config('min', '1.96.0', 'clean'),
    // Opt-in: the clean run inside Cursor (CHURNMAP_CURSOR = the path of its executable, for
    // example /Applications/Cursor.app/Contents/MacOS/Cursor). Cursor delivers far fewer
    // animation frames to a webview than VS Code does, which is where the 3D morph stalled.
    ...(CURSOR
      ? [
          config('cursor', 'stable', 'clean').then((c) => ({
            ...c,
            useInstallation: { fromPath: CURSOR },
          })),
        ]
      : []),
    config('stable', 'stable', 'clean'),
    config('min-hostile', '1.96.0', 'hostile'),
    config('stable-hostile', 'stable', 'hostile'),
    config('min-untrusted', '1.96.0', 'untrusted'),
    config('stable-untrusted', 'stable', 'untrusted'),
    config('min-umbrella', '1.96.0', 'umbrella'),
    config('stable-umbrella', 'stable', 'umbrella'),
  ]),
);
