# Churnmap plugin for Cursor (scaffold)

The Cursor Marketplace plugin for Churnmap: the local MCP server plus a skill that tells the agent
to check hotspots before it refactors, reviews or plans changes. Not shipped in the VSIX.

```
.cursor-plugin/plugin.json          name, description, version, author, repository, license
mcp.json                            starts the server with npx
skills/churnmap-hotspots/SKILL.md   when to call list_hotspots, explain_file, hotspots_in_changes, build
```

## Before submitting (a person does these)

1. **Publish the server to npm as `@indrasol/churnmap-mcp`.** `mcp.json` runs
   `npx -y @indrasol/churnmap-mcp`, which does not exist yet. The package is `dist/mcp-server.js`
   with a `bin` entry (and a `#!/usr/bin/env node` banner added by esbuild), MIT, no
   dependencies (everything is bundled). Publishing needs the Indrasol npm organisation and 2FA.
2. **Check the cache folder.** `--cache-dir ${userHome}/.churnmap` relies on Cursor expanding
   `${userHome}` in `mcp.json`; confirm it on the current Cursor build. Without the VS Code
   extension, the server builds its own cache there the first time the agent calls `build`.
3. **Check the workspace folder.** `--workspace ${workspaceFolder}` limits the server to the
   open project (Cursor may start it in a folder above the project; without the flag the server
   then refuses every call). It relies on Cursor expanding `${workspaceFolder}` in a plugin's
   `mcp.json`; confirm it, and how a multi-root workspace expands, on the current Cursor build.
4. Validate the folder with Cursor's plugin tooling, then submit it to the Cursor Marketplace.

The server itself is documented in `../README.md`.
