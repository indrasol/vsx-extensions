## What

<!-- One or two sentences on what changed and why. -->

## Checklist

- [ ] CI green (lint, typecheck, test, package)
- [ ] No telemetry added; no network calls outside `packages/labs-core`
- [ ] No secrets, no `postinstall` scripts, dependencies justified
- [ ] Docs updated (`docs/PROGRESS.md` line added; living docs or ADR if a decision changed)

## Release-only (tick if this PR prepares a release)

- [ ] Version bumped (SemVer) + CHANGELOG
- [ ] Works in VS Code and Cursor
- [ ] `vsce ls` reviewed: only dist/, media/, README, CHANGELOG, LICENSE ship
- [ ] Release checklist in docs/security-practices.md signed off by the maintainer
- [ ] README / GIF current
- [ ] Tag to push after merge: `<ext>@vX.Y.Z`
