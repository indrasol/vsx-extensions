# Churnmap: build notes

How Churnmap 1.0 was built and verified. The spec is [`../specs/churnmap.md`](../specs/churnmap.md);
the process is described in [`../how-we-build.md`](../how-we-build.md).

## 1. What it does and why

Churnmap draws a git repository as a 3D city and ranks the files where change, size and
complexity meet: the hotspots where bugs and delays cluster. Every ranked file explains itself in
plain sentences with numbers, and the result feeds the developer's own AI agent through a prompt,
a context file and a local MCP server. Commercial hotspot analysis exists outside the editor; the
free code-city extensions draw a picture but compute no hotspot. Churnmap does both, locally, with
git as the only requirement.

## 2. Key design decisions

- **Bundled renderer, strict CSP** ([ADR-0011](../adr/0011-webview-rendering-bundled-libraries-strict-csp.md)).
  three.js (pinned) is bundled into `media/webview.js`; the webview loads nothing remote, runs
  under a per-load nonce, and receives only paths, numbers and short strings.
- **Safe git and Workspace Trust** ([ADR-0012](../adr/0012-git-invocation-safety-and-workspace-trust.md)).
  One spawn site (`src/analysis/gitProcess.ts`) adds the pager, fsmonitor and hooks overrides and
  the git environment variables to every call. Analysis is off until the workspace is trusted.
- **No telemetry** ([ADR-0006](../adr/0006-telemetry-anonymous-opt-out-respecting-vscode-setting.md),
  [ADR-0013](../adr/0013-metrics-and-lead-capture-outside-public-repo.md)). The labs-core wrapper
  is wired to a no-op sender; links are first-party short links opened only on a click.
- **Relative bands, explained scores.** Bands are percentiles within the repository, so #1 is
  always a Hotspot, and no score is ever shown without its reasons.
- **Indentation complexity.** Language-agnostic and linear in file size, measured in a
  `worker_threads` pool; parser-based complexity is left for later.
- **Cache keyed by repository, HEAD and window.** HEAD is read from `.git`, so reopening a
  repository fills the city without starting git.
- **Code-only ranking by default.** Documentation, data, configuration and generated files are
  drawn as glass but not ranked, so frequently edited notes never outrank risky code.
- **MCP server in the VSIX, scoped to the workspace.** It shares the analysis modules and git
  safety with the extension; the MCP SDK and zod are bundled from devDependencies, so the only
  runtime dependency stays `three`.

## 3. How it was built, in order

Each step was one task given to Claude Code, reviewed by a maintainer.

1. **Scaffold** from `templates/extension-starter`: manifest, commands, views, settings,
   walkthrough, `untrustedWorkspaces: limited`; activation tests on VS Code 1.96.0 and stable.
2. **Git history reader**: the single spawn site with the ADR-0012 flags, a streaming byte-level
   parser for `git log -z --numstat` (renames, binary files, merges, non-ASCII paths).
3. **File measurement**: `git ls-files -z`, exclusions, size and binary skips, indentation
   complexity in a worker pool.
4. **Scoring and cache**: percentile scoring, worded reasons, complexity trend for the top 20,
   JSON cache, _Set time window_ and _Clear cache_.
5. **City layout**: a deterministic squarified treemap in browser-safe code, folding to districts
   above 10 000 buildings.
6. **City webview**: the CSP host panel, instanced three.js buildings, theme sync, a validated
   message protocol.
7. **Interaction**: hover cards, click to select and open, top-20 glow, window switch, keyboard
   orbit, a focusable list, high contrast and reduced motion.
8. **2D treemap** sharing the layout and the interaction layer, with a 3D ↔ 2D morph.
9. **Hotspots view** with reasons, inline actions and copy as Markdown.
10. **Ignore with a reason** for 90 days, stored in workspace state, with Undo.
11. **Daily surfaces**: status-bar rank, the "hotspots in your changes" item from the built-in Git
    API, warm start from the cache.
12. **Postcard export** with a detail level chosen before saving.
13. **Visual design pass and README**: the city's look, cards, rail and legend; README, demo GIF
    and screenshots recorded from a seeded fixture repository with a frozen animation clock.
14. **Repository choice and code-only ranking** for nested, multi-root and umbrella workspaces.
15. **AI last mile**: AI prompts, the agent context file, the local MCP server with workspace
    scope, and _Connect to AI agent…_.
16. **Release matrix**: three consecutive green runs of every integration configuration,
    performance on real repositories, container check, third-party notices, security checklist.
17. **Initial release** into this repository: CI on Windows and macOS, the SBOM covering bundled
    devDependencies, store-safe README URLs.

## 4. Verification

| Check                    | Result                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Unit tests               | 55 files, 680 tests; 97 % statement coverage (gate: 80 % lines)                       |
| Integration, per version | `clean` 94, `hostile` 3, `untrusted` 5, `umbrella` 11 passing, on 1.96.0 and stable   |
| Hostile repository       | the fixture's `core.pager` / `core.fsmonitor` / `core.hooksPath` trap never runs      |
| Activation               | about 2 ms inside `activate()` (budget 100 ms)                                        |
| VSIX                     | 13 shipped files, about 390 KB (budget 1.5 MB)                                        |
| Containers               | the packaged analysis ran in the Dev Containers Node image, non-root, with no network |
| CI                       | Ubuntu, Windows and macOS; CodeQL, gitleaks, audit, ship-list, SBOM                   |

Performance on full clones, 90-day window, default settings, VS Code stable (build from an empty
cache until the city reports it has rendered):

| Repository        | Files measured | Commits (90 d) | Build + city    | Cached rebuild |
| ----------------- | -------------- | -------------- | --------------- | -------------- |
| expressjs/express | 214            | 20             | 0.48 s          | 7 ms           |
| facebook/react    | 7 120          | 154            | 1.26 s          | 48 ms          |
| microsoft/vscode  | 19 262         | 6 077          | 10.1 s (folded) | 125 ms         |

On microsoft/vscode most of the time is one `git log --numstat --find-renames` call over 6 077
commits; streaming the city before history finishes is a candidate improvement.

## 5. What we learned

- `@vscode/test-electron` always adds `--disable-workspace-trust`, so the untrusted
  configuration starts VS Code through a small launcher that drops that one argument.
- VS Code's built-in Git extension runs `git status` without safety flags, so the hostile
  fixture turns it off to measure only Churnmap.
- `vsce` lets any `!` pattern win over an exclusion: `!media/**` would have shipped a source map,
  so media files are listed by name in `.vscodeignore`.
- `vsce` turns text such as "#1" into issue links and needs absolute base URLs for a README in a
  monorepo; the package script sets both, and a check fails on anything else.
- Screenshot tests that wait on a render-settled signal from the webview instead of fixed sleeps
  stopped being flaky, and editors that deliver few animation frames to a webview need a timer
  behind every animation.
- An MCP server started by an agent may start in a folder above the project; scoping it to the
  configured workspace keeps unrelated repositories out of its answers.
