# How we build Indrasol Labs extensions

**AI-accelerated, human-reviewed, security-verified.**

Indrasol Labs ships one small developer tool every few weeks with a small team. We can do that
because AI agents do much of the planning and implementation work, while people own every
decision, every review and every release. This page describes the process so you can judge the
tools you install, and borrow anything useful.

## The loop

```
  Idea ──► Spec + decisions ──► Task prompts ──► Implementation ──► Human review ──► Security gates ──► Release
  (researched,   (written by the     (one small,      (Claude Code, in    (PR, 1+ approval,   (CI: lint, tests,     (CI only, after a
   scored)        planning agent,     verifiable       the engineer's      CODEOWNERS)         CodeQL, gitleaks,     human approves the
                  approved by a       task at a        editor, tests                           audit, SBOM, ship-    publish environment)
                  lead)               time)            and commits)                            list check)
```

1. **Research before code.** Every idea is checked against the VS Code Marketplace, Open VSX and
   GitHub for existing tools, and against the editors' and agents' own roadmaps, before anyone
   writes a line. If a good tool already exists, we don't build it.
2. **Decisions are written down.** Architecture choices are recorded as short, immutable
   [ADRs](adr/). The repo's [`CLAUDE.md`](../CLAUDE.md) gives coding agents the same rules a new
   engineer would get.
3. **Work is cut into small task prompts.** A planning agent (Claude, in Cowork) turns the spec into
   one task at a time: objective, context to read, steps, acceptance criteria, verification commands
   and the commit message. The prompts for each extension are published in its
   [build notes](build-notes/) after launch.
4. **An agent implements; an engineer owns the result.** Claude Code implements each task in the
   engineer's editor, runs the tests and opens a pull request. Commits carry a `Co-Authored-By`
   trailer so AI involvement is visible in the history.
5. **Humans review everything.** A maintainer reviews every PR and every AI-written line before it
   merges, and signs off the security checklist before each release.
6. **Security gates are automatic and mandatory.** See [security practices](security-practices.md):
   CodeQL, secret scanning with push protection, gitleaks, dependency audit, a CycloneDX SBOM,
   and a check that the package ships only the files it should.
7. **Publishing is CI-only and human-approved.** One VSIX is built once and published to both
   registries using short-lived Entra ID credentials (no personal access tokens). The GitHub Release
   carries the VSIX, its SHA-256 and the SBOM so you can verify what you installed.

## Why this matters for the tools you install
- **Small scope:** each extension does one job, so it's easy to read and audit.
- **Local-first:** no network calls by default; any telemetry is anonymous, documented and
  follows your VS Code telemetry setting.
- **Traceable:** from the decision (ADR) to the task prompt, the PR, the CI run and the signed-off
  release.

Questions or ideas? Open an issue. Found a vulnerability? See [`SECURITY.md`](../SECURITY.md).
