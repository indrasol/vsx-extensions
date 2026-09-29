# ADR 0004 — Marketplace publishing via Entra ID managed identity (OIDC), not PATs

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

Marketplace publishing historically used an Azure DevOps PAT. Microsoft retires global
Azure DevOps PATs on **1 December 2026** and now documents workload identity federation as
the recommended path (`vsce publish --azure-credential`). Indrasol has an Azure tenant.

## Decision

A user-assigned managed identity `labs-vscode-publisher` with a federated credential for
`repo:indrasol/vsx-extensions:environment:marketplace-publish` is added as a Contributor on
the `Indrasol` publisher. `release.yml` runs in the `marketplace-publish` GitHub environment
(required human reviewers), logs in with `azure/login` (`id-token: write`, no subscription
needed) and publishes with `--azure-credential`. Only `AZURE_CLIENT_ID` and `AZURE_TENANT_ID`
are stored, as environment secrets.

## Alternatives considered

- PAT in `VSCE_PAT`: works until 2026-12-01, long-lived secret. Allowed only as a documented
  temporary fallback recorded in PROGRESS.md.
- App Registration with a client secret or federated credential: authenticates but the
  Marketplace rejects publishes from app registrations (`InvalidAccessException`). Rejected.
- Federated credential scoped to Branch or Tag: a tag subject matches one exact tag only.
  Environment scope is the only durable choice.

## Consequences

No secret to rotate for the Marketplace; every publish is gated by a human approving the
environment. One-time step: obtain the identity's Azure DevOps profile id via
`az rest … profiles/me` while authenticated as the identity and add it to the publisher.
