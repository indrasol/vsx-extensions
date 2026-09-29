# ADR 0001 — One public monorepo (`indrasol/vsx-extensions`) with pnpm workspaces

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Indrasol Labs will ship 12–15 extensions in a year plus a shared core package, a golden
template, a metrics collector and a dashboard. Developers and coding agents work best when the
whole picture is in one context. An early plan used the name `indrasol-labs`; the org
created `vsx-extensions` before this ADR.

## Decision

All Labs code lives in one public GitHub repo, `indrasol/vsx-extensions`, managed as a
pnpm workspace: `extensions/*`, `packages/*`, `templates/*`, `collector`, `dashboard`.
We keep the existing repo name; any older reference to `indrasol-labs` means this repo.

## Alternatives considered

- One repo per extension: cleaner listings, but N copies of CI, security config and docs,
  and no shared context for the agent. Rejected.
- npm/yarn workspaces: fine, but pnpm's strict linking catches phantom dependencies and is
  the fastest in CI. Chosen pnpm.
- Renaming the repo to `indrasol-labs`: cosmetic; GitHub redirects would work but it churns
  links. Not worth it.

## Consequences

Shared tooling, one CI, one security posture. Extension packaging must not depend on
`node_modules` layout (see ADR-0002). Release tags need the extension name in them (ADR-0003).
