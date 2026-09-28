# ADR 0005 — MIT license and open source by default; the repo is public

- **Status:** Accepted
- **Date:** 2026-09-27

## Context
Labs extensions exist to build trust and brand. Developers inspect extension source before
installing security-adjacent tools, and public repos unlock free GitHub security tooling
(see ADR-0009).

## Decision
The monorepo is public and every community extension is MIT. Product-linked extensions
(TestMate, IndraTrace, TasksMate front doors) decide licensing case by case in their own ADR
and may live in a separate private repo if closed.

## Alternatives considered
- Apache-2.0: patent grant is nice but heavier; MIT is the ecosystem norm for VS Code extensions.
- Private repo with public listings: loses the trust signal and costs money for CodeQL. Rejected.

## Consequences
Everything committed is public from day one: no internal hostnames, client names or secrets
ever enter the repo. Push protection and gitleaks enforce this.
