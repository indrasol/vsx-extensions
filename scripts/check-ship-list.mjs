#!/usr/bin/env node
// Fails if `vsce ls` would ship anything outside the allow-list (docs/security-practices.md).
// Usage: node scripts/check-ship-list.mjs [workspace ...]   (default: every extension workspace)
import { execFileSync } from 'node:child_process';
import { ROOT, extensionWorkspaces, findWorkspace } from './workspaces.mjs';

const ALLOWED =
  /^(dist\/|media\/|README\.md$|CHANGELOG\.md$|LICENSE$|telemetry\.json$|package\.json$)/;

const names = process.argv.slice(2);
const workspaces = names.length > 0 ? names.map(findWorkspace) : extensionWorkspaces();
if (workspaces.length === 0) {
  console.error('No extension workspaces found.');
  process.exit(1);
}

let failed = false;
for (const { name } of workspaces) {
  const output = execFileSync(
    'pnpm',
    ['--silent', '--filter', name, 'exec', 'vsce', 'ls', '--no-dependencies'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const files = output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const stray = files.filter((file) => !ALLOWED.test(file));
  if (stray.length > 0) {
    failed = true;
    console.error(`✗ ${name}: ${String(stray.length)} file(s) outside the ship list:`);
    for (const file of stray) console.error(`    ${file}`);
  } else {
    console.log(`✓ ${name}: ${String(files.length)} files, all on the ship list`);
  }
}

process.exit(failed ? 1 : 0);
