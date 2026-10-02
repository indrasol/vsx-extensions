# Developing Churnmap

Notes for working on the extension. The user-facing documentation is [README.md](README.md), which
is also the Marketplace and Open VSX listing; this file is not shipped in the VSIX.

## Run and test

- **Run:** open this folder in VS Code and press F5 (_Run Extension_).
- `pnpm build` bundles the extension, the analysis worker and the city webview with esbuild
  (ADR-0002); `pnpm watch` rebuilds on change.
- `pnpm lint`, `pnpm typecheck` (the extension and, separately, the webview with DOM types),
  `pnpm format:check`.
- `pnpm test` runs the unit tests (vitest, with coverage thresholds) and then the integration
  tests inside VS Code (`@vscode/test-cli`).
- `pnpm build` also bundles the local MCP server (`mcp/src/server.ts` → `dist/mcp-server.js`,
  MCP SDK and zod bundled in). Try it with `node dist/mcp-server.js --help`; `mcp/README.md` has
  the tools and the safety rules.
- `pnpm package` builds and writes the VSIX to `dist/`, then checks that every image and link in
  the packaged README is an absolute `https://` URL (`scripts/check-readme-urls.mjs`). Check what
  ships with `pnpm exec vsce ls --no-dependencies`.
- `pnpm build` also writes `ThirdPartyNotices.txt` (shipped) with
  `scripts/third-party-notices.mjs`: every third-party package esbuild actually bundled
  (`dist/bundle-inputs.json`, from the build's metafiles), with its licence text. The build fails
  on a licence other than MIT, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0 unless `NOTES` in
  that script explains it. Commit the regenerated file with any dependency change.
- `pnpm sbom churnmap` at the repository root writes a CycloneDX 1.5 SBOM to
  `dist/sbom.cdx.json` (not shipped). Besides `pnpm list --prod`, it reads
  `dist/bundle-inputs.json`, so the packages bundled from devDependencies (the MCP SDK, zod and
  their dependencies) are listed too. Run it after `pnpm build`.
- `pnpm package:dev` writes `dist/churnmap-dev.vsix` with a unique version,
  `<version>-dev.<yyyymmddHHMM>` (`scripts/dev-version.mjs`; `package.json` is not edited). Install it
  over any earlier build with `cursor --install-extension dist/churnmap-dev.vsix --force` (or
  `code …`). Reinstalling a VSIX of the _same_ version can leave the editor running the old code.
- `CHURNMAP_CURSOR=/Applications/Cursor.app/Contents/MacOS/Cursor pnpm exec vscode-test --label cursor`
  runs the clean integration tests inside Cursor. Cursor gives a webview far fewer animation
  frames than VS Code, which is why every city animation also has a timer that finishes it.

### Integration test configurations

`.vscode-test.mjs` runs every configuration on the `engines.vscode` minimum (1.96.0) and on
stable, each against a freshly generated fixture repository (real git, fake dates), so nothing on
the developer's machine influences the result:

| Configuration | Fixture                                                               | Tests               |
| ------------- | --------------------------------------------------------------------- | ------------------- |
| `clean`       | a plain repository, VS Code's Git extension on                        | everything else     |
| `hostile`     | a `.git/config` that tries to run a program (ADR-0012)                | `adr0012.test.ts`   |
| `untrusted`   | Workspace Trust on and the folder not trusted                         | `untrusted.test.ts` |
| `umbrella`    | a repository of notes with the code in a nested repository it ignores | `umbrella.test.ts`  |
| `demo`        | only with `CHURNMAP_DEMO=1`, stable only: the README demo repository  | `demo.test.ts`      |
| `cursor`      | only with `CHURNMAP_CURSOR=<Cursor executable>`: `clean` in Cursor    | everything else     |

`@vscode/test-electron` adds `--disable-workspace-trust` to every launch, so the untrusted run
starts VS Code through a small wrapper that drops that one argument.

Screenshot and capture tests wait on the webview's render-settled signal (`test:settle`: no tween
or 3D ↔ 2D morph running, then two more frames) instead of a fixed delay; every test-mode frame
wait also has a 100 ms timer, so a webview that gets no animation frames cannot hang a test.

### Performance on real repositories

`pnpm perf:real` (`scripts/perf-real.mjs`, after `pnpm build`) clones microsoft/vscode,
facebook/react and expressjs/express with full history into `<tmp>/churnmap-perf/` (kept between
runs), runs the analysis headlessly (the MCP `build` pipeline with the worker pool) from an empty
cache and from the cache, then runs the opt-in `perf` integration configuration
(`CHURNMAP_PERF_REPO=<repo>`, stable only, `perf.test.ts`): _Build city_, the city drawn and a
240-frame orbit. It prints a Markdown table and writes `test-output/perf-real.json`.
`--repo <path>` measures your own repository instead; `--blobless` clones with
`--filter=blob:none` (git then fetches blobs one by one during `git log --numstat`, which is slow
and on microsoft/vscode failed in plain git, so full clones are the default).

### Containers

`node scripts/container-check.mjs` (after `pnpm package`; needs Docker) runs the packaged VSIX's
analysis (`dist/mcp-server.js`, the same pipeline and git safety as _Build city_) inside the
official Dev Containers Node image, as a non-root user with no network, against the hostile
fixture repository, and checks the build, the #1 hotspot and that the fixture's trap never ran.
Churnmap is `extensionKind: ["workspace"]`, so in a Dev Container, WSL or over SSH it runs on the
side where the code is.

### Windows, macOS and Linux in CI

The `ci` job runs every workspace on Ubuntu; the `churnmap` job in `.github/workflows/ci.yml`
runs this extension's lint, typecheck, unit and integration tests (every configuration, on the
`engines.vscode` minimum and on stable) and packaging on Windows and macOS as well.

Windows path handling is covered by unit tests that run on every OS: `glob.test.ts` (backslashes
in patterns), `gitLog.test.ts` (backslashes normalised in git output), `cache.test.ts` (forward
slashes and case folding on Windows), `gitProcess.test.ts` (`git.exe` with `;` separators),
`daily/format.test.ts` (Windows separators and case, Windows roots, Windows paths onto repository
paths), `openFile.test.ts` and `city/protocol.test.ts` (backslash traversal refused). The
untrusted run's VS Code launcher has a Windows (`.cmd`) variant in `.vscode-test.mjs`.

### Fixtures

- `test/fixtures/make-repo.mjs`: `makeRepo()` is the integration fixture (13 commits, one rename,
  a binary file, fix commits and a merge; `src/core/engine.js` must rank #1). `makeDemoRepo()` is
  the richer, seeded `acme-shop` repository the README media is recorded from: 120 TypeScript
  files in 8 folders and about 6 months of history from 6 authors.
  `node test/fixtures/make-repo.mjs [--demo]` prints the path of a new one to look at.
- `test/fixtures/make-umbrella.mjs`: the umbrella workspace.
- The screenshot test in `city.test.ts` writes 1600×900 PNGs of the fixture city to
  `test-output/` (gitignored) for a person to look at.

## README media

- `node scripts/make-demo-gif.mjs` records `media/readme/demo.gif` (960×540, 15 fps, 10 s) and the
  two screenshots `media/readme/city-dark.png` and `media/readme/treemap-light.png`. It runs the
  `demo` configuration: `demo.test.ts` freezes the webview's animation clock (`test:clock`),
  captures each frame at an exact time (`test:frame`) and follows the storyboard: the intro rise
  (0–2 s), a fly-to on #1 with its card (2–5 s), the _Needs attention_ rail flying to #2 (5–7 s),
  and the 3D → 2D morph and back (7–10 s). Because the clock is frozen, the result does not depend
  on how fast the machine captures. The encoder (`gifenc`) uses one palette for all frames, makes
  unchanged pixels transparent and merges repeated frames; it fails above 4 MB or 10 s.
  `--encode` re-encodes the frames already in `test-output/demo/`.
- To record the GIF by hand instead: record the city with the macOS screen recorder (or any
  recorder), trim to 10 s or less, then `gifski --width 960 --fps 15 -o media/readme/demo.gif
recording.mov`.
- `node scripts/readme-tables.mjs` rewrites the README's Settings and Commands tables from
  `package.json` (`--check` only compares). `test/unit/listing.test.ts` fails when they drift, and
  also checks the store fields (display name, description, the 30 keywords) and the README's
  sections and links.
- README images and links use relative paths in the repository. `pnpm package` passes
  `--baseContentUrl` and `--baseImagesUrl` (the `extensions/churnmap` folder on `main`) so `vsce`
  rewrites them to absolute GitHub URLs that work on both stores, and
  `scripts/check-readme-urls.mjs` fails the package if any URL in the packaged README is not
  absolute `https://`. After a merge to `main`, `node scripts/check-readme-urls.mjs --resolve`
  also checks that every URL answers 200. `media/readme/**` and this file are not in the
  `.vscodeignore` allow-list, so they are not shipped.

## Links

`src/links.ts` is the only module that builds outbound URLs: first-party short links under
`https://labs.indrasol.com/go/churnmap/<placement>` (and `/go/indrasol/<placement>`), where the
placement says where the link was clicked. Links open through `vscode.env.openExternal` only on a
user click (the _More from Indrasol Labs_ view and the walkthrough's hidden
`churnmap.openTalkLink` command); the extension makes no network calls. A unit test fails on any
other `https://` in `src/` or `webview/` (the SVG namespace excepted).

## How analysis works

Analysis runs only in a trusted workspace. _Build city_ finds git (the `git.path` setting, else
`git` on `PATH`, always started by absolute path and checked with `git --version`), then reads the
history of the current branch for the selected window with one streamed
`git log -z --numstat --find-renames` call, parsed as UTF-8 bytes (renames, binary files, merges
and non-ASCII paths included). Git is started with `spawn`, never a shell, and every call passes
`-c core.pager=cat -c core.fsmonitor=false -c core.hooksPath=<an empty folder in Churnmap's
storage>` with the environment `GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 GIT_CONFIG_NOSYSTEM=1`,
so a repository's own configuration cannot make git run a program; `--` precedes every path list
and no argument comes from typed text (ADR-0012). Files are measured (lines and indentation
complexity) in a worker pool.

Repository discovery reads folders only (up to three levels deep, at most 50 repositories and
2 000 folders, skipping `node_modules`, virtual environments, build output and the
`churnmap.exclude` globs), so it is safe before the workspace is trusted.

Results are cached as JSON per repository, HEAD and window under the extension's global storage;
a cached analysis for the current HEAD fills the panel, city and status bar after activation
without starting git (warm start). The cache format is versioned (`ANALYSIS_VERSION`); a file
with another version is ignored and rebuilt.

## Architecture notes

- **Webview (ADR-0011).** The city is a browser bundle with three.js included, loaded under a
  strict CSP with a per-load nonce. Every message from the webview is validated
  (`src/city/protocol.ts`); test-only messages are accepted only in test mode.
- **Telemetry (ADR-0006).** None in 1.0. `telemetry.json` lists the events a future version would
  send, as not collected; `src/telemetry.ts` wires the labs-core wrapper to a no-op sender.
- **Naming (ADR-0008).** The id `Indrasol.churnmap` never changes; the description ends with
  "by Indrasol Labs".
- **Activation.** No I/O and no `await` before everything is registered. `activate()` measures
  its own duration and returns it in test mode; the integration tests assert it is under 100 ms
  (loading the bundle on a cold machine is not counted).
