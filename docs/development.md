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
every Labs extension is wired: esbuild bundle, `@indrasol/labs-core` logger and the
"More from Indrasol Labs" view, a walkthrough, Vitest unit tests and integration tests.

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
   `keywords`, `repository.directory` and `homepage`; remove `"preview": true` when it is ready.
   Keep `version` at `0.0.0` until the first release.
3. Rename the `extensionStarter` prefix everywhere (`package.json`, `src/extension.ts` and the
   integration test) to the extension's own camelCase prefix: the command, walkthrough, view
   container and More-from-Labs view (`<camelName>.moreFromLabs`) ids all use it. View and command
   ids are global in VS Code, so two installed Labs extensions must not share them.
4. Replace `media/icon.png` with the extension's icon, add `media/demo.gif`, and fill in every
   placeholder in `README.md` and `CHANGELOG.md`.
5. `pnpm install`, then `pnpm --filter <kebab-name> test` and `pnpm --filter <kebab-name> package`.

## Releasing

Releases happen only in CI through `.github/workflows/release.yml`; nobody publishes from a laptop.

1. Bump `version` in `extensions/<name>/package.json`, add a matching `## [X.Y.Z]` section to its
   `CHANGELOG.md` (it becomes the release notes) and merge that PR.
2. From an up-to-date `main`, tag and push:

   ```bash
   git tag <name>@vX.Y.Z && git push origin <name>@vX.Y.Z
   ```

   The `protect-release-tags` ruleset lets only repo admins create these tags.

3. The workflow refuses anything under `templates/`, a tag that does not match `package.json`
   `version`, or a `publisher` other than `Indrasol`. It then lints, type-checks, tests, packages the
   VSIX once and checks the ship list, SBOM and SHA-256.
4. The `publish` job waits for a required reviewer to approve the `marketplace-publish`
   environment. After approval the same VSIX goes to Open VSX and the VS Code Marketplace
   (`--skip-duplicate`, so re-runs are safe), and a GitHub Release is created with the VSIX, its
   `.sha256` and the CycloneDX SBOM.

Manual runs (_Actions → Release → Run workflow_, or `gh workflow run`), on `main`:

- **Dry run:** `gh workflow run release.yml -f extension=<name> -f mode=dry-run` runs every step up
  to and including packaging, then stops. Nothing is published and no approval is needed; the
  VSIX, SHA-256 and SBOM are uploaded as the `release-<name>-<version>` artifact.
- **Profile id (one-time setup, ADR-0004):** `gh workflow run release.yml -f extension=<any> -f mode=profile-id`
  signs in as the publishing managed identity (after environment approval) and prints its Azure
  DevOps profile id, which is added as a member of the `Indrasol` Marketplace publisher.

`extensions/labs-pipeline-smoke` is a disposable extension (ADR-0008) used for the first real
publish; it is unpublished afterwards.

See [`engineering-standards.md`](engineering-standards.md) before writing code and
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the PR workflow.
