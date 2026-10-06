# Churnmap: spec

**Extension:** `Indrasol.churnmap` · display name **Churnmap: Code Hotspots City** · tag
`churnmap@vX.Y.Z` (ADR-0008) · source [`extensions/churnmap/`](../../extensions/churnmap/) ·
version 1.0.0.

## 1. One-liner

Churnmap turns any git repository into a 3D city where the buildings that glow are the files
causing most of your bugs and delays, ranks them, tells you why, and gives you a postcard to share.

## 2. Problem

- In most codebases a small share of files is both complex and changed every week, and that is
  where defects and delays concentrate (Nagappan & Ball 2005, relative code churn as a predictor
  of fault-prone binaries; Tornhill & Borg 2022, defects and resolution time in low-health
  hotspots).
- Teams cannot see these files. New engineers take weeks to find them, refactoring time goes to
  the wrong places, and there is nothing concrete to point at when asking for time to fix them.
- AI-assisted coding concentrates churn further, and agents edit risky files without knowing they
  are risky.
- A risk signal without a reason and a next step gets ignored (Lewis et al., ICSE 2013), so every
  ranked file must explain itself and lead to an action.

## 3. Scope of 1.0

1. **City.** Folders are districts, files are buildings: height is lines of code, colour is the
   relative band. three.js in a webview with instanced meshes; hover cards with the reasons; click
   to select, double-click to open. Window of 30, 90 or 365 days. A 2D treemap of the same layout.
2. **Hotspots view.** The top 20 with score, trend, owners and reasons; open, show in city,
   ignore with a reason for 90 days, copy as Markdown.
3. **Daily surfaces.** Status-bar rank for the active file; a status-bar warning when staged or
   working-tree changes touch a hotspot.
4. **Postcard.** A 1600×900 PNG of the city and the top three, with the level of detail chosen
   before saving (paths, top-level folders or no names). Never any source text.
5. **AI-ready, all local.** A ready-to-paste prompt per hotspot, an agent context file
   (`.churnmap/HOTSPOTS.md` and `hotspots.json`), and a local MCP server shipped in the VSIX.
   Churnmap itself makes no AI calls.
6. **Zero setup, zero network.** Git is the only requirement. Nothing leaves the machine.

**Not in 1.0:** change-coupling views, a time-lapse of the city, an ownership overlay, issue
creation from a hotspot, parser-based complexity, `vscode.dev` support.

## 4. Users and moments

| User                    | Moment                    | What Churnmap does                                    |
| ----------------------- | ------------------------- | ----------------------------------------------------- |
| Engineer joining a repo | Day one                   | Shows the files that matter and who knows them        |
| Tech lead               | Tech-debt planning        | An evidence-based refactoring shortlist and a picture |
| Reviewer                | Before approving a change | "This diff touches hotspot #2 and #7"                 |
| Team using AI agents    | Every agent run           | Tells the agent which files are risky before it edits |

## 5. Architecture

```
extensions/churnmap/
├── src/
│   ├── extension.ts      activate: register everything, no I/O before registration
│   ├── analysis/         git reader (gitProcess.ts is the only spawn site), file measurement
│   │                     worker pool, classification, scoring, cache, repository discovery
│   ├── city/             browser-safe layout (squarified treemap), protocol, CSP HTML
│   ├── panel/            city panel host, Hotspots tree view, ignore store, Markdown export
│   ├── daily/            status-bar rank and the "hotspots in your changes" item
│   ├── export/           postcard flow (detail pick, save dialog, write bytes)
│   ├── ai/               AI prompts, agent context file, MCP configuration
│   └── links.ts          the only module that builds outbound URLs
├── mcp/src/              the local stdio MCP server (bundled to dist/mcp-server.js)
├── webview/              three.js city, 2D treemap, cards, rail, postcard renderer
└── test/                 unit (vitest) and integration (@vscode/test-cli) suites, fixtures
```

**Data flow.** _Build city_ → git history for the window and the current file set → measurement
in a worker pool → scoring → `AnalysisResult`, cached per repository, HEAD and window under
`globalStorageUri` → the city panel, Hotspots view, status bar and SCM item. A cached result for
the current HEAD fills everything after activation without starting git.

**Messages** between the extension host and the webview carry only paths, numbers and short
strings, and are validated on both sides. File contents never reach the webview.

## 6. Hotspot scoring

Per file, within the window:

| Component        | Definition                                                               | Weight |
| ---------------- | ------------------------------------------------------------------------ | ------ |
| Relative churn   | lines added and deleted in the window ÷ current lines, capped            | 0.30   |
| Change frequency | commits touching the file, recency-weighted                              | 0.25   |
| Complexity       | indentation depth (max and mean over non-blank lines), language-agnostic | 0.25   |
| Author spread    | distinct authors in the window                                           | 0.10   |
| Fix ratio        | share of commits whose message matches `churnmap.fixKeywords`            | 0.10   |

- Each component becomes a percentile rank among the eligible files (code files with at least 2
  commits and 20 lines in the window); the score is the weighted sum, 0–100.
- Bands are relative: **Hotspot** is the top 5 % (at least 3, at most 20), **Watch** the next
  15 %, **Stable** the rest, so #1 is always a Hotspot.
- Every ranked file shows its two or three strongest components as sentences with numbers, plus
  the complexity trend (now against the start of the window) for the top 20.
- Documentation, data, configuration, assets and generated files are measured and drawn as glass
  but not ranked unless `churnmap.rank` is `all`. History follows renames.

The README's "How scoring works" section is the user-facing version, with a worked example.

## 7. Safety model

- **Workspace Trust** (`untrustedWorkspaces.supported: "limited"`): Churnmap activates in
  Restricted Mode but runs no git and reads no files until the workspace is trusted.
  Repository discovery reads folder names only and is safe before trust.
- **Git invocation** (ADR-0012): `spawn`, never a shell; git resolved to an absolute path from
  `git.path` or `PATH`; every call passes `-c core.pager=cat -c core.fsmonitor=false
-c core.hooksPath=<empty folder in Churnmap's storage>` and the environment
  `GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 GIT_CONFIG_NOSYSTEM=1`; `--` before every path list;
  no argument comes from typed text. Missing git, dubious ownership and shallow clones produce a
  plain-language message.
- **Webview** (ADR-0011): three.js bundled into `media/webview.js`; a strict CSP with a fresh nonce
  per load; `localResourceRoots` limited to `media/`; no remote assets, no `eval`. The webview asks
  the host to open files only by checked repository-relative paths.
- **Exports** are written only after a save dialog (postcard) or an explicit command (agent
  context file, MCP configuration). Existing agent configs are merged, never overwritten.

## 8. MCP server

`dist/mcp-server.js` ships in the VSIX and is started by the user's own agent configuration
(_Churnmap: Connect to AI agent…_ writes it for Cursor, Claude Code or VS Code). Tools:
`list_hotspots`, `explain_file`, `hotspots_in_changes`, `get_prompt`, `list_repositories` and
`build`. Every tool but `build` is read-only; `build` runs the same analysis pipeline and git
safety as the extension and writes only Churnmap's cache (and an existing `.churnmap/`).

The server only sees repositories inside its scope (the `--workspace` folders it was configured
with); a `repo` outside it is refused, and every answer names the scope. It never returns file
contents. Adding the server to an agent's configuration is the user's trust decision.

## 9. Privacy

- Zero telemetry (ADR-0013): no telemetry code ships, and no install or user id is stored.
- No network calls. Links in the side bar and walkthrough are first-party short links that open
  in the browser only on a click.
- The postcard contains the repository folder's name, the window, the legend, the city's shapes
  and the top three at the chosen detail level; no source, history, authors or text metadata.
- The cache (scores and line counts, JSON) lives in the extension's global storage and is cleared
  by _Churnmap: Clear cache_. Ignored hotspots live in workspace state, never in the repository.
- AI prompts include commit subjects (never bodies or file contents) and are shown before they are
  copied.

## 10. Test plan

- **Unit** (vitest): git log parsing (renames, binary, merges, non-ASCII, Windows separators),
  measurement, classification, scoring, layout, protocol validation, MCP tools and scope, the
  README listing. Coverage gate: 80 % lines.
- **Integration** (`@vscode/test-cli`), on the `engines.vscode` minimum (1.96.0) and stable, each
  against a freshly generated fixture repository: `clean` (everything), `hostile` (a `.git/config`
  that tries to run a program; asserts it never runs), `untrusted` (Restricted Mode), `umbrella`
  (notes around a nested code repository).
- **CI:** Ubuntu, Windows and macOS on every pull request; CodeQL, gitleaks, dependency audit,
  ship-list check and a CycloneDX SBOM.

## 11. Acceptance criteria for 1.0

- Install → _Build city_ → city and ranked hotspots within 10 s on a 5k-file repository.
- Every hotspot shows at least two reasons; open goes to the file.
- Activation under 100 ms, measured inside `activate()`.
- VSIX at most 1.5 MB (three.js and the bundled MCP server included).
- Postcard contains no source text and respects the detail level.
- CSP strict; no network calls; integration tests green on Windows, macOS and Linux, on the
  minimum and stable VS Code.
