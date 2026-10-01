# Indrasol Labs: VS Code & Open VSX extensions monorepo

Indrasol Labs publishes small, secure, high-polish developer extensions (MIT) to the
VS Code Marketplace and Open VSX. Publisher: `Indrasol`.
Repo: `github.com/indrasol/vsx-extensions` (public).

## Stack

TypeScript (strict) · esbuild · pnpm workspaces · @vscode/test-cli · GitHub Actions.
Metrics, dashboard and the links site live outside this repo (ADR-0013).

## Hard rules

- Read docs/engineering-standards.md and docs/security-practices.md before any extension work.
- Every new extension starts from templates/extension-starter/.
- No network calls or telemetry without going through packages/labs-core and a documented opt-in.
- Never commit secrets. Never publish from a laptop: releases happen only via tags → release.yml.
- Package with `vsce package --no-dependencies` (bundled with esbuild).
- Conventional Commits with scope = workspace name, e.g. `feat(<ext>): …`, `chore(ci): …`.
- Work on a branch (`ext/<name>/<task>` or `chore/<task>`) and open a PR; `main` is protected.
- This repo is public. Never copy content from the private planning repo into it (ideas,
  roadmap, targets, internal names). ADR-0010.
- When given a task prompt, do exactly what it asks. Do not start the next task.

## Where to look

- Engineering status: docs/PROGRESS.md · Decisions: docs/adr/ · Architecture: docs/architecture.md
- Process: docs/how-we-build.md · Per-extension build notes: docs/build-notes/
- Local setup: docs/development.md · Launched extension specs: docs/specs/<ext>.md
- Maintainers: task prompts and draft specs live in the private planning repo, checked out as the
  sibling folder `../labs-internal/` (see its README).
