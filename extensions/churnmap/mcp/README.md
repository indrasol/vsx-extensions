# Churnmap MCP server

A local, stdio [Model Context Protocol](https://modelcontextprotocol.io) server that gives an AI
agent Churnmap's code hotspots. Source in `src/`, bundled by `esbuild.mjs` to
`dist/mcp-server.js`, which ships inside the VSIX. The MCP SDK and zod are bundled in (they are
devDependencies); the extension's only runtime dependency stays `three`.

```
node dist/mcp-server.js --cache-dir <dir> [--workspace <folder>]... [--repo <root>] [--git <path>]
node dist/mcp-server.js --help
```

- `--cache-dir` (required, absolute): Churnmap's storage folder. The extension passes its own
  `globalStorageUri`, so the server and the editor share one cache (`<dir>/cache`, same key and
  version). A `build` here warm-starts the editor, and the other way round.
- `--workspace` (repeatable, absolute): a workspace folder the server may see, one flag per folder
  of a multi-root workspace. _Connect to AI agent_ writes one per workspace folder. These folders
  are the server's whole **scope** (see below).
- `--repo` (optional): the repository when a call names none. With `--workspace` it must be inside
  the scope, or every call that relies on it is refused. Otherwise the repository the extension
  last analysed for a workspace folder (`<cache-dir>/cache/index.json`), else the only repository
  in the scope, else the only one that is not an umbrella of notes; with several code
  repositories the tools return the list and the agent passes `repo`.
- `--git` (optional): the git executable; default `git` on `PATH`.

## Scope

Agents do not always start a server in the project: Cursor, for one, can start it in a folder
above it, where discovery would find every project on the disk. So the server only ever sees the
repositories inside its scope:

1. the `--workspace` folders, when given;
2. else `--repo`'s folder (an explicit pin, narrower than any folder);
3. else the working directory, but only when it is inside a git repository (a `.git` there or in
   a parent);
4. else none, and every tool answers
   `Churnmap MCP has no workspace configured; reconnect via Churnmap: Connect to AI agent`.

`list_repositories`, `list_hotspots({ repo: "all" })` and every `repo` argument are limited to
repositories inside the scope; a `repo` outside it is refused with the allowed folders, before
the folder is looked at. Discovery walks down from the scope folders (three levels) and never
above them. A scope folder with no repository at or below it, but inside one (a monorepo package
opened on its own), uses that enclosing repository.

Every answer starts with one line naming the scope, such as
`Scope: Acme workspace, 5 repositories` (`a + b workspace` for several folders; `folder` or
`repository` when the scope came from the working directory or `--repo`), and JSON answers carry
it as `scope: { source, roots, repositories }`.

## Tools

| Tool                  | What it returns                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_hotspots`       | `{ repo, head, generatedAt, window, stale, top }`, the same shape as `.churnmap/hotspots.json`; `repo: "all"`: every code repository, top 5 each, with cache freshness |
| `explain_file`        | score, band, reasons (sentence + numbers), LOC, commits, authors, trend, recent commit subjects; the "not ranked" reason otherwise                                     |
| `hotspots_in_changes` | the subset of the given paths that are in the top 20, with rank and reasons                                                                                            |
| `get_prompt`          | the AI prompt (`refactor-plan`, `tests-first`, `explain-history`, `review-changes`)                                                                                    |
| `list_repositories`   | every repository in the scope: root, nested, umbrella (mostly docs), and which one the extension analysed last                                                         |
| `build`               | runs the analysis pipeline, writes the cache (and refreshes an existing `.churnmap/`), returns a summary                                                               |

Every description starts with "Use this…" so agents pick the tools for questions like "which
files are hotspots?". Every tool but `build` has `readOnlyHint: true`; `build` has
`readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false`.

`stale` is true when there is no cache for the repository, or the cache was built for another
HEAD (read from `.git` without starting git). The text then says to call `build`.

## Safety

- The server is started by the user's own agent config. **Adding it there is the trust
  decision**; the server does not know about VS Code's Workspace Trust.
- `build` uses the same `runAnalysis` and `gitProcess.ts` as the extension (ADR-0012): absolute
  git, argument arrays, `-c core.pager=cat -c core.fsmonitor=false -c core.hooksPath=<cache-dir>/hooks-empty`,
  `GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 GIT_CONFIG_NOSYSTEM=1`. The integration tests run it
  on the hostile fixture and assert the trap never fires.
- Repository paths must be inside the scope, exist, be folders inside a git repository and contain
  no `..`. File paths are repository-relative (absolute paths inside the repository are accepted
  and converted).
- It reads git history and file sizes and indentation for the analysis, never returns file
  contents, writes only under `--cache-dir` and to a repository's existing `.churnmap/`, and opens
  no network connection. stdout carries the protocol; logs go to stderr.
- Analysis settings are the extension's defaults (`settings.ts`, kept in step with package.json
  by a unit test). Someone with custom `churnmap.*` settings gets a cache entry the editor treats
  as a miss and rebuilds; nothing breaks.

## Three ways to connect

1. **From the extension (recommended):** _Churnmap: Connect to AI agent…_
   - _Cursor (this project)_ merges `mcpServers.churnmap` into `.cursor/mcp.json`;
   - _Claude Code (this project)_ merges it into `.mcp.json`;
   - _VS Code_ registers the `churnmap.mcp` server-definition provider (VS Code 1.101+, no file
     written; the server runs on VS Code's runtime with `ELECTRON_RUN_AS_NODE=1`), or writes
     `servers.churnmap` (`type: "stdio"`) to `.vscode/mcp.json` on older versions;
   - _Show config_ opens the JSON snippet.

   Every entry names the workspace folders with `--workspace`. Paths are absolute and include the
   extension version, so on activation the extension offers (one question, one update) to fix
   configs that point at an older `dist/mcp-server.js` or that name no `--workspace` yet.

2. **By hand:** copy the snippet from _Show config_ into any MCP client's configuration.
3. **Cursor Marketplace plugin** (`cursor-plugin/`, not shipped in the VSIX): the MCP entry plus
   a skill that tells the agent when to call the tools. It starts the server with
   `npx -y @indrasol/churnmap-mcp`, a package that is **not published yet**; see
   `cursor-plugin/README.md` for the steps before submitting it.
