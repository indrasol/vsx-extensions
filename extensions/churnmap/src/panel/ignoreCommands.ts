import * as vscode from 'vscode';
import type { AnalysisStore } from '../analysis/store.js';
import { isRepoRelativePath } from '../city/protocol.js';
import { prompts } from '../prompts.js';
import { argPath, wholeScore } from './hotspotTree.js';
import { daysLeft, IGNORE_DAYS, type IgnoreStore, reasonText, validateReason } from './ignore.js';

const UNDO = 'Undo';

/**
 * Churnmap: Ignore hotspot…. From the panel's inline action (with the item) or the palette (a
 * quick pick of the current top 20). Asks why, ignores the file for 90 days and offers Undo.
 */
export async function ignoreHotspot(
  store: AnalysisStore,
  ignores: IgnoreStore,
  arg: unknown,
): Promise<boolean> {
  let path = argPath(arg);
  if (path === undefined) {
    const top = store.get()?.top ?? [];
    if (top.length === 0) {
      void vscode.window.showInformationMessage('Churnmap: build the city first.');
      return false;
    }
    const picked = await prompts.pick(
      top.map((h) => ({
        label: h.file.path,
        description: `#${String(h.rank)} · ${wholeScore(h.file.score)}`,
        detail: h.reasons.map((r) => r.text).join(' · '),
        path: h.file.path,
      })),
      { title: 'Churnmap: ignore a hotspot', placeHolder: 'Which hotspot is fine for now?' },
    );
    path = picked?.path;
  }
  if (path === undefined || !isRepoRelativePath(path)) return false;

  const reason = await prompts.inputBox({
    title: `Ignore ${path} for ${String(IGNORE_DAYS)} days`,
    prompt: 'Why is this fine for now? (shown when you un-ignore)',
    placeHolder: 'e.g. scheduled rewrite in Q4',
    validateInput: validateReason,
  });
  if (reason === undefined) return false; // cancelled

  const ignored = path;
  await ignores.add(ignored, reason);
  // Not awaited: the toast stays until dismissed, and the command is done.
  void prompts
    .info(`Ignored ${ignored} for ${String(IGNORE_DAYS)} days.`, UNDO)
    .then(async (choice) => {
      if (choice === UNDO) await ignores.remove(ignored);
    });
  return true;
}

/**
 * Churnmap: Un-ignore hotspot…. With an item from the "Ignored" node, un-ignores it; otherwise a
 * multi-select list of ignored files with the days left and the reason.
 */
export async function unignore(ignores: IgnoreStore, arg: unknown): Promise<number> {
  const path = argPath(arg);
  if (path !== undefined) return (await ignores.remove(path)) ? 1 : 0;
  const entries = ignores.list();
  if (entries.length === 0) {
    void prompts.info('Nothing is ignored.');
    return 0;
  }
  const now = Date.now();
  const picked = await prompts.pickMany(
    entries.map((e) => ({
      label: e.path,
      description: `${String(daysLeft(e, now))} d left`,
      detail: reasonText(e),
      path: e.path,
    })),
    { title: 'Churnmap: un-ignore hotspots', placeHolder: 'Select the files to rank again' },
  );
  let removed = 0;
  for (const item of picked ?? []) {
    if (await ignores.remove(item.path)) removed += 1;
  }
  return removed;
}
