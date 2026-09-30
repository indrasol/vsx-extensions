import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// Tests open an empty folder so nothing on the developer's machine influences them.
const workspaceFolder = mkdtempSync(join(tmpdir(), 'labs-smoke-'));

/** @param {string} label @param {string} version */
function config(label, version) {
  // A short user-data dir: VS Code's IPC socket path must stay under 104 characters on macOS.
  const userDataDir = mkdtempSync(join(tmpdir(), `labs-${label}-`));
  return {
    label,
    version,
    files: 'out/test/integration/**/*.test.js',
    workspaceFolder,
    launchArgs: ['--disable-extensions', `--user-data-dir=${userDataDir}`],
    mocha: { ui: 'tdd', timeout: 20000 },
  };
}

// VS Code downloads are cached in .vscode-test/ (gitignored).
export default defineConfig([
  // The engines.vscode minimum.
  config('min', '1.96.0'),
  config('stable', 'stable'),
]);
