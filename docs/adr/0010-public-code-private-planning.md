# ADR 0010 — Private planning and pre-release builds; public release, CI and maintenance

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

This repo is public (ADR-0005, ADR-0009). Extension code is effectively public once released,
since every published VSIX can be unzipped and read, and open source is the norm for developer
extensions and a trust signal for a security company. Planning material is different: the idea
roadmap, program strategy, targets and launch plans are business information, and an extension
under construction reveals what is coming before launch.

The program also runs at zero cash cost. On the GitHub Team plan, public repositories get
unlimited GitHub-hosted Actions minutes, CodeQL, secret scanning with push protection and
Dependabot for free; private repositories draw on a metered minutes quota and need paid add-ons
for CodeQL and push protection.

## Decision

- **Planning is private.** A private internal repository (Indrasol staff only) holds the program
  playbook, roadmap, task specs, prompts, launch plans, runbooks and reviews.
- **Pre-release extension code is built privately, locally verified.** A new extension is
  developed in the private repository until it is a release candidate. The private repository runs
  **no GitHub Actions and uses no paid scanning**: lint, typecheck, tests, packaging and a
  gitleaks pre-commit hook run on the engineer's machine.
- **Shared foundation is public from day one.** The extension template, `packages/labs-core`, CI,
  security and release workflows live here. Pre-release extensions build against this repo's
  `labs-core` from a local sibling checkout.
- **Release candidates move here 2–3 days before launch**, as a single "initial release" commit
  (no private history), via a normal PR. Full CI, CodeQL, gitleaks, audit and SBOM run here before
  any tag is cut. Publishing happens only from this repo (ADR-0003, ADR-0004).
- **The move is one-way.** After it, this repo is the extension's permanent home for issues,
  community PRs, fixes and releases. An extension is never developed in both places.
- At launch, a cleaned-up spec (`docs/specs/`) and build notes with the extension's task prompts
  (`docs/build-notes/`) are published here, per `docs/how-we-build.md`.

## Alternatives considered

- Everything public, including in-progress builds: simplest, but reveals each extension 2–4
  weeks early. Rejected by preference; acceptable fallback if the move step becomes a burden.
- Everything private: costs money (minutes, CodeQL, push protection) and loses the open-source
  trust signal while hiding nothing the published VSIX does not reveal. Rejected.
- CI in the private repo within the included minutes: free up to the quota, but adds a metered
  dependency and a second CI setup. Rejected in favour of local checks until release candidate.

## Consequences

Engineering docs in this repo stay self-contained and never reference private files. Security
findings from CodeQL surface only at release candidate, so the move happens early enough to fix
them before launch. Relative paths (tsconfig `extends`, the `labs-core` link) change on the move;
the promotion procedure handles this. Pre-release code is protected only by local checks, so the
gitleaks hook is mandatory for everyone committing to the private repo.
