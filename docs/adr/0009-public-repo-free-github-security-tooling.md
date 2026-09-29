# ADR 0009 — Rely on GitHub's free security tooling for public repos (CodeQL default setup, secret scanning, Dependabot)

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

The org is on the GitHub Team plan. On a private repo, CodeQL and secret-scanning push
protection require the paid GitHub Code Security add-on. On a public repo, GitHub provides
CodeQL code scanning, secret scanning with push protection, Dependabot alerts/updates and
unlimited standard Actions minutes at no cost. The program's constraint is zero cash cost.

## Decision

Keep the repo public (ADR-0005) and use GitHub's built-in features: CodeQL via _default
setup_ (no workflow file to maintain), secret scanning + push protection, Dependabot alerts
and security updates. `security.yml` adds what GitHub does not: gitleaks on PRs, `pnpm audit`,
a CycloneDX SBOM artifact and a `vsce ls` ship-list check.

## Alternatives considered

- Buying GitHub Code Security for a private repo: recurring cost, no benefit for MIT code.
- Semgrep OSS / ESLint security plugins instead of CodeQL: viable if the repo ever goes
  private; note here as the fallback.

## Consequences

The "CodeQL clean" line in docs/security-practices.md is satisfied by the default-setup check on each PR.
If the repo is ever made private, this ADR must be superseded and `security.yml` extended.
