import * as path from 'node:path';

export const USAGE = `Churnmap MCP server (stdio): code hotspots from git history for your AI agent.

Usage: node mcp-server.js --cache-dir <dir> [--workspace <folder>]... [--repo <root>] [--git <path>]

  --cache-dir <dir>     Churnmap's storage folder (absolute). The VS Code extension passes its
                        own, so the server and the editor share one analysis cache.
  --workspace <folder>  A workspace folder the agent may see (absolute; repeat it for each folder
                        of a multi-root workspace). The tools only see repositories inside these
                        folders. Without it: --repo's repository, else the directory the agent
                        starts the server in when that is inside a git repository; otherwise
                        every tool refuses.
  --repo <root>         The repository to use when a tool call names none (default: the one the
                        Churnmap extension analysed last for the workspace, else the only code
                        repository in it). With --workspace it must be inside one of them.
  --git <path>          The git executable (default: git on PATH).
  --help                Show this help.

Tools: list_hotspots, explain_file, hotspots_in_changes, get_prompt, list_repositories, build.
Nothing is sent over the network. The server reads git history and writes only to the cache
folder and to .churnmap/ in a repository that already has it.`;

export type ParsedArgs =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'run'; cacheDir: string; workspaces?: string[]; repo?: string; git?: string };

/** Parses the server's command line (`argv` without node and the script). */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const values: Partial<Record<'cache-dir' | 'repo' | 'git', string>> = {};
  const workspaces: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    const name = arg?.startsWith('--') ? arg.slice(2) : undefined;
    if (name !== 'cache-dir' && name !== 'workspace' && name !== 'repo' && name !== 'git') {
      return { kind: 'error', message: `Unknown argument: ${String(arg)}` };
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return { kind: 'error', message: `--${name} needs a value` };
    }
    // The only repeatable flag: one per workspace folder.
    if (name === 'workspace') workspaces.push(value);
    else values[name] = value;
    i += 1;
  }
  const cacheDir = values['cache-dir'];
  if (cacheDir === undefined) return { kind: 'error', message: '--cache-dir is required' };
  if (!path.isAbsolute(cacheDir)) {
    return { kind: 'error', message: '--cache-dir must be an absolute path' };
  }
  for (const key of ['repo', 'git'] as const) {
    const value = values[key];
    if (value !== undefined && !path.isAbsolute(value)) {
      return { kind: 'error', message: `--${key} must be an absolute path` };
    }
  }
  if (workspaces.some((w) => !path.isAbsolute(w))) {
    return { kind: 'error', message: '--workspace must be an absolute path' };
  }
  return {
    kind: 'run',
    cacheDir,
    ...(workspaces.length === 0 ? {} : { workspaces }),
    ...(values.repo === undefined ? {} : { repo: values.repo }),
    ...(values.git === undefined ? {} : { git: values.git }),
  };
}
