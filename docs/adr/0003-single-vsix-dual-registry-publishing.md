# ADR 0003 — Package once, publish the same VSIX to Open VSX and the VS Code Marketplace

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Cursor, Windsurf, VSCodium, Gitpod and other forks install from Open VSX; VS Code installs
from the Marketplace. Users on both must get an identical, verifiable artifact.

## Decision

`release.yml` triggers on tags `<extension>@vX.Y.Z`, builds and packages the VSIX exactly
once, publishes that file to Open VSX (`ovsx publish`) and to the Marketplace
(`vsce publish --packagePath … --skip-duplicate`), and attaches the same VSIX, its SHA-256 and
a CycloneDX SBOM to a GitHub Release. The tag version must equal `package.json` version or
the job fails before publishing.

## Alternatives considered

- Separate build per registry: risk of divergence, defeats the SHA-256 attestation.
- Publishing from a laptop: no audit trail, secrets on machines. Forbidden (docs/security-practices.md).
- `HaaLeo/publish-vscode-extension` action: good, but hides the Entra OIDC flow; may adopt later.

## Consequences

One tag = one release everywhere. `--skip-duplicate` makes re-runs safe. Open VSX still
needs a token secret because it has no OIDC option; rotate yearly.
