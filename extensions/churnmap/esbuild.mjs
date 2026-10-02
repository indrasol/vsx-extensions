import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** The file-measuring worker (src/analysis/pool.ts starts it from dist/worker.js). */
const worker = {
  ...extension,
  entryPoints: ['src/analysis/worker.ts'],
  outfile: 'dist/worker.js',
};

/**
 * The local MCP server (`node dist/mcp-server.js --cache-dir …`), started by the user's agent. The
 * MCP SDK and zod are bundled in (devDependencies), so the VSIX needs no node_modules and the
 * extension keeps a single runtime dependency. It shares the analysis modules, including
 * gitProcess.ts (ADR-0012). No `external`: a `vscode` import here fails the build.
 */
const mcpServer = {
  entryPoints: ['mcp/src/server.ts'],
  outfile: 'dist/mcp-server.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  define: {
    // `pnpm package:dev` builds with its unique dev version (scripts/dev-version.mjs).
    CHURNMAP_VERSION: JSON.stringify(
      process.env.CHURNMAP_BUILD_VERSION ??
        JSON.parse(readFileSync('package.json', 'utf8')).version,
    ),
  },
  logLevel: 'info',
};

/**
 * The city webview (ADR-0011): a browser IIFE with three.js bundled in, so the webview loads no
 * remote code. Minified for release; source maps only in development (never shipped).
 */
const webview = {
  entryPoints: ['webview/main.ts'],
  outfile: 'media/webview.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  minify: production,
  sourcemap: !production,
  treeShaking: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

/** The webview stylesheet, copied (and minified for release) next to the script. */
const webviewStyles = {
  entryPoints: ['webview/styles.css'],
  outfile: 'media/webview.css',
  bundle: true,
  minify: production,
  logLevel: 'info',
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

const configs = tests
  ? [extension, worker, mcpServer, webview, webviewStyles, integrationTests]
  : [extension, worker, mcpServer, webview, webviewStyles];

if (watch) {
  const contexts = await Promise.all(configs.map((config) => esbuild.context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  const results = await Promise.all(
    configs.map((config) => esbuild.build({ ...config, metafile: true })),
  );
  // Every source file that went into a shipped bundle, for scripts/third-party-notices.mjs and
  // scripts/sbom.mjs: the third-party code we ship is exactly the node_modules files listed here.
  // Release builds only: the test bundles pull in packages that never ship (the MCP client).
  if (production && !tests) {
    const inputs = [...new Set(results.flatMap((r) => Object.keys(r.metafile.inputs)))].sort();
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/bundle-inputs.json', `${JSON.stringify(inputs, null, 2)}\n`);
  }
}
