import { basename } from 'node:path';
import type { Logger } from '@indrasol/labs-core';
import * as vscode from 'vscode';
import type { AnalysisResult, Hotspot } from '../analysis/model.js';
import type { AnalysisStore } from '../analysis/store.js';
import { argPath, wholeScore } from '../panel/hotspotTree.js';
import { prompts } from '../prompts.js';
import {
  BRIEF_TEMPLATES,
  type BriefFile,
  briefFileFromHotspot,
  briefFileFromScore,
  type BriefTemplate,
  buildBrief,
  isBriefTemplate,
  TEMPLATES,
} from './brief.js';
import { chatTarget } from './chat.js';

/** globalState key: the template the user picked last. */
export const TEMPLATE_KEY = 'churnmap.createAIPrompt.template';

export const COPY = 'Copy prompt';
export const OPEN_IN_CHAT = 'Send to chat';
export const DONE = 'Done';
export const BRIEF_READY =
  'Churnmap: here is your AI prompt. Nothing has been sent; copy it into your AI agent (Cursor, Copilot, Claude Code…) when it looks right.';

export interface PromptDeps {
  context: vscode.ExtensionContext;
  store: AnalysisStore;
  logger: Logger;
}

/** What `createAIPrompt` produced (for integration tests): the prompt, and what the user chose. */
export interface PromptOutcome {
  brief: string;
  template: BriefTemplate;
  action: string | undefined;
}

function briefFile(
  store: AnalysisStore,
  result: AnalysisResult,
  path: string,
): BriefFile | undefined {
  const subjects = store.recentCommits(path);
  const hotspot = result.top.find((h) => h.file.path === path);
  if (hotspot) return briefFileFromHotspot(hotspot, result.window, subjects);
  const file = result.files.find((f) => f.path === path);
  return file ? briefFileFromScore(file, result.window, subjects) : undefined;
}

async function pickHotspot(result: AnalysisResult): Promise<string | undefined> {
  const picked = await prompts.pick(
    result.top.slice(0, 20).map((h) => ({
      label: h.file.path,
      description: `#${String(h.rank)} · score ${wholeScore(h.file.score)}`,
      detail: h.reasons[0]?.text ?? '',
      path: h.file.path,
    })),
    {
      title: 'Churnmap: Create AI prompt',
      placeHolder: 'Which hotspot should the prompt be about?',
    },
  );
  return picked?.path;
}

async function pickTemplate(context: vscode.ExtensionContext): Promise<BriefTemplate | undefined> {
  const last: unknown = context.globalState.get(TEMPLATE_KEY);
  const items = BRIEF_TEMPLATES.map((template) => ({
    label: TEMPLATES[template].title,
    description: TEMPLATES[template].description,
    template,
  }));
  const picked = await prompts.pick(items, {
    title: 'Churnmap: Create AI prompt',
    placeHolder: 'What should the AI help with?',
    active: items.find((i) => i.template === last),
  });
  if (picked) await context.globalState.update(TEMPLATE_KEY, picked.template);
  return picked?.template;
}

/**
 * Churnmap: Create AI Prompt…: a ready-to-paste prompt about a hotspot for the user's own AI agent
 * (Churnmap answers nothing itself). The path comes from the card, the rail, a tree row or the
 * palette (a quick pick of the top 20). The prompt opens in an untitled Markdown editor (its tab
 * reads "AI prompt · <file>", the first line) so the user
 * sees exactly what would leave the editor; nothing is sent anywhere by Churnmap.
 */
export async function createAIPrompt(
  deps: PromptDeps,
  arg?: unknown,
  templateArg?: unknown,
): Promise<PromptOutcome | undefined> {
  const result = deps.store.get();
  if (!result) {
    void vscode.window.showInformationMessage('Churnmap: build the city first.');
    return undefined;
  }
  const path = argPath(arg) ?? (await pickHotspot(result));
  if (path === undefined) return undefined;
  const file = briefFile(deps.store, result, path);
  if (!file) {
    void vscode.window.showWarningMessage(`Churnmap: ${path} is not in the analysis.`);
    return undefined;
  }
  const template = isBriefTemplate(templateArg) ? templateArg : await pickTemplate(deps.context);
  if (!template) return undefined;
  const brief = buildBrief(
    { repoName: basename(result.repoRoot), window: result.window, files: [file] },
    template,
  );
  return { brief, template, action: await showBrief(deps, brief) };
}

/** "Create AI prompt to review these changes": one `review-changes` prompt for the changed hotspots. */
export async function createAIPromptForChanges(
  deps: PromptDeps,
  hits: readonly Hotspot[],
): Promise<PromptOutcome | undefined> {
  const result = deps.store.get();
  if (!result || hits.length === 0) return undefined;
  const files = hits.map((h) =>
    briefFileFromHotspot(h, result.window, deps.store.recentCommits(h.file.path, 5)),
  );
  const brief = buildBrief(
    { repoName: basename(result.repoRoot), window: result.window, files },
    'review-changes',
  );
  return { brief, template: 'review-changes', action: await showBrief(deps, brief) };
}

/**
 * Opens the prompt in an untitled Markdown editor, then offers Copy prompt, Send to chat (only when
 * a chat that takes text exists) and Done. Whatever the editor holds when a button is pressed is what is
 * copied, so the user's own edits are kept. Never throws: a failing chat falls back to Copy.
 */
async function showBrief(deps: PromptDeps, brief: string): Promise<string | undefined> {
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: brief });
  await vscode.window.showTextDocument(doc, { preview: false });
  let chat;
  try {
    chat = chatTarget(vscode.env.appName, await vscode.commands.getCommands(true));
  } catch {
    chat = undefined;
  }
  const choice = await prompts.info(
    BRIEF_READY,
    ...(chat ? [COPY, OPEN_IN_CHAT, DONE] : [COPY, DONE]),
  );
  const text = doc.isClosed ? brief : doc.getText();
  const copy = async (): Promise<void> => {
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage(
      'Churnmap: prompt copied. Paste it into your AI agent.',
    );
  };
  if (choice === COPY) {
    await copy();
  } else if (choice === OPEN_IN_CHAT && chat) {
    try {
      await vscode.commands.executeCommand(chat.command, chat.argument(text));
    } catch (err) {
      deps.logger.warn(
        `Send to chat failed (${err instanceof Error ? err.message : String(err)}); copied instead.`,
      );
      await copy();
    }
  }
  return choice;
}
