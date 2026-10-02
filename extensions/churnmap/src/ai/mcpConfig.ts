/**
 * The agent configuration files that start Churnmap's MCP server: `.cursor/mcp.json` (Cursor),
 * `.mcp.json` (Claude Code) and `.vscode/mcp.json` (VS Code without the provider API). Pure: parse,
 * set one key, keep everything else. Paths in the entry are absolute and change with every
 * extension update, and entries written before 0.1.x name no workspace (the server then falls back
 * to its working directory), so `entryUpdate` finds entries to fix and `updateServerEntry` fixes
 * both in one go.
 */

export const SERVER_NAME = 'churnmap';

export type AgentTarget = 'cursor' | 'claude' | 'vscode';

export interface AgentConfigFile {
  target: AgentTarget;
  /** Relative to the project folder, forward slashes. */
  file: string;
  /** The object that holds the servers. */
  key: 'mcpServers' | 'servers';
}

export const AGENT_CONFIGS: Readonly<Record<AgentTarget, AgentConfigFile>> = {
  cursor: { target: 'cursor', file: '.cursor/mcp.json', key: 'mcpServers' },
  claude: { target: 'claude', file: '.mcp.json', key: 'mcpServers' },
  vscode: { target: 'vscode', file: '.vscode/mcp.json', key: 'servers' },
};

export interface ServerEntry {
  type?: 'stdio';
  command: string;
  args: string[];
}

/** The server's flag for a folder it may see; one per workspace folder. */
export const WORKSPACE_FLAG = '--workspace';

/** `--workspace <folder>` for each folder. */
export function workspaceArgs(workspaces: readonly string[]): string[] {
  return workspaces.flatMap((w) => [WORKSPACE_FLAG, w]);
}

/**
 * `node <server> --cache-dir <dir> [--workspace <folder>]... [--repo <root>]`; VS Code's file also
 * names the transport. The workspace folders are the server's whole scope: an agent that starts it
 * in a parent folder still sees only these.
 */
export function serverEntry(
  target: AgentTarget,
  opts: {
    serverPath: string;
    cacheDir: string;
    workspaces?: readonly string[] | undefined;
    repo?: string | undefined;
  },
): ServerEntry {
  const args = [
    opts.serverPath,
    '--cache-dir',
    opts.cacheDir,
    ...workspaceArgs(opts.workspaces ?? []),
  ];
  if (opts.repo !== undefined) args.push('--repo', opts.repo);
  return target === 'vscode' ? { type: 'stdio', command: 'node', args } : { command: 'node', args };
}

export class ConfigParseError extends Error {
  override readonly name = 'ConfigParseError';
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * `text` (undefined for a new file) with `<key>.churnmap` set to `entry`, every other key kept,
 * 2-space indented. Throws `ConfigParseError` when the file is not a JSON object (comments
 * included), so a file Churnmap cannot read safely is never overwritten.
 */
export function mergeServerConfig(
  text: string | undefined,
  key: AgentConfigFile['key'],
  entry: ServerEntry,
): string {
  let root: Record<string, unknown> = {};
  if (text !== undefined && text.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ConfigParseError(err instanceof Error ? err.message : String(err));
    }
    if (!isRecord(parsed)) throw new ConfigParseError('the file is not a JSON object');
    root = parsed;
  }
  const existing = root[key];
  if (existing !== undefined && !isRecord(existing)) {
    throw new ConfigParseError(`"${key}" is not an object`);
  }
  root[key] = { ...(existing ?? {}), [SERVER_NAME]: entry };
  return `${JSON.stringify(root, null, 2)}\n`;
}

/** The churnmap entry's arguments, when it has them. */
function configuredArgs(
  text: string | undefined,
  key: AgentConfigFile['key'],
): unknown[] | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return undefined;
    const servers = parsed[key];
    const entry = isRecord(servers) ? servers[SERVER_NAME] : undefined;
    const args = isRecord(entry) ? entry.args : undefined;
    return Array.isArray(args) ? (args as unknown[]) : undefined;
  } catch {
    return undefined;
  }
}

/** The first argument of the churnmap entry (the server script), when there is one. */
export function configuredServerPath(
  text: string | undefined,
  key: AgentConfigFile['key'],
): string | undefined {
  const first = configuredArgs(text, key)?.[0];
  return typeof first === 'string' ? first : undefined;
}

/** A server path this extension wrote (any version's `dist/mcp-server.js`). */
function isOurServer(serverPath: string): boolean {
  return /[\\/]dist[\\/]mcp-server\.js$/.test(serverPath);
}

/** What an existing Churnmap entry needs: the current server path, a workspace, or both. */
export interface EntryUpdate {
  /** It points at an older version's server. */
  stalePath: boolean;
  /** It names no `--workspace`, so the server's scope depends on where the agent starts it. */
  noWorkspace: boolean;
}

/**
 * What the churnmap entry in `text` needs to be current; undefined when it is missing, foreign
 * (a server this extension did not write, such as the Cursor plugin's npx one) or up to date.
 */
export function entryUpdate(
  text: string | undefined,
  key: AgentConfigFile['key'],
  currentServerPath: string,
): EntryUpdate | undefined {
  const args = configuredArgs(text, key);
  const configured = configuredServerPath(text, key);
  if (args === undefined || configured === undefined || !isOurServer(configured)) return undefined;
  const update = {
    stalePath: configured !== currentServerPath,
    noWorkspace: !args.includes(WORKSPACE_FLAG),
  };
  return update.stalePath || update.noWorkspace ? update : undefined;
}

/**
 * The entry with the current server path and, when it names no workspace, `--workspace` for each
 * of `workspaces` (after `--cache-dir`); every other argument kept as it was.
 */
export function updateServerEntry(
  text: string,
  key: AgentConfigFile['key'],
  current: { serverPath: string; workspaces: readonly string[] },
): string {
  const parsed = JSON.parse(text) as Record<string, Record<string, ServerEntry>>;
  const entry = parsed[key]?.[SERVER_NAME];
  if (!entry || !Array.isArray(entry.args)) return text;
  const rest = entry.args.slice(1);
  if (!rest.includes(WORKSPACE_FLAG)) {
    const cache = rest.indexOf('--cache-dir');
    const at = cache === -1 ? 0 : Math.min(cache + 2, rest.length);
    rest.splice(at, 0, ...workspaceArgs(current.workspaces));
  }
  return mergeServerConfig(text, key, { ...entry, args: [current.serverPath, ...rest] });
}
