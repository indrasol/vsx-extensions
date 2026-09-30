// Shared helpers for the release scripts: find packageable extension workspaces. No dependencies.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');

/** Workspaces under extensions/* and templates/* whose package.json has a `publisher`. */
export function extensionWorkspaces() {
  const found = [];
  for (const parent of ['extensions', 'templates']) {
    const parentDir = join(ROOT, parent);
    if (!existsSync(parentDir)) continue;
    for (const entry of readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(parentDir, entry.name);
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.publisher) found.push({ name: manifest.name, dir, manifest });
    }
  }
  return found;
}

/** The extension workspace called `name`, or exit with an error. */
export function findWorkspace(name) {
  const workspace = extensionWorkspaces().find((ws) => ws.name === name);
  if (!workspace) {
    console.error(`No extension workspace named "${name}" under extensions/ or templates/.`);
    process.exit(1);
  }
  return workspace;
}
