import { basename } from 'node:path';
import * as vscode from 'vscode';
import { isPostcardDetail, type PostcardDetail } from '../city/protocol.js';
import { COMMANDS } from '../commands.js';
import { type CityDeps, CityPanel } from '../panel/CityPanel.js';
import { localDate } from '../panel/markdown.js';
import { prompts } from '../prompts.js';
import { exportPostcardFlow, type PostcardOutcome, renderPostcard } from './flow.js';
import { formatSize, postcardFileName, postcardTop } from './labels.js';

const DETAILS: { detail: PostcardDetail; label: string; detailText: string }[] = [
  {
    detail: 'paths',
    label: 'Include file paths',
    detailText: 'The top three hotspots by path, e.g. src/billing/invoice.ts',
  },
  {
    detail: 'districts',
    label: 'Districts only',
    detailText: 'Only the top-level folder of each, e.g. src',
  },
  { detail: 'none', label: 'No names', detailText: 'Ranks and scores only' },
];

function configuredDetail(): PostcardDetail {
  const value: unknown = vscode.workspace.getConfiguration('churnmap').get('postcard.detail');
  return isPostcardDetail(value) ? value : 'paths';
}

/**
 * Churnmap: Export postcard. Renders a 1600×900 PNG in the city webview (ADR-0011: exports are
 * made in the webview and written by the host only after a save dialog).
 */
export function exportPostcard(deps: CityDeps): Promise<PostcardOutcome> {
  const { store } = deps;
  return exportPostcardFlow<vscode.Uri>({
    hasResult: () => store.get() !== undefined,
    offerBuild: () => {
      void vscode.window
        .showInformationMessage('Churnmap: build the city first.', 'Build city')
        .then((choice) => {
          if (choice) void vscode.commands.executeCommand(COMMANDS.build);
        });
    },
    currentDetail: configuredDetail,
    pickDetail: async (current) => {
      const items = DETAILS.map((d) => ({
        label: d.label,
        description: d.detail === current ? 'last used' : '',
        detail: d.detailText,
        value: d.detail,
      }));
      const picked = await prompts.pick(items, {
        title: 'Churnmap: export postcard',
        placeHolder: 'How much of the repository may the image show?',
        active: items.find((i) => i.value === current),
      });
      return picked?.value;
    },
    rememberDetail: async (detail) => {
      if (detail === configuredDetail()) return;
      const target = vscode.workspace.workspaceFolders?.length
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await vscode.workspace.getConfiguration('churnmap').update('postcard.detail', detail, target);
    },
    render: (detail) => {
      const result = store.get();
      if (!result) return Promise.resolve({ ok: false, error: 'no analysis' });
      return renderPostcard(CityPanel.show(deps), {
        type: 'postcard',
        detail,
        repoName: basename(result.repoRoot).slice(0, 200),
        window: result.window,
        top: postcardTop(result.top, detail),
      });
    },
    chooseTarget: async () => {
      const result = store.get();
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const name = postcardFileName(basename(result?.repoRoot ?? 'repo'), localDate(new Date()));
      return prompts.saveDialog({
        title: 'Save Churnmap postcard',
        ...(folder ? { defaultUri: vscode.Uri.joinPath(folder, name) } : {}),
        filters: { PNG: ['png'] },
        saveLabel: 'Save postcard',
      });
    },
    save: async (uri, png) => {
      await vscode.workspace.fs.writeFile(uri, png);
    },
    saved: (uri, bytes) => {
      void prompts
        .info(`Postcard saved (${formatSize(bytes)}).`, 'Open', 'Reveal')
        .then((choice) => {
          if (choice === 'Open') void vscode.env.openExternal(uri);
          if (choice === 'Reveal') void vscode.commands.executeCommand('revealFileInOS', uri);
        });
    },
    failed: (message) => {
      deps.logger.warn(message);
      void vscode.window.showErrorMessage(message);
    },
  });
}
