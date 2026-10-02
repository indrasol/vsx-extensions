/**
 * What kind of file a repository-relative path is, from its extension, its name and a few
 * well-known folders. Pure: no file is read. With `churnmap.rank: code` (the default) only `code`
 * files rank; every other kind is still measured and drawn, as glass.
 *
 * HTML is code unless it sits under a docs folder or at the repository root with a docs-like name
 * (`STATUS_TRACKER.html`, `release-notes.html`): templates such as `src/templates/page.html`
 * and an app's root `index.html` stay code.
 */

export type FileKind = 'code' | 'docs' | 'data' | 'config' | 'asset' | 'generated';

export const FILE_KINDS: readonly FileKind[] = [
  'code',
  'docs',
  'data',
  'config',
  'asset',
  'generated',
];

/** `churnmap.rank`: rank source code only (default) or every file. */
export type RankMode = 'code' | 'all';

export function isRankMode(x: unknown): x is RankMode {
  return x === 'code' || x === 'all';
}

const CODE = new Set([
  // JavaScript and TypeScript
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'mts',
  'cts',
  // Web front ends
  'vue',
  'svelte',
  'astro',
  'css',
  'scss',
  'sass',
  'less',
  'styl',
  // Python, Ruby, PHP, Perl, Lua, R, Julia
  'py',
  'pyi',
  'pyx',
  'rb',
  'php',
  'pl',
  'pm',
  'lua',
  'r',
  'jl',
  // JVM and .NET
  'java',
  'kt',
  'kts',
  'scala',
  'sc',
  'groovy',
  'clj',
  'cljs',
  'cljc',
  'cs',
  'fs',
  'fsx',
  'vb',
  // Systems
  'c',
  'h',
  'cc',
  'cpp',
  'cxx',
  'hh',
  'hpp',
  'hxx',
  'm',
  'mm',
  'rs',
  'go',
  'zig',
  'nim',
  'swift',
  'd',
  'v',
  'sv',
  'vhd',
  'asm',
  's',
  // Functional and others
  'hs',
  'ml',
  'mli',
  'ex',
  'exs',
  'erl',
  'hrl',
  'elm',
  'dart',
  'cr',
  'purs',
  'rkt',
  'lisp',
  'el',
  // Shells and scripting
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'psm1',
  'bat',
  'cmd',
  // Queries, contracts, infrastructure, schemas
  'sql',
  'sol',
  'tf',
  'hcl',
  'proto',
  'graphql',
  'gql',
  'prisma',
  'thrift',
  // Templates
  'html',
  'htm',
  'jinja',
  'j2',
  'njk',
  'hbs',
  'mustache',
  'ejs',
  'erb',
  'twig',
  'liquid',
  'razor',
  'cshtml',
]);

const DOCS = new Set([
  'md',
  'mdx',
  'markdown',
  'rst',
  'adoc',
  'asciidoc',
  'txt',
  'ipynb',
  'org',
  'tex',
]);

const DATA = new Set([
  'json',
  'jsonc',
  'json5',
  'ndjson',
  'yaml',
  'yml',
  'toml',
  'csv',
  'tsv',
  'xml',
  'lock',
  'sum',
  'parquet',
  'sqlite',
  'db',
]);

const CONFIG = new Set(['ini', 'cfg', 'conf', 'properties', 'env', 'editorconfig', 'gradle']);

const ASSET = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'ico',
  'icns',
  'svg',
  'webp',
  'avif',
  'tif',
  'tiff',
  'psd',
  'mp3',
  'mp4',
  'wav',
  'ogg',
  'webm',
  'mov',
  'avi',
  'flac',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'pdf',
  'zip',
  'gz',
  'tgz',
  'tar',
  'jar',
  'war',
  'wasm',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'pptx',
  'docx',
  'xlsx',
  'key',
  'sketch',
  'fig',
]);

/** Names (case-insensitive) that decide the kind whatever the extension. */
const NAMED: Readonly<Record<string, FileKind>> = {
  dockerfile: 'config',
  containerfile: 'config',
  makefile: 'config',
  gnumakefile: 'config',
  cmakelists: 'config',
  procfile: 'config',
  jenkinsfile: 'config',
  vagrantfile: 'config',
  gemfile: 'config',
  rakefile: 'code',
  brewfile: 'config',
  license: 'docs',
  licence: 'docs',
  copying: 'docs',
  notice: 'docs',
  authors: 'docs',
  codeowners: 'config',
  'go.sum': 'data',
  'cargo.lock': 'data',
  'package-lock.json': 'data',
  'pnpm-lock.yaml': 'data',
  'yarn.lock': 'data',
  'poetry.lock': 'data',
  'composer.lock': 'data',
  'gemfile.lock': 'data',
  'go.mod': 'config',
  'cmakelists.txt': 'config',
  'requirements.txt': 'config',
  'constraints.txt': 'config',
  'robots.txt': 'config',
};

/** Folders whose contents are built or vendored rather than written. */
const GENERATED_DIRS = new Set([
  'node_modules',
  'dist',
  'out',
  'vendor',
  '.next',
  '.nuxt',
  'coverage',
]);

const GENERATED_NAME = [
  /\.min\.[a-z0-9]+$/,
  /\.map$/,
  /\.snap$/,
  /\.generated\.[a-z0-9]+$/,
  /\.g\.dart$/,
  /\.freezed\.dart$/,
  /\.pb\.(go|cc|h)$/,
  /_pb2(_grpc)?\.pyi?$/,
  /\.designer\.cs$/,
];

const DOCS_DIRS = new Set(['docs', 'doc', 'documentation', 'wiki']);

/** Words that make a root-level HTML file read as a document rather than a template. */
const DOCS_WORDS =
  /(readme|changelog|changes|history|notes|progress|tracker|handoff|report|summary|guide|manual|roadmap|plan|spec|todo|license|contributing|release)/i;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** A root-level HTML name that reads as a document: ALL-CAPS (`STATUS_TRACKER`) or a docs word. */
function docsLikeName(stem: string): boolean {
  return (/^[A-Z0-9_-]+$/.test(stem) && /[A-Z]/.test(stem)) || DOCS_WORDS.test(stem);
}

/** The kind of a repository-relative, forward-slash path. Unknown extensions are `asset`. */
export function classify(path: string): FileKind {
  const segments = path.split('/').filter((s) => s.length > 0);
  const name = segments.at(-1) ?? '';
  const lower = name.toLowerCase();
  const folders = segments.slice(0, -1).map((s) => s.toLowerCase());

  // `generated/`, `_generated/`, `__generated__/` (client SDKs, GraphQL and OpenAPI output).
  if (folders.some((f) => GENERATED_DIRS.has(f) || /^_{0,2}generated_{0,2}$/.test(f))) {
    return 'generated';
  }
  if (GENERATED_NAME.some((re) => re.test(lower))) return 'generated';

  const named = NAMED[lower];
  if (named) return named;
  // `Dockerfile.dev`, `api.dockerfile`, `requirements-dev.txt`.
  if (/^(dockerfile|containerfile)\..+$|\.dockerfile$/.test(lower)) return 'config';
  if (/^requirements[\w.-]*\.(txt|in)$/.test(lower)) return 'config';

  const ext = extensionOf(lower);
  // Dotfiles (`.gitignore`, `.eslintrc.js`, `.env.local`) configure tools. `vite.config.ts` and
  // friends are not dotfiles: they run, so they stay code.
  if (lower.startsWith('.') && !ASSET.has(extensionOf(lower.slice(1)))) return 'config';

  if (ext === 'html' || ext === 'htm') {
    const underDocs = folders.some((f) => DOCS_DIRS.has(f));
    const atRoot = folders.length === 0;
    const originalStem = name.slice(0, name.lastIndexOf('.'));
    return underDocs || (atRoot && docsLikeName(originalStem)) ? 'docs' : 'code';
  }
  if (CODE.has(ext)) return 'code';
  if (DOCS.has(ext)) return 'docs';
  if (DATA.has(ext)) return 'data';
  if (CONFIG.has(ext)) return 'config';
  return 'asset';
}

/** The words a card uses for a kind ("Not ranked: documentation …"). */
export function kindLabel(kind: FileKind): string {
  switch (kind) {
    case 'code':
      return 'source code';
    case 'docs':
      return 'documentation';
    case 'data':
      return 'data file';
    case 'config':
      return 'configuration';
    case 'asset':
      return 'asset or other non-code file';
    case 'generated':
      return 'generated file';
  }
}

/** True when at least `threshold` of `paths` are not code (an "umbrella" of docs and notes). */
export function isMostlyNonCode(paths: readonly string[], threshold = 0.7): boolean {
  if (paths.length === 0) return true;
  const nonCode = paths.filter((p) => classify(p) !== 'code').length;
  return nonCode / paths.length >= threshold;
}
