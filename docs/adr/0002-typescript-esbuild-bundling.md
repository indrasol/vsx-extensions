# ADR 0002 — TypeScript strict + esbuild single-file bundles, packaged with `--no-dependencies`

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

pnpm stores dependencies as symlinks; `vsce package` walks `node_modules` and produces broken
or bloated packages in that layout. VS Code also recommends bundling for activation speed
(our budget: < 100 ms activation, < 1 MB VSIX).

## Decision

Every extension is TypeScript in strict mode, bundled by esbuild into `dist/extension.js`
(CommonJS, `vscode` external, minified for release), and packaged with
`vsce package --no-dependencies`. `.vscodeignore` ships only `dist/`, `media/`, README,
CHANGELOG, LICENSE and `telemetry.json`.

## Alternatives considered

- webpack: works, slower and more config. esbuild is the VS Code team's own sample default.
- Not bundling and using `vsce package` with npm: forces npm in a pnpm repo. Rejected.

## Consequences

Fast activation, tiny packages, and `vsce ls` becomes a meaningful security check. Node
built-ins used by dependencies must be bundle-safe; check when adding libraries.
