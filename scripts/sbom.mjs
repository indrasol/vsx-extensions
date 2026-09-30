#!/usr/bin/env node
// Writes a minimal CycloneDX 1.5 SBOM of a workspace's production dependencies (what esbuild
// bundles into the VSIX). cyclonedx-npm cannot read pnpm lockfiles, so this converts `pnpm list`.
// Usage: node scripts/sbom.mjs <workspace> [--out <file>]   (default: <workspace>/dist/sbom.cdx.json)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ROOT, findWorkspace } from './workspaces.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outArg = outIndex === -1 ? undefined : args[outIndex + 1];
const name = args.find(
  (arg, i) => !arg.startsWith('--') && (outIndex === -1 || i !== outIndex + 1),
);
if (!name || (outIndex !== -1 && !outArg)) {
  console.error('Usage: node scripts/sbom.mjs <workspace> [--out <file>]');
  process.exit(1);
}

const workspace = findWorkspace(name);
const outFile = outArg ? resolve(outArg) : join(workspace.dir, 'dist', 'sbom.cdx.json');

function purl(pkgName, version) {
  return `pkg:npm/${pkgName.replace(/^@/, '%40')}@${version}`;
}

function nameParts(pkgName) {
  const match = /^(@[^/]+)\/(.+)$/.exec(pkgName);
  return match ? { group: match[1], name: match[2] } : { name: pkgName };
}

function licenses(license) {
  if (typeof license !== 'string' || license === '') return undefined;
  return /^[A-Za-z0-9.+-]+$/.test(license)
    ? [{ license: { id: license } }]
    : [{ expression: license }];
}

const [tree] = JSON.parse(
  execFileSync('pnpm', ['--filter', name, 'list', '--prod', '--depth', 'Infinity', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
);

const components = new Map();
const dependencies = new Map();

/** Walks `pnpm list` output; workspace links carry `link:` versions, so read their package.json. */
function walk(deps, parentRef) {
  for (const [depName, dep] of Object.entries(deps ?? {})) {
    const manifestPath = dep.path ? join(dep.path, 'package.json') : undefined;
    const manifest =
      manifestPath && existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, 'utf8'))
        : {};
    const version = dep.version.startsWith('link:') ? manifest.version : dep.version;
    const ref = purl(depName, version);
    dependencies.get(parentRef).add(ref);
    if (components.has(ref)) continue;
    components.set(ref, {
      type: 'library',
      'bom-ref': ref,
      ...nameParts(depName),
      version,
      purl: ref,
      licenses: licenses(manifest.license),
    });
    dependencies.set(ref, new Set());
    walk(dep.dependencies, ref);
  }
}

const rootRef = purl(workspace.name, workspace.manifest.version);
dependencies.set(rootRef, new Set());
walk(tree.dependencies, rootRef);

const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: { components: [{ type: 'application', name: 'vsx-extensions/scripts/sbom.mjs' }] },
    component: {
      type: 'application',
      'bom-ref': rootRef,
      name: workspace.name,
      version: workspace.manifest.version,
      purl: rootRef,
      licenses: licenses(workspace.manifest.license),
    },
  },
  components: [...components.values()],
  dependencies: [...dependencies].map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn] })),
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`Wrote ${outFile} (${String(bom.components.length)} components)`);
