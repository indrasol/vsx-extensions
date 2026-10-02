// Writes ThirdPartyNotices.txt (shipped in the VSIX) from the third-party code that is actually
// bundled: the node_modules files esbuild.mjs lists in dist/bundle-inputs.json. For each package,
// its name, version, licence and licence text come from its own folder in node_modules.
//
//   node scripts/third-party-notices.mjs           (run by `pnpm build` after esbuild)
//   node scripts/third-party-notices.mjs --check   (fail when the committed file is out of date)
//
// Fails on a licence outside ALLOWED unless NOTES explains it, and on a package with no licence
// text. @indrasol/labs-core is first-party (a workspace package) and not listed.
import console from 'node:console';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const OUTPUT = 'ThirdPartyNotices.txt';
export const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0']);
/** `name` → why a licence outside ALLOWED is acceptable. Empty: every bundled licence is allowed. */
export const NOTES = /** @type {Record<string, string>} */ ({});

/** The package folder a bundled file belongs to, or undefined for first-party code. */
export function packageDirOf(/** @type {string} */ input) {
  const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replace(/\\/g, '/'));
  return match?.[1];
}

/** Bundled third-party packages, sorted by name then version, one entry per package folder. */
export function bundledPackages(/** @type {string[]} */ inputs) {
  /** @type {Map<string, { name: string, version: string, license: string, dir: string }>} */
  const byDir = new Map();
  for (const input of inputs) {
    const dir = packageDirOf(input);
    if (!dir) continue;
    const real = realpathSync(dir);
    if (byDir.has(real)) continue;
    const manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    byDir.set(real, {
      name: manifest.name,
      version: manifest.version,
      license: typeof manifest.license === 'string' ? manifest.license : 'UNKNOWN',
      dir: real,
    });
  }
  return [...byDir.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
}

function licenceText(/** @type {string} */ dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : undefined;
}

export function render(/** @type {ReturnType<typeof bundledPackages>} */ packages) {
  const problems = [];
  const sections = packages.map((pkg) => {
    if (!ALLOWED.has(pkg.license) && !NOTES[pkg.name]) {
      problems.push(`${pkg.name}@${pkg.version}: licence ${pkg.license} is not allowed`);
    }
    const text = licenceText(pkg.dir);
    if (!text) problems.push(`${pkg.name}@${pkg.version}: no licence file`);
    const note = NOTES[pkg.name] ? `\nNote: ${NOTES[pkg.name]}` : '';
    return `${'-'.repeat(78)}\n${pkg.name} ${pkg.version} (${pkg.license})${note}\n${'-'.repeat(78)}\n\n${text ?? ''}\n`;
  });
  const header = `Churnmap includes the following third-party software, bundled into its JavaScript files.
Each is listed with its version and licence, followed by the licence text.

${packages.map((p) => `- ${p.name} ${p.version} (${p.license})`).join('\n')}

`;
  return { text: `${header}${sections.join('\n')}`, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!existsSync('dist/bundle-inputs.json')) {
    console.error('dist/bundle-inputs.json is missing: run `node esbuild.mjs --production` first.');
    process.exit(1);
  }
  const packages = bundledPackages(JSON.parse(readFileSync('dist/bundle-inputs.json', 'utf8')));
  const { text, problems } = render(packages);
  if (problems.length > 0) {
    console.error(`Third-party licence check failed:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
    if (current !== text) {
      console.error(`${OUTPUT} is out of date: run node scripts/third-party-notices.mjs`);
      process.exit(1);
    }
  } else {
    writeFileSync(OUTPUT, text);
  }
  console.log(
    `${OUTPUT}: ${String(packages.length)} bundled packages, licences ${[...new Set(packages.map((p) => p.license))].sort().join(', ')}`,
  );
}
