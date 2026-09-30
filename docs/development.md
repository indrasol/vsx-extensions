# Development setup

Everything a contributor needs to build and test extensions locally. Publishing is CI-only,
so no registry credentials are needed here.

## Tools

- Node.js LTS ≥ 22.12, via nvm or your OS package manager
- pnpm via corepack: `corepack enable`
- Git ≥ 2.40, VS Code (latest), and Cursor for fork testing
- Optional, for local packaging checks: `npm i -g @vscode/vsce ovsx`

Check your setup:

```bash
node -v && pnpm -v && git --version && code --version | head -1
```

## Common commands

```bash
pnpm install --frozen-lockfile   # install (postinstall scripts are disabled by design)
pnpm lint && pnpm typecheck      # static checks
pnpm test                        # unit + integration tests (on Linux CI: xvfb-run -a pnpm test)
pnpm build                       # esbuild bundles
pnpm package                     # vsce package --no-dependencies → .vsix per extension
```

Run a single extension: open its folder (`extensions/<name>/`) in VS Code and press F5
(_Run Extension_). Install a built VSIX locally with
`code --install-extension extensions/<name>/dist/<name>-<version>.vsix`.

## Run the template

`templates/extension-starter/` is a complete extension that is never published. It shows how
every Labs extension is wired: esbuild bundle, `@indrasol/labs-core` logger, no-op telemetry and
the "More from Indrasol Labs" view, a walkthrough, Vitest unit tests and integration tests.

- **Debug it:** open `templates/extension-starter/` in VS Code and press F5 (_Run Extension_
  builds first). Run **Labs Starter: Hello** from the Command Palette; the activation time is
  logged to the _Labs Starter_ output channel.
- **Test it:** `pnpm --filter extension-starter test` runs the Vitest unit tests with coverage,
  then the integration tests inside VS Code 1.96.0 (the `engines.vscode` minimum) and current
  stable. Add `--label min` or `--label stable` to `pnpm --filter extension-starter test:integration`
  to run one. VS Code downloads are cached in `.vscode-test/` (gitignored, cached in CI).
- **Package it:** `pnpm --filter extension-starter package` writes
  `templates/extension-starter/dist/extension-starter-0.0.0.vsix`. Check what ships with
  `pnpm --filter extension-starter exec vsce ls --no-dependencies` (the flag is needed under pnpm).

### Start a new extension from it

Follow [`engineering-standards.md`](engineering-standards.md#starting-a-new-extension):

1. `cp -R templates/extension-starter extensions/<kebab-name>` (then delete any copied
   `node_modules/`, `dist/`, `out/`, `coverage/` and `.vscode-test/`).
2. In `package.json`: set `name`, `displayName`, `description` (ends with "by Indrasol Labs"),
   `keywords`, `repository.directory` and `homepage`; remove `"preview": true` when it is ready;
   rename the `extensionStarter.*` command, walkthrough and the view container ids to the new
   extension's own prefix. Keep `version` at `0.0.0` until the first release.
3. Give each extension its own view id for the More-from-Labs view (e.g. `<camelName>.moreFromLabs`):
   view and command ids are global in VS Code, so two installed Labs extensions must not share them.
   Update `src/extension.ts` and the integration test to match.
4. Replace `media/icon.png` with the extension's icon, add `media/demo.gif`, and fill in every
   placeholder in `README.md`, `CHANGELOG.md` and `telemetry.json`.
5. `pnpm install`, then `pnpm --filter <kebab-name> test` and `pnpm --filter <kebab-name> package`.

See [`engineering-standards.md`](engineering-standards.md) before writing code and
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the PR workflow.
