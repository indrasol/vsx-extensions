// Packages a development build with a unique version, so it installs over the previous one:
//
//   pnpm package:dev   →   dist/churnmap-dev.vsix, version <version>-dev.<yyyymmddHHMM>
//
// Editors keep a running extension's code when a VSIX of the *same* version is installed into the
// same folder (a reinstall of 1.0.0 over 1.0.0 can go on running the old build until a restart).
// A new version every time gets its own folder, so `--install-extension … --force` always takes.
// package.json is never edited: vsce is given the version with --no-update-package-json, and the
// bundles are built with the same version (CHURNMAP_BUILD_VERSION, read by esbuild.mjs).
// `pnpm package` stays the real release build.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const DEV_VSIX = 'dist/churnmap-dev.vsix';

/** `1.0.0` + a local time stamp → `1.0.0-dev.202609301542` (valid semver, sorts by time). */
export function devVersion(base, date = new Date()) {
  const core = String(base).split('-')[0];
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const stamp = `${String(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `${core}-dev.${stamp}`;
}

/** @param {string} command @param {string[]} args @param {Record<string, string>} [env] */
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const version = devVersion(manifest.version);
  run('node', ['esbuild.mjs', '--production'], { CHURNMAP_BUILD_VERSION: version });
  run('node', ['scripts/third-party-notices.mjs']);
  run('pnpm', [
    'exec',
    'vsce',
    'package',
    version,
    '--no-git-tag-version',
    '--no-update-package-json',
    '--no-dependencies',
    '-o',
    DEV_VSIX,
  ]);
  console.log(`\n${DEV_VSIX} is version ${version}. Install it over any earlier build with:`);
  console.log(`  cursor --install-extension ${DEV_VSIX} --force`);
  console.log(`  code --install-extension ${DEV_VSIX} --force`);
}
