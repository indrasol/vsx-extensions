import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { TestApi } from '../../src/extension.js';

/**
 * Resolves when the webview reports `path` as hovered. Other `hover` messages are skipped: the
 * real mouse pointer may rest over the test window and report whatever building is under it.
 */
export async function hoverOf(testApi: TestApi, path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const message = await testApi.__city.nextMessage('hover', Math.max(1, deadline - Date.now()));
    if (message.type === 'hover' && message.path === path) return;
  }
}

/**
 * Starts `dist/mcp-server.js` over stdio the way an agent does, on VS Code's own runtime
 * (`ELECTRON_RUN_AS_NODE`), and connects the MCP SDK client to it. With `repo` undefined the
 * server gets no `--repo` and resolves repositories from `cwd`, as when an agent starts it in a
 * project folder.
 */
export async function mcpClient(
  serverPath: string,
  cacheDir: string,
  repo: string | undefined,
  cwd?: string,
): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath, '--cache-dir', cacheDir, ...(repo === undefined ? [] : ['--repo', repo])],
    env: { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '' },
    ...(cwd === undefined ? {} : { cwd }),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'churnmap-integration', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

/**
 * Calls a tool and returns the "Scope: …" line every answer starts with, the other text parts and
 * the JSON of the last one (when it is JSON).
 */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{
  isError: boolean;
  scope: string | undefined;
  texts: string[];
  data: Record<string, unknown> | undefined;
}> {
  const result = await client.callTool({ name, arguments: args });
  const all = ((result.content ?? []) as { text?: string }[]).map((c) => c.text ?? '');
  const scope = all[0]?.startsWith('Scope: ') ? all[0] : undefined;
  const texts = scope === undefined ? all : all.slice(1);
  let data: Record<string, unknown> | undefined;
  try {
    data = JSON.parse(texts.at(-1) ?? '') as Record<string, unknown>;
  } catch {
    data = undefined;
  }
  return { isError: result.isError === true, scope, texts, data };
}
