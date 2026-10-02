import * as path from 'node:path';
import type { Logger } from '@indrasol/labs-core';
import * as vscode from 'vscode';
import type { AnalysisResult, IgnoredFile } from '../analysis/model.js';
import type { AnalysisStore } from '../analysis/store.js';
import { prompts } from '../prompts.js';
import { isAnalysisAllowed, showUntrustedMessage } from '../trust.js';
import { CONTEXT_DIR } from './agentContext.js';
import { AGENT_NOTES, ignoresContextDir } from './agentNotes.js';
import {
  existingAgentNotes,
  hasContextFiles,
  ignoreContextDir,
  readText,
  updateAgentNote,
  writeContextFiles,
} from './writers.js';

/** workspaceState key: the answer to "add .churnmap/ to .gitignore?" (`yes` | `no`). */
export const GITIGNORE_KEY = 'churnmap.agentContext.gitignore';
export const GITIGNORE_QUESTION =
  'Churnmap: add .churnmap/ to this repository’s .gitignore? Committing it shares the hotspot list with your team’s agents.';
export const GITIGNORE_YES = 'Yes';
export const GITIGNORE_NO = 'No, commit it';
export const GITIGNORE_LATER = 'Ask later';

export interface ExportDeps {
  context: vscode.ExtensionContext;
  store: AnalysisStore;
  logger: Logger;
}

/** What the export wrote (for integration tests). */
export interface ExportOutcome {
  files: { md: string; json: string };
  notes: string[];
}

export function refreshOnBuildSetting(): boolean {
  return (
    vscode.workspace.getConfiguration('churnmap').get<boolean>('agentContext.refreshOnBuild') !==
    false
  );
}

/**
 * Churnmap: Export for agents. Writes `.churnmap/HOTSPOTS.md` and `.churnmap/hotspots.json` under
 * the analysed repository root, then offers to point the agent-notes files at them.
 */
export async function exportForAgents(deps: ExportDeps): Promise<ExportOutcome | undefined> {
  if (!isAnalysisAllowed()) {
    showUntrustedMessage();
    return undefined;
  }
  const result = deps.store.get();
  if (!result) {
    void vscode.window.showInformationMessage('Churnmap: build the city first.');
    return undefined;
  }
  const root = result.repoRoot;
  const files = await writeContextFiles(result, deps.store.ignored());
  deps.logger.info(`Agent context written to ${path.join(root, CONTEXT_DIR)}`);

  const existing = await existingAgentNotes(root, AGENT_NOTES);
  const picked = await prompts.pickMany(
    AGENT_NOTES.map((note) => ({
      label: note,
      description: existing.has(note) ? 'update' : 'create',
      picked: existing.has(note),
      note,
    })),
    {
      title: 'Churnmap: Export for agents',
      placeHolder: 'Point these agent notes at .churnmap/HOTSPOTS.md (a three-line block)',
    },
  );
  const notes: string[] = [];
  for (const item of picked ?? []) {
    notes.push(await updateAgentNote(root, item.note));
  }
  await askAboutGitignore(deps.context, root);
  void vscode.window.showInformationMessage(
    `Churnmap: wrote .churnmap/HOTSPOTS.md and hotspots.json${notes.length > 0 ? ` and updated ${notes.map((n) => path.relative(root, n)).join(', ')}` : ''}. Builds keep them fresh.`,
  );
  return { files, notes };
}

/** Asks once per workspace whether `.churnmap/` should be git-ignored ("Ask later" asks again). */
async function askAboutGitignore(context: vscode.ExtensionContext, root: string): Promise<void> {
  const answered: unknown = context.workspaceState.get(GITIGNORE_KEY);
  if (answered === 'yes' || answered === 'no') return;
  if (ignoresContextDir((await readText(path.join(root, '.gitignore'))) ?? '')) return;
  const choice = await prompts.info(
    GITIGNORE_QUESTION,
    GITIGNORE_YES,
    GITIGNORE_NO,
    GITIGNORE_LATER,
  );
  if (choice === GITIGNORE_YES) {
    await ignoreContextDir(root);
    await context.workspaceState.update(GITIGNORE_KEY, 'yes');
  } else if (choice === GITIGNORE_NO) {
    await context.workspaceState.update(GITIGNORE_KEY, 'no');
  }
}

/**
 * After a build: when the repository already has `.churnmap/hotspots.json`, rewrite both context
 * files silently. Never in an untrusted workspace; off with `churnmap.agentContext.refreshOnBuild`.
 */
export async function refreshAgentContext(
  result: AnalysisResult,
  ignored: readonly IgnoredFile[],
): Promise<boolean> {
  if (!isAnalysisAllowed() || !refreshOnBuildSetting()) return false;
  if (!(await hasContextFiles(result.repoRoot))) return false;
  await writeContextFiles(result, ignored);
  return true;
}
