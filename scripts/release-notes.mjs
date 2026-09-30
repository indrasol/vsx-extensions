#!/usr/bin/env node
// Prints the CHANGELOG section for a release, for `gh release create --notes-file`.
// Usage: node scripts/release-notes.mjs <ext> <version>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FALLBACK = 'See CHANGELOG.md.';

/** The body of `## [version]` (or `## version`) up to the next `## ` heading, trimmed. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^##\\s+\\[?v?${escaped}\\]?(?:\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body === '' ? undefined : body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [ext, version] = process.argv.slice(2);
  if (!ext || !version) {
    console.error('Usage: node scripts/release-notes.mjs <ext> <version>');
    process.exit(1);
  }
  const path = join(import.meta.dirname, '..', 'extensions', ext, 'CHANGELOG.md');
  const section = existsSync(path)
    ? changelogSection(readFileSync(path, 'utf8'), version)
    : undefined;
  console.log(section ?? FALLBACK);
}
