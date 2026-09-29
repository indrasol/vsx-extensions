# Security Policy

Indrasol is a cybersecurity company, and Indrasol Labs extensions are held to a higher bar
than "it works". This page explains how we build and how to reach us.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report privately via
GitHub's _Report a vulnerability_ button on this repository (Security → Advisories), or
email **security@indrasol.com**.

We commit to:

- acknowledging your report within **2 business days**;
- a fix or mitigation for critical issues within **7 days**, and a coordinated disclosure
  timeline for everything else;
- crediting you in the release notes if you wish.

## What we do on every release

- Dependencies are minimal and pinned via the lockfile; no `postinstall` scripts;
  `pnpm audit` shows no high or critical issues.
- Secret scanning (gitleaks in CI, plus GitHub push protection) is clean.
- CodeQL analysis is clean.
- A CycloneDX SBOM is generated and attached to the GitHub Release together with the
  VSIX and its SHA-256.
- `vsce ls` is reviewed so only `dist/`, `media/`, README, CHANGELOG, LICENSE and
  `telemetry.json` ship.
- No dynamic code execution; webviews use a strict CSP with nonces.
- No network calls by default. Anything that talks to the network is opt-in and documented.
- Telemetry, when present, is anonymous, documented in `telemetry.json`, and respects the
  VS Code telemetry setting.
- Publishing happens only from CI, from a protected tag, after a human approval gate.
  No laptop ever publishes.

Supported versions: the latest published version of each extension.
