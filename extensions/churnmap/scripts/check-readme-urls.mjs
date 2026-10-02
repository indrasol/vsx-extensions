// Checks the README inside the packaged VSIX, which is the listing on both stores. `vsce` only
// rewrites relative URLs from the package script's --baseContentUrl / --baseImagesUrl, and a
// relative image breaks on the Marketplace, so every image and link must be absolute https://
// (in-page `#anchors` excepted). vsce would also turn text such as "#1" into an issue link; the
// package script switches that off and this fails on any issue or PR link the source lacks.
//
//   node scripts/check-readme-urls.mjs [--vsix <file>]             run by `pnpm package`
//   node scripts/check-readme-urls.mjs [--vsix <file>] --resolve   also GET every URL; expects 200
//                                                                   (after a merge to main)
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

/** One file from a zip archive, by name (stored or deflated entries; enough for a VSIX). */
export function readZipEntry(/** @type {Buffer} */ zip, /** @type {string} */ name) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error('not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entry = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (entry === name) {
      const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(dataAt, dataAt + size);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`${name}: unsupported compression method ${String(method)}`);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
}

/** Every Markdown link/image target and HTML src/href in `markdown`. */
export function readmeUrls(/** @type {string} */ markdown) {
  const urls = [];
  for (const m of markdown.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    urls.push(m[1]);
  }
  for (const m of markdown.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) urls.push(m[1]);
  for (const m of markdown.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) urls.push(m[1]);
  return [...new Set(urls)];
}

/** The URLs that are neither absolute https:// nor an in-page anchor. */
export function relativeUrls(/** @type {string[]} */ urls) {
  return urls.filter((url) => !url.startsWith('#') && !/^https:\/\/[^/]+/.test(url));
}

async function main() {
  const argv = process.argv.slice(2);
  const vsixAt = argv.indexOf('--vsix');
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const vsix =
    vsixAt === -1
      ? `dist/${String(manifest.name)}-${String(manifest.version)}.vsix`
      : String(argv[vsixAt + 1]);
  const readme = readZipEntry(readFileSync(vsix), 'extension/readme.md');
  if (!readme) {
    console.error(`${vsix} has no extension/readme.md`);
    process.exit(1);
  }
  const urls = readmeUrls(readme.toString('utf8'));
  const source = readFileSync('README.md', 'utf8');
  const autolinks = urls.filter(
    (url) => /\/(issues|pull)\/\d+$/.test(url) && !source.includes(url),
  );
  const bad = [...relativeUrls(urls), ...autolinks];
  if (bad.length > 0) {
    console.error(
      `✗ ${String(bad.length)} README URL(s) in ${vsix} are not absolute https:// or were added by vsce:`,
    );
    for (const url of bad) console.error(`    ${url}`);
    process.exit(1);
  }
  console.log(
    `✓ README in ${vsix}: ${String(urls.length)} URLs, all absolute https:// or #anchors`,
  );

  if (!argv.includes('--resolve')) return;
  let failed = 0;
  for (const url of urls.filter((u) => !u.startsWith('#'))) {
    const res = await globalThis
      .fetch(url, { method: 'GET', redirect: 'follow' })
      .catch((/** @type {unknown} */ err) => ({ status: String(err) }));
    const ok = res.status === 200;
    if (!ok) failed += 1;
    console.log(`${ok ? '✓' : '✗'} ${String(res.status)} ${url}`);
  }
  if (failed > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
