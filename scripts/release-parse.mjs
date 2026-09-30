#!/usr/bin/env node
// Resolves and validates what release.yml is about to release (ADR-0003, ADR-0008).
// Usage: node scripts/release-parse.mjs --tag <ext>@vX.Y.Z | --extension <ext>
// Prints the result and, on GitHub Actions, writes ext/version/tag/vsix to $GITHUB_OUTPUT.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLISHER = 'Indrasol';

const EXT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** `<ext>@vX.Y.Z` → `{ ext, version }`. */
export function parseTag(tag) {
  const at = tag.lastIndexOf('@v');
  const ext = at === -1 ? '' : tag.slice(0, at);
  const version = at === -1 ? '' : tag.slice(at + 2);
  if (!EXT_NAME.test(ext) || !SEMVER.test(version)) {
    throw new Error(`Tag "${tag}" is not <kebab-name>@vX.Y.Z`);
  }
  return { ext, version };
}

/**
 * Checks the release against the repo. `root` is the repo root; `version` is optional (a dispatch
 * run takes it from package.json). Returns `{ ext, version, tag, vsix }` or throws.
 */
export function resolveRelease(root, ext, version) {
  if (!EXT_NAME.test(ext)) throw new Error(`"${ext}" is not a kebab-case extension name`);
  const manifestPath = join(root, 'extensions', ext, 'package.json');
  if (!existsSync(manifestPath)) {
    if (existsSync(join(root, 'templates', ext, 'package.json'))) {
      throw new Error(`"${ext}" is a template under templates/; templates are never released`);
    }
    throw new Error(`No extension workspace at extensions/${ext}/`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== ext) {
    throw new Error(
      `extensions/${ext}/package.json name is "${String(manifest.name)}", not "${ext}"`,
    );
  }
  if (manifest.publisher !== PUBLISHER) {
    throw new Error(`publisher is "${String(manifest.publisher)}", expected "${PUBLISHER}"`);
  }
  const resolved = version ?? manifest.version;
  if (manifest.version !== resolved) {
    throw new Error(
      `Tag version ${resolved} does not match extensions/${ext}/package.json version ${String(manifest.version)}`,
    );
  }
  if (!SEMVER.test(resolved)) throw new Error(`Version "${String(resolved)}" is not X.Y.Z`);
  return { ext, version: resolved, tag: `${ext}@v${resolved}`, vsix: `${ext}-${resolved}.vsix` };
}

function main(argv) {
  const [flag, value] = argv;
  if ((flag !== '--tag' && flag !== '--extension') || !value) {
    throw new Error('Usage: release-parse.mjs --tag <ext>@vX.Y.Z | --extension <ext>');
  }
  const root = join(import.meta.dirname, '..');
  const { ext, version } = flag === '--tag' ? parseTag(value) : { ext: value, version: undefined };
  const release = resolveRelease(root, ext, version);
  const lines = Object.entries(release).map(([key, val]) => `${key}=${val}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
