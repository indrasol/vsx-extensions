// Remote / container check (development only; never shipped):
//
//   node scripts/container-check.mjs [--vsix dist/churnmap-<version>.vsix] [--image <image>]
//
// Churnmap is `extensionKind: ["workspace"]`, so in a Dev Container it runs inside the container,
// next to the code, with the container's git and Node. This runs the analysis from the packaged
// VSIX (its own dist/mcp-server.js, the same pipeline and git safety as the editor's Build) in the
// official Dev Containers Node image, as a non-root user, against the hostile fixture repository
// (its .git/config tries to run a program; ADR-0012). It calls the MCP `build` and
// `list_hotspots` tools over stdio and checks: the build succeeds, src/core/engine.js ranks #1,
// and the fixture's trap never ran. Needs Docker. Prints one line per check.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { makeRepo, MARKER } from '../test/fixtures/make-repo.mjs';

const argv = process.argv.slice(2);
const option = (/** @type {string} */ flag, /** @type {string} */ fallback) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
};
const vsix = resolve(
  option(
    '--vsix',
    `dist/churnmap-${String(JSON.parse(readFileSync('package.json', 'utf8')).version)}.vsix`,
  ),
);
const image = option('--image', 'mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm');

/** A dependency-free MCP client: initialize, build, list_hotspots; prints the JSON results. */
const CLIENT = `
const { spawn } = require('node:child_process');
const server = spawn('node', ['/ext/extension/dist/mcp-server.js', '--cache-dir', '/tmp/churnmap', '--workspace', '/repo'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
const waiting = new Map();
server.stdout.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  }
});
let id = 0;
const call = (method, params) => new Promise((ok) => { id += 1; waiting.set(id, ok); server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\\n'); });
(async () => {
  await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'container-check', version: '1' } });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\\n');
  const start = Date.now();
  const build = await call('tools/call', { name: 'build', arguments: {} });
  const buildMs = Date.now() - start;
  const list = await call('tools/call', { name: 'list_hotspots', arguments: {} });
  console.log(JSON.stringify({ buildMs, build: build.result, list: list.result, git: require('node:child_process').execSync('git --version').toString().trim(), node: process.version, platform: process.platform + '/' + process.arch, uid: process.getuid() }));
  server.kill();
})();
`;

if (!existsSync(vsix)) {
  console.error(`${vsix} not found: run pnpm package first.`);
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'cm-container-'));
const ext = join(work, 'ext');
const unzip = spawnSync('unzip', ['-q', vsix, '-d', ext], { stdio: 'inherit' });
if (unzip.status !== 0) process.exit(1);
writeFileSync(join(work, 'client.cjs'), CLIENT);
const repo = makeRepo(undefined, { hostile: true });

const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
const gid = typeof process.getgid === 'function' ? process.getgid() : 1000;
const docker = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '--network=none',
    `--user=${String(uid)}:${String(gid)}`,
    '-e',
    'HOME=/tmp',
    '-v',
    `${ext}:/ext:ro`,
    '-v',
    `${repo}:/repo`,
    '-v',
    `${join(work, 'client.cjs')}:/client.cjs:ro`,
    image,
    'node',
    '/client.cjs',
  ],
  { encoding: 'utf8' },
);
if (docker.status !== 0) {
  console.error(docker.stderr);
  process.exit(1);
}
const out = JSON.parse(docker.stdout.trim().split('\n').pop() ?? '{}');
const text = (/** @type {any} */ result) =>
  (result?.content ?? []).map((/** @type {any} */ c) => c.text).join('\n');
const listText = text(out.list);
const jsonStart = listText.indexOf('{');
const hotspots = jsonStart >= 0 ? JSON.parse(listText.slice(jsonStart)) : {};
const top = hotspots.top?.[0]?.path;
const checks = [
  [
    'container',
    `${String(out.platform)}, ${String(out.node)}, ${String(out.git)}, uid ${String(out.uid)}, no network`,
  ],
  [
    'build succeeded',
    out.build && !out.build.isError ? `yes (${String(out.buildMs)} ms)` : `NO: ${text(out.build)}`,
  ],
  ['#1 is src/core/engine.js', top === 'src/core/engine.js' ? 'yes' : `NO: ${String(top)}`],
  [
    'ADR-0012 trap never ran',
    existsSync(join(repo, '.git', MARKER)) ? 'NO: the marker exists' : 'yes',
  ],
];
for (const [name, value] of checks) console.log(`${name}: ${value}`);
process.exit(checks.some(([, v]) => v.startsWith('NO')) ? 1 : 0);
