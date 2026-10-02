import { describe, expect, it } from 'vitest';
import { BUILTIN_EXCLUDES, compileGlobs, globToRegExp } from '../../../src/analysis/glob.js';

const CASES: [pattern: string, path: string, matches: boolean][] = [
  // Basename patterns (no slash) match at any depth.
  ['*.lock', 'yarn.lock', true],
  ['*.lock', 'packages/a/Cargo.lock', true],
  ['*.lock', 'lock/file.ts', false],
  ['README.md', 'docs/README.md', true],
  ['README.md', 'docs/README.mdx', false],
  ['?.ts', 'src/a.ts', true],
  ['?.ts', 'src/ab.ts', false],
  // `**` directories.
  ['**/dist/**', 'dist/extension.js', true],
  ['**/dist/**', 'packages/core/dist/index.js', true],
  ['**/dist/**', 'distance/metric.ts', false],
  ['**/dist/**', 'src/dist', false],
  ['**/node_modules/**', 'a/node_modules/b/c/d.js', true],
  ['src/**/*.test.ts', 'src/a.test.ts', true],
  ['src/**/*.test.ts', 'src/deep/er/a.test.ts', true],
  ['src/**/*.test.ts', 'test/a.test.ts', false],
  // Single `*` stays inside one segment when the pattern has a slash.
  ['src/*.ts', 'src/a.ts', true],
  ['src/*.ts', 'src/sub/a.ts', false],
  // `*.min.*` minified files.
  ['**/*.min.*', 'public/js/app.min.js', true],
  ['**/*.min.*', 'app.min.css', true],
  ['**/*.min.*', 'src/minify.ts', false],
  // Braces.
  ['**/*.{png,jpg}', 'media/logo.png', true],
  ['**/*.{png,jpg}', 'media/logo.jpg', true],
  ['**/*.{png,jpg}', 'media/logo.gif', false],
  ['{docs,examples}/**', 'examples/x/y.md', true],
  ['{docs,examples}/**', 'src/docs/y.md', false],
  // Everything else is literal.
  ['file(1).txt', 'file(1).txt', true],
  ['a+b.ts', 'aab.ts', false],
  ['[x].ts', '[x].ts', true],
  ['{unclosed', '{unclosed', true],
  // Leading ./ or / anchors at the root; a trailing slash means "the folder".
  ['./build/**', 'build/out.js', true],
  ['/build/**', 'src/build/out.js', false],
  ['generated/', 'generated/types.ts', true],
];

describe('globToRegExp', () => {
  it.each(CASES)('%s vs %s → %s', (pattern, path, matches) => {
    expect(globToRegExp(pattern).test(path)).toBe(matches);
  });

  it('accepts backslashes in the pattern as separators', () => {
    expect(globToRegExp('src\\**\\*.ts').test('src/a/b.ts')).toBe(true);
  });
});

describe('compileGlobs', () => {
  it('matches when any pattern matches, ignoring blank patterns', () => {
    const match = compileGlobs(['', '*.snap', 'vendor/**']);
    expect(match('src/__snapshots__/a.test.ts.snap')).toBe(true);
    expect(match('vendor/lib.js')).toBe(true);
    expect(match('src/a.ts')).toBe(false);
  });

  it('matches nothing with no patterns', () => {
    expect(compileGlobs([])('anything')).toBe(false);
  });

  it('built-ins cover generated, vendored and lock files', () => {
    const builtIn = compileGlobs(BUILTIN_EXCLUDES);
    for (const path of [
      'node_modules/x/index.js',
      'dist/a.js',
      'packages/a/out/main.js',
      'web/app.min.js',
      'Gemfile.lock',
      'pnpm-lock.yaml',
      'package-lock.json',
      'yarn.lock',
      'test/__snapshots__/x.snap',
      'dist.map',
      'third_party/vendor/lib.c',
    ]) {
      expect(builtIn(path), path).toBe(true);
    }
    for (const path of ['src/distance.ts', 'src/output.ts', 'src/vendors.ts', 'README.md']) {
      expect(builtIn(path), path).toBe(false);
    }
  });
});
