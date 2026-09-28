# Security practices

Indrasol is a cybersecurity company, so Indrasol Labs extensions are held to a visibly higher
standard. This page is linked from every extension README. To report a vulnerability, see
[`SECURITY.md`](../SECURITY.md).

## Release checklist (the maintainer signs off in the release PR)
- [ ] Dependencies are minimal and pinned via the lockfile. No `postinstall` scripts
      (`ignore-scripts=true`). `pnpm audit` shows no high or critical issues.
- [ ] Secret scan (gitleaks in CI, GitHub push protection) is clean. Both registries also scan
      packages and reject any that contain secrets.
- [ ] CodeQL (GitHub default setup) is clean for the extension's code.
- [ ] A CycloneDX SBOM is generated and attached to the GitHub Release.
- [ ] `vsce ls` reviewed: only `dist/`, `media/`, README, CHANGELOG, LICENSE and `telemetry.json` ship.
- [ ] No dynamic code execution (`eval`, `new Function`, remote script loading). Webviews use a
      strict Content Security Policy with nonces.
- [ ] Network calls are opt-in, documented and HTTPS-only. Telemetry is anonymous and respects the
      VS Code telemetry setting.
- [ ] Release notes and CHANGELOG are updated. The GitHub Release includes the VSIX, its SHA-256 and the SBOM.

## Pipeline controls
- Publishing happens **only from CI**, from a protected tag, in a GitHub environment that requires
  a human approval. No laptop publishes.
- Marketplace publishing uses a short-lived Entra ID (OIDC) credential from a managed identity; no
  personal access tokens exist (ADR-0004).
- The same VSIX file is published to both registries; its SHA-256 is in the GitHub Release so
  anyone can verify what they installed (ADR-0003).
- All changes go through pull requests on a protected `main`; `CODEOWNERS` routes every change to a maintainer.

## Program-level
- Two-factor authentication on every Marketplace, Open VSX and GitHub account; publisher and
  namespace membership reviewed quarterly.
- Dependabot security updates, secret scanning with push protection and CodeQL are enabled on this repo.
- Vulnerability reports: acknowledged within 2 business days; critical issues fixed or mitigated within 7 days.
- Auto-updates reach users quickly, so every release is treated as if it ships to everyone immediately.
