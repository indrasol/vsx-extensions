import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

/** @type {esbuild.BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  logLevel: 'info',
};

/** The extension. @indrasol/labs-core is bundled from source, so the VSIX needs no node_modules. */
const extension = {
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
};

/** Integration tests, run by @vscode/test-cli inside VS Code (mocha is provided by the runner). */
const integrationTests = {
  ...shared,
  entryPoints: readdirSync('test/integration')
    .filter((file) => file.endsWith('.test.ts'))
    .map((file) => join('test/integration', file)),
  outdir: 'out/test/integration',
  external: ['vscode', 'mocha'],
  sourcemap: true,
};

const configs = tests ? [extension, integrationTests] : [extension];

if (watch) {
  const contexts = await Promise.all(configs.map((config) => esbuild.context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(configs.map((config) => esbuild.build(config)));
}
