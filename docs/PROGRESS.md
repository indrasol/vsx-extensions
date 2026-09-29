# Engineering progress log

_Append a short entry after every merged task. Newest at the top._

## 2026-09-29

- **Done:** pnpm workspace (`extensions/*`, `packages/*`, `templates/*`, `collector`, `dashboard`),
  hardened `.npmrc` (`ignore-scripts`, `engine-strict`, `save-exact`), shared `tsconfig.base.json`,
  ESLint flat config (typescript-eslint strict-type-checked) and Prettier, `.editorconfig`,
  `.vscode/` settings, a smoke `packages/labs-core` with a Vitest test, SHA-pinned `ci.yml`
  (job `ci`: format → lint → typecheck → test (xvfb) → build → package, uploads `.vsix`) and
  Dependabot for npm and GitHub Actions. PR: https://github.com/indrasol/vsx-extensions/pull/1
- **Next:** extension-starter template.

## 2026-09-27

- **Done:** Repository scaffold: CLAUDE.md, README, LICENSE (MIT), SECURITY, CONTRIBUTING, CODEOWNERS,
  `.github` templates, architecture, engineering standards, security practices, development setup,
  ADR-0001…0010, how-we-build and build-notes.
- **Next:** pnpm workspace, tooling baseline and `ci.yml`.
