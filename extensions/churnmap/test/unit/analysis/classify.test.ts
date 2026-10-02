import { describe, expect, it } from 'vitest';
import {
  classify,
  type FileKind,
  FILE_KINDS,
  isMostlyNonCode,
  isRankMode,
  kindLabel,
} from '../../../src/analysis/classify.js';

const TABLE: readonly [string, FileKind][] = [
  // Code: the common languages.
  ['src/app.ts', 'code'],
  ['src/App.tsx', 'code'],
  ['lib/index.js', 'code'],
  ['lib/view.jsx', 'code'],
  ['scripts/build.mjs', 'code'],
  ['scripts/legacy.cjs', 'code'],
  ['api/main.py', 'code'],
  ['cmd/server/main.go', 'code'],
  ['crates/core/src/lib.rs', 'code'],
  ['src/main/java/App.java', 'code'],
  ['app/src/Main.kt', 'code'],
  ['build.gradle.kts', 'code'],
  ['src/Main.scala', 'code'],
  ['Service/Program.cs', 'code'],
  ['src/Lib.fs', 'code'],
  ['src/engine.cpp', 'code'],
  ['src/engine.cc', 'code'],
  ['src/engine.c', 'code'],
  ['include/engine.h', 'code'],
  ['include/engine.hpp', 'code'],
  ['ios/View.m', 'code'],
  ['ios/Bridge.mm', 'code'],
  ['Sources/App.swift', 'code'],
  ['app/models/user.rb', 'code'],
  ['public/index.php', 'code'],
  ['lib/widget.dart', 'code'],
  ['plugin/init.lua', 'code'],
  ['analysis/model.r', 'code'],
  ['src/solver.jl', 'code'],
  ['lib/app.ex', 'code'],
  ['test/app_test.exs', 'code'],
  ['src/server.erl', 'code'],
  ['src/core.clj', 'code'],
  ['src/Main.hs', 'code'],
  ['bin/main.ml', 'code'],
  ['db/migrations/001_init.sql', 'code'],
  ['scripts/deploy.sh', 'code'],
  ['scripts/setup.bash', 'code'],
  ['tools/release.ps1', 'code'],
  ['src/components/Card.vue', 'code'],
  ['src/routes/+page.svelte', 'code'],
  ['src/pages/index.astro', 'code'],
  ['contracts/Token.sol', 'code'],
  ['infra/main.tf', 'code'],
  ['src/styles/app.css', 'code'],
  ['api/schema.graphql', 'code'],
  ['vite.config.ts', 'code'],
  // HTML: code unless it is a document by place or name.
  ['src/templates/page.html', 'code'],
  ['index.html', 'code'],
  ['public/404.htm', 'code'],
  ['STATUS_TRACKER.html', 'docs'],
  ['release-notes.html', 'docs'],
  ['docs/architecture.html', 'docs'],
  ['site/docs/intro.htm', 'docs'],
  // Docs.
  ['README.md', 'docs'],
  ['SESSION_HANDOFF.md', 'docs'],
  ['docs/guide.mdx', 'docs'],
  ['docs/index.rst', 'docs'],
  ['manual.adoc', 'docs'],
  ['notes.txt', 'docs'],
  ['notebooks/explore.ipynb', 'docs'],
  ['LICENSE', 'docs'],
  // Data.
  ['package.json', 'data'],
  ['config/app.yaml', 'data'],
  ['.github/workflows/ci.yml', 'data'],
  ['pyproject.toml', 'data'],
  ['fixtures/users.csv', 'data'],
  ['pom.xml', 'data'],
  ['yarn.lock', 'data'],
  ['Cargo.lock', 'data'],
  ['go.sum', 'data'],
  ['pnpm-lock.yaml', 'data'],
  // Config.
  ['.gitignore', 'config'],
  ['.eslintrc.js', 'config'],
  ['.env.local', 'config'],
  ['.editorconfig', 'config'],
  ['Dockerfile', 'config'],
  ['api.dockerfile', 'config'],
  ['Dockerfile.dev', 'config'],
  ['Makefile', 'config'],
  ['CMakeLists.txt', 'config'],
  ['requirements.txt', 'config'],
  ['requirements-dev.txt', 'config'],
  ['setup.cfg', 'config'],
  ['go.mod', 'config'],
  // Assets.
  ['media/logo.png', 'asset'],
  ['public/favicon.ico', 'asset'],
  ['assets/icon.svg', 'asset'],
  ['fonts/Inter.woff2', 'asset'],
  ['docs/spec.pdf', 'asset'],
  ['screenshots/home.jpeg', 'asset'],
  ['data/blob.xyz', 'asset'],
  // Generated.
  ['public/vendor.min.js', 'generated'],
  ['dist/extension.js', 'generated'],
  ['web/node_modules/react/index.js', 'generated'],
  ['assets/app.js.map', 'generated'],
  ['test/__snapshots__/card.test.ts.snap', 'generated'],
  ['vendor/github.com/pkg/errors/errors.go', 'generated'],
  ['api/user.pb.go', 'generated'],
  ['proto/user_pb2.py', 'generated'],
  ['lib/model.g.dart', 'generated'],
  ['src/__generated__/types.ts', 'generated'],
  ['src/acme/_generated/api/tasks/tasks_list.py', 'generated'],
  ['src/generated/client.ts', 'generated'],
];

describe('classify', () => {
  it(`classifies ${String(TABLE.length)} paths`, () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(60);
    const wrong = TABLE.filter(([path, kind]) => classify(path) !== kind).map(
      ([path, kind]) => `${path}: expected ${kind}, got ${classify(path)}`,
    );
    expect(wrong).toEqual([]);
  });

  it.each(TABLE)('%s → %s', (path, kind) => {
    expect(classify(path)).toBe(kind);
  });

  it('ignores the case of extensions and names', () => {
    expect(classify('SRC/APP.TS')).toBe('code');
    expect(classify('Docs/Guide.MD')).toBe('docs');
    expect(classify('MAKEFILE')).toBe('config');
  });

  it('labels every kind for the card', () => {
    expect(FILE_KINDS.map(kindLabel)).toEqual([
      'source code',
      'documentation',
      'data file',
      'configuration',
      'asset or other non-code file',
      'generated file',
    ]);
  });
});

describe('isMostlyNonCode', () => {
  it('is true at 70 % or more non-code files, and for an empty list', () => {
    const docs = (n: number) => Array.from({ length: n }, (_, i) => `notes/${String(i)}.md`);
    const code = (n: number) => Array.from({ length: n }, (_, i) => `src/${String(i)}.ts`);
    expect(isMostlyNonCode([...docs(7), ...code(3)])).toBe(true);
    expect(isMostlyNonCode([...docs(6), ...code(4)])).toBe(false);
    expect(isMostlyNonCode(code(1))).toBe(false);
    expect(isMostlyNonCode([])).toBe(true);
  });
});

describe('isRankMode', () => {
  it('accepts code and all only', () => {
    expect(isRankMode('code')).toBe(true);
    expect(isRankMode('all')).toBe(true);
    expect(isRankMode('docs')).toBe(false);
    expect(isRankMode(undefined)).toBe(false);
  });
});
