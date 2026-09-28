# Contributing to Indrasol Labs

Thanks for helping. This repo is a pnpm monorepo; every extension lives under `extensions/`.

## Ground rules
- Read [`docs/engineering-standards.md`](docs/engineering-standards.md) and
  [`docs/security-practices.md`](docs/security-practices.md) first; set up with
  [`docs/development.md`](docs/development.md).
- New extensions start as a copy of `templates/extension-starter/`.
- TypeScript strict, ESLint + Prettier clean, tests green (`pnpm test`).
- No network calls or telemetry outside `packages/labs-core`, and never without a documented opt-in.
- Never commit secrets. Push protection is on; if it blocks you, the secret is real — rotate it.

## Workflow
1. Branch from `main`: `ext/<extension>/<task>` or `chore/<task>`.
2. Commit with Conventional Commits, scope = workspace name: `feat(<ext>): add status bar badge`.
3. Open a PR. CI must be green and a maintainer reviews it (see `CODEOWNERS`).
4. Releases are cut only by maintainers tagging `<extension>@vX.Y.Z` on `main`; `release.yml` does
   the rest after a human approves the publish environment.

## Proposing an extension
Open an issue with the **Extension idea** template. Maintainers review ideas regularly and
reply on the issue.
