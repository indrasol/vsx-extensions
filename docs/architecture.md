# Architecture — repo, CI/CD and metrics pipeline

_Living document describing the current state. Update when the structure changes.
The reasoning behind each choice is in `docs/adr/`._

## 1. Monorepo layout (target state)

```
vsx-extensions/
├── CLAUDE.md · README.md · LICENSE · SECURITY.md · CONTRIBUTING.md · CODEOWNERS
├── package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.js · .prettierrc · .npmrc · .editorconfig
├── .github/
│   ├── workflows/
│   │   ├── ci.yml               every PR: lint → typecheck → test (xvfb) → package; uploads .vsix
│   │   ├── security.yml         PR + weekly: gitleaks, pnpm audit, CycloneDX SBOM, vsce ls allow-list
│   │   ├── release.yml          tag <ext>@vX.Y.Z → build → package once → publish both registries → GitHub Release
│   │   └── metrics-collect.yml  daily cron → collector → Supabase
│   ├── ISSUE_TEMPLATE/ · pull_request_template.md · dependabot.yml
├── .vscode/                     shared editor settings + recommended extensions
├── docs/                        architecture, engineering-standards, security-practices, development, PROGRESS, adr/, specs/
├── templates/extension-starter/ golden template (copied for every new extension)
├── packages/labs-core/          shared, bundled from source: logger, telemetry wrapper (no-op sender in v1), "More from Labs" view
├── extensions/<name>/           one workspace per published extension
├── collector/                   Node/TS: registries + GitHub → Supabase (service-role key, CI only)
├── supabase/migrations/         SQL schema for metrics
└── dashboard/                   Vite + React one-pager, Netlify
```

Workspaces: `extensions/*`, `packages/*`, `templates/*`, `collector`, `dashboard`.
Each extension is bundled by esbuild into `dist/extension.js` and packaged with
`vsce package --no-dependencies`, so `node_modules` layout under pnpm never matters at
package time (ADR-0002).

## 2. Security controls (all free on a public repo)

| Control                                                           | Where                                                         | Status              |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ------------------- |
| CodeQL (JS/TS)                                                    | GitHub _default setup_, no workflow file                      | enable in setup 0.2 |
| Secret scanning + push protection                                 | GitHub repo settings                                          | enable in setup 0.2 |
| Dependabot alerts + security updates                              | GitHub repo settings                                          | enable in setup 0.2 |
| gitleaks, `pnpm audit`, SBOM, ship-list check                     | `security.yml`                                                | prompt 04           |
| Branch ruleset `protect-main`, tag ruleset `protect-release-tags` | GitHub Rules                                                  | setup 0.2           |
| Human approval on publish                                         | GitHub environment `marketplace-publish` (required reviewers) | setup 0.2           |
| CODEOWNERS security review on release/labs-core/deps              | `CODEOWNERS`                                                  | in repo             |

## 3. Release pipeline

```
git tag my-extension@v1.0.0 → push
   └─ release.yml
        ├─ parse tag → EXT=my-extension, VERSION=1.0.0 (must match extensions/my-extension/package.json)
        ├─ pnpm install --frozen-lockfile · build · test
        ├─ vsce package --no-dependencies → dist/my-extension-1.0.0.vsix   (packaged ONCE)
        ├─ [environment: marketplace-publish — waits for a human approver]
        ├─ ovsx publish dist/*.vsix -p $OVSX_TOKEN                      (Open VSX)
        ├─ azure/login (OIDC, managed identity) → vsce publish --packagePath dist/*.vsix --azure-credential --skip-duplicate
        └─ CycloneDX SBOM + sha256 → gh release create <tag> with .vsix, .sha256, .cdx.json
```

Identity: a user-assigned managed identity `labs-vscode-publisher` with a federated credential
trusting `repo:indrasol/vsx-extensions:environment:marketplace-publish`; it is a Contributor
on the `Indrasol` Marketplace publisher (ADR-0004). Open VSX uses a namespace access token
stored as an environment secret. No PATs.

## 4. Metrics data pipeline (Phase 4)

```
GitHub Actions cron 02:00 UTC ─ collector ─┬─ Marketplace gallery API (extensionquery, statistics)
                                            ├─ Open VSX API  GET /api/Indrasol/<ext>
                                            └─ GitHub API    repo, issues by label ext:<name>, traffic (14-day window)
                                                       │
                                                       ▼   (service-role key, GitHub secret only)
                                          Supabase Postgres: extensions, registry_snapshots,
                                          github_snapshots, releases, usage_events (v2)
                                                       │  RLS: select only for @indrasol.com JWTs
                                                       ▼
                             Netlify ← dashboard/ (Vite + React, supabase-js, anon key, Azure sign-in)
Extensions (v2, opt-in telemetry) → Supabase Edge Function /ingest → usage_events
```

All registry numbers are cumulative, so the collector snapshots daily and the dashboard views
compute deltas. The schema lives in `supabase/migrations/`.

## 5. How work lands

Small, reviewable tasks on short-lived branches, each merged by PR with green CI and one human
review. A new extension arrives here as a single "initial release" PR 2–3 days before launch;
from then on all of its development happens here (ADR-0010). The full process is described in
[`how-we-build.md`](how-we-build.md).
