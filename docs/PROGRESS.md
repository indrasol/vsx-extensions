# Engineering progress log

_Append a short entry after every merged task. Newest at the top._

## 2026-09-29 — extension-starter template

- **Done:** `templates/extension-starter` is the golden template every extension is copied from
  (never published, `preview: true`). esbuild bundles `src/extension.ts` with `@indrasol/labs-core`
  from source into a 4.8 KB `dist/extension.js` (CJS, `node20`, `vscode` external). `activate`
  registers the `extensionStarter.hello` command, the labs-core logger, no-op telemetry and the
  `labsMoreFromLabs` view with no `await` or I/O, and logs its duration in development mode. Also
  included: a two-step walkthrough, untrusted/virtual workspace support, an allow-list
  `.vscodeignore`, `telemetry.json` (four events, none collected), a README with every
  Definition-of-done section as placeholders, Keep-a-Changelog and F5 launch configs. Vitest unit test
  (80% line gate on `src/hello.ts`) and `@vscode/test-cli` integration tests (activation < 100 ms,
  command registered and runnable, view contributed) run on VS Code 1.96.0 and stable. `pnpm package`
  now produces `dist/extension-starter-0.0.0.vsix` (37.5 KB); CI caches VS Code downloads. The Node
  floor is now 22.12: `@vscode/test-electron` 3, required by current stable VS Code builds, needs
  Node 22. PR: https://github.com/indrasol/vsx-extensions/pull/5
- **Next:** security workflow (`security.yml`).

## 2026-09-29 — labs-core

- **Done:** `packages/labs-core` is now the shared package every extension bundles from source
  (no runtime dependencies, optional `vscode` peer): `createLogger` over a `LogOutputChannel`
  (errors logged as class + message, stacks only on opt-in); `createTelemetry` on
  `vscode.env.createTelemetryLogger()` with a sender that is a no-op unless `enabled` is set and a
  transport is supplied (neither happens in v1, ADR-0006), common properties limited to extension
  id/version, VS Code version, app name and a random `labs.installId`, `scrub()` dropping path-like
  or over-long values, and a gate on `isTelemetryEnabled`/`onDidChangeTelemetryEnabled`;
  `registerMoreFromLabsView` (empty catalog plus an "All extensions" link, UTM-tagged, current
  extension hidden, Marketplace links in VS Code and Open VSX links in forks). Vitest suite against
  a `vscode` mock with an 80% line-coverage gate. Dependabot now holds back majors of `vitest`,
  `@types/node` and `typescript`. PR: https://github.com/indrasol/vsx-extensions/pull/4
- **Next:** extension-starter template.

## 2026-09-29

- **Done:** pnpm workspace (`extensions/*`, `packages/*`, `templates/*`, `collector`, `dashboard`),
  hardened `.npmrc` (`ignore-scripts`, `engine-strict`, `save-exact`), shared `tsconfig.base.json`,
  ESLint flat config (typescript-eslint strict-type-checked) and Prettier, `.editorconfig`,
  `.vscode/` settings, a smoke `packages/labs-core` with a Vitest test, SHA-pinned `ci.yml`
  (job `ci`: format → lint → typecheck → test (xvfb) → build → package, uploads `.vsix`) and
  Dependabot for npm and GitHub Actions. PR: https://github.com/indrasol/vsx-extensions/pull/1
- **Next:** extension-starter template.

## 2026-09-27

- **Done:** Repository scaffold: CLAUDE.md, README, LICENSE (MIT), SECURITY, CONTRIBUTING, CODEOWNERS,
  `.github` templates, architecture, engineering standards, security practices, development setup,
  ADR-0001…0010, how-we-build and build-notes.
- **Next:** pnpm workspace, tooling baseline and `ci.yml`.
