import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '@indrasol/labs-core';
import * as vscode from 'vscode';
import { normalizeRoot } from '../analysis/cache.js';
import type { AnalysisStore } from '../analysis/store.js';
import { prompts } from '../prompts.js';
import { isAnalysisAllowed, showUntrustedMessage } from '../trust.js';
import {
  AGENT_CONFIGS,
  type AgentTarget,
  ConfigParseError,
  type EntryUpdate,
  entryUpdate,
  mergeServerConfig,
  SERVER_NAME,
  serverEntry,
  updateServerEntry,
} from './mcpConfig.js';
import { McpProvider, type McpServerPaths } from './mcpProvider.js';
import type { AgentNote } from './agentNotes.js';
import { readText, updateAgentNote, writeText } from './writers.js';

/** The rules file each agent reads, where *Connect* adds the notes block with the MCP line. */
export const AGENT_RULES_FILE: Readonly<Record<AgentTarget, AgentNote>> = {
  cursor: '.cursor/rules/churnmap.mdc',
  claude: 'CLAUDE.md',
  vscode: '.github/copilot-instructions.md',
};

export interface ConnectDeps {
  context: vscode.ExtensionContext;
  store: AnalysisStore;
  logger: Logger;
  mcp: McpProvider;
  paths: McpServerPaths;
}

type Choice = AgentTarget | 'show';

/** What *Connect to AI agent…* did (for integration tests). */
export interface ConnectOutcome {
  choice: Choice;
  /** The config file written, when one was. */
  file?: string;
  /** The agent rules file written (checked by default), when one was. */
  rules?: string;
}

/**
 * Offers (checked by default) to write the agent's rules file: the *Export for agents* block plus
 * the line that tells the agent to call Churnmap's MCP tools instead of running git. Returns the
 * file written, if any.
 */
async function offerRules(
  deps: ConnectDeps,
  folder: string,
  target: AgentTarget,
): Promise<string | undefined> {
  const note = AGENT_RULES_FILE[target];
  const exists = (await readText(path.join(folder, ...note.split('/')))) !== undefined;
  const picked = await prompts.pickMany(
    [
      {
        label: `Also write ${note}`,
        description: exists ? 'update' : 'create',
        detail:
          'Tells the agent to use Churnmap’s tools for questions about hotspots and risky files.',
        picked: true,
        note,
      },
    ],
    {
      title: 'Churnmap: Connect to AI agent',
      placeHolder: 'Point your agent at Churnmap’s tools (press Enter to keep the checked file)',
    },
  );
  if (!picked || picked.length === 0) return undefined;
  const file = await updateAgentNote(folder, note, { mcp: true });
  deps.logger.info(`Agent rules written: ${file}`);
  return file;
}

/**
 * The project folder the agent opens (the workspace folder holding the analysed repository), and
 * the repository root when it is not that folder itself (then `--repo` pins it).
 */
async function project(
  store: AnalysisStore,
): Promise<{ folder: string; repo?: string } | undefined> {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const repoRoot = store.get()?.repoRoot;
  if (repoRoot === undefined) {
    const first = folders[0];
    return first === undefined ? undefined : { folder: first };
  }
  const key = normalizeRoot(repoRoot);
  let best: { folder: string; length: number } | undefined;
  for (const folder of folders) {
    const real = normalizeRoot(await fs.realpath(folder).catch(() => folder));
    if ((key === real || key.startsWith(`${real}/`)) && real.length > (best?.length ?? -1)) {
      best = { folder, length: real.length };
    }
  }
  if (!best) return { folder: repoRoot };
  const real = normalizeRoot(await fs.realpath(best.folder).catch(() => best.folder));
  return real === key ? { folder: best.folder } : { folder: best.folder, repo: repoRoot };
}

/**
 * The folders the server may see (`--workspace`, its whole scope): every workspace folder, plus
 * the project folder when it is none of them (a repository opened outside the workspace).
 */
function workspaceFolders(project?: string): string[] {
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  if (project !== undefined && !folders.includes(project)) folders.push(project);
  return folders;
}

/** The snippet *Show config* opens (and the fallback when a file cannot be merged). */
function snippet(
  paths: McpServerPaths,
  where: { folder: string; repo?: string } | undefined,
): string {
  const entry = serverEntry('cursor', {
    ...paths,
    workspaces: workspaceFolders(where?.folder),
    repo: where?.repo,
  });
  return `${JSON.stringify({ mcpServers: { [SERVER_NAME]: entry } }, null, 2)}\n`;
}

async function showSnippet(text: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: 'json', content: text });
  await vscode.window.showTextDocument(doc, { preview: false });
}

/**
 * Churnmap: Connect to AI agent…: writes (or merges) the MCP config for Cursor or Claude Code in
 * this project, lists the server in VS Code (provider API, else `.vscode/mcp.json`), or shows the
 * snippet. Adding the server is the user's trust decision; nothing starts until their agent does.
 */
export async function addToAgent(
  deps: ConnectDeps,
  arg?: unknown,
): Promise<ConnectOutcome | undefined> {
  if (!isAnalysisAllowed()) {
    showUntrustedMessage();
    return undefined;
  }
  const items: { label: string; description: string; choice: Choice }[] = [
    { label: 'Cursor (this project)', description: '.cursor/mcp.json', choice: 'cursor' },
    { label: 'Claude Code (this project)', description: '.mcp.json', choice: 'claude' },
    {
      label: 'VS Code',
      description:
        McpProvider.available() && deps.mcp.registered ? 'no file written' : '.vscode/mcp.json',
      choice: 'vscode',
    },
    { label: 'Show config', description: 'copy it into any MCP client', choice: 'show' },
  ];
  const choice: Choice | undefined =
    typeof arg === 'string' && items.some((i) => i.choice === arg)
      ? (arg as Choice)
      : (
          await prompts.pick(items, {
            title: 'Churnmap: Connect to AI agent',
            placeHolder: 'Which agent should get Churnmap’s hotspot tools (MCP)?',
          })
        )?.choice;
  if (!choice) return undefined;

  const where = await project(deps.store);
  if (choice === 'show' || !where) {
    await showSnippet(snippet(deps.paths, where));
    return { choice: 'show' };
  }
  if (choice === 'vscode' && deps.mcp.registered) {
    await deps.mcp.enable();
    const rules = await offerRules(deps, where.folder, choice);
    void vscode.window.showInformationMessage(
      'Churnmap: listed as an MCP server in VS Code. Start it from “MCP: List Servers”, then ask your agent about hotspots.',
    );
    return { choice, ...(rules === undefined ? {} : { rules }) };
  }

  const config = AGENT_CONFIGS[choice];
  const file = path.join(where.folder, ...config.file.split('/'));
  const entry = serverEntry(choice, {
    ...deps.paths,
    workspaces: workspaceFolders(where.folder),
    repo: where.repo,
  });
  let text: string;
  try {
    text = mergeServerConfig(await readText(file), config.key, entry);
  } catch (err) {
    if (!(err instanceof ConfigParseError)) throw err;
    void vscode.window.showWarningMessage(
      `Churnmap: ${config.file} could not be read as plain JSON (${err.message}), so it was left alone. Add the snippet by hand.`,
    );
    await showSnippet(snippet(deps.paths, where));
    return { choice: 'show' };
  }
  await writeText(file, text);
  deps.logger.info(`MCP config written: ${file}`);
  const rules = await offerRules(deps, where.folder, choice);
  void vscode.window.showInformationMessage(
    `Churnmap: added to ${config.file}${rules === undefined ? '' : ` and ${path.relative(where.folder, rules).split(path.sep).join('/')}`}. Restart or reload your agent to pick it up.`,
  );
  return { choice, file, ...(rules === undefined ? {} : { rules }) };
}

/**
 * Offers to fix Churnmap entries in the workspace's agent configs: after an update they point at
 * an older `dist/mcp-server.js` (the path includes the extension version), and entries written
 * before `--workspace` existed let the server see whatever folder the agent starts it in. One
 * question, one update for both. Reads only; writes on the user's click. Called after activation,
 * never during it.
 */
export async function checkAgentConfigs(deps: ConnectDeps): Promise<string[]> {
  if (!isAnalysisAllowed()) return [];
  const found: { file: string; key: 'mcpServers' | 'servers'; text: string; need: EntryUpdate }[] =
    [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const config of Object.values(AGENT_CONFIGS)) {
      const file = path.join(folder.uri.fsPath, ...config.file.split('/'));
      const text = await readText(file).catch(() => undefined);
      const need = entryUpdate(text, config.key, deps.paths.serverPath);
      if (need && text) found.push({ file, key: config.key, text, need });
    }
  }
  if (found.length === 0) return [];
  const choice = await prompts.info(
    found.some((f) => f.need.stalePath)
      ? 'Churnmap was updated, and your AI agent config still points at the previous version. Update it?'
      : 'Your AI agent’s Churnmap config does not name this workspace, so the agent may see repositories outside it. Update it to this workspace only?',
    'Update',
    'Not now',
  );
  if (choice !== 'Update') return [];
  const workspaces = workspaceFolders();
  for (const f of found) {
    await writeText(
      f.file,
      updateServerEntry(f.text, f.key, { serverPath: deps.paths.serverPath, workspaces }),
    );
  }
  return found.map((f) => f.file);
}
