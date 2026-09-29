# Development setup

Everything a contributor needs to build and test extensions locally. Publishing is CI-only,
so no registry credentials are needed here.

## Tools

- Node.js LTS (≥ 20; 22 recommended), via nvm or your OS package manager
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

Run a single extension: open the repo in VS Code, pick the extension's launch configuration
in _Run and Debug_, press F5. Install a built VSIX locally with
`code --install-extension extensions/<name>/<name>-<version>.vsix`.

See [`engineering-standards.md`](engineering-standards.md) before writing code and
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the PR workflow.
