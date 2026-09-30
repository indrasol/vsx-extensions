import * as vscode from 'vscode';
import { ALL_EXTENSIONS_URL, CATALOG, type Catalog } from './catalog.js';

export interface MoreFromLabsOptions {
  /** The view id declared under `contributes.views` in the extension manifest. */
  viewId: string;
  /** This extension's id; its own entry is hidden. */
  currentExtensionId: string;
  /** `utm_campaign` value: the extension's kebab name (ADR-0008). */
  campaign: string;
  /** Overrides the built-in catalog (tests). */
  catalog?: Catalog;
  /**
   * Extension-specific links shown above the catalog, in order. URLs are used as given (no UTM
   * parameters are added), so the extension owns their exact shape.
   */
  links?: readonly MoreFromLabsLink[];
}

export interface MoreFromLabsLink {
  label: string;
  description?: string;
  url: string;
}

/** Appends `utm_source=vscode&utm_campaign=<campaign>` to a URL. */
export function withUtm(url: string, campaign: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('utm_source', 'vscode');
  parsed.searchParams.set('utm_campaign', campaign);
  return parsed.toString();
}

/** VS Code proper installs from the Marketplace; forks (Cursor, VSCodium, …) from Open VSX. */
function usesMarketplace(): boolean {
  return vscode.env.uriScheme === 'vscode' || vscode.env.uriScheme === 'vscode-insiders';
}

class LabsItem extends vscode.TreeItem {
  constructor(label: string, description: string, url: string, icon: string, commandId: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    const summary = description ? `${label}, ${description}` : label;
    this.tooltip = description ? `${label}: ${description}\n${url}` : `${label}\n${url}`;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.accessibilityInformation = { label: `${summary}. Opens in browser.` };
    this.command = { command: commandId, title: `Open ${label}`, arguments: [url] };
  }
}

export function buildItems(opts: MoreFromLabsOptions): LabsItem[] {
  const commandId = `${opts.viewId}.open`;
  const current = opts.currentExtensionId.toLowerCase();
  const marketplace = usesMarketplace();

  const links = (opts.links ?? []).map(
    (link) =>
      new LabsItem(link.label, link.description ?? '', link.url, 'link-external', commandId),
  );
  const items = (opts.catalog ?? CATALOG)
    .filter((entry) => entry.id.toLowerCase() !== current)
    .map(
      (entry) =>
        new LabsItem(
          entry.displayName,
          entry.tagline,
          withUtm(marketplace ? entry.marketplaceUrl : entry.openVsxUrl, opts.campaign),
          'extensions',
          commandId,
        ),
    );
  items.push(
    new LabsItem(
      'All extensions',
      'indrasol.com/labs',
      withUtm(ALL_EXTENSIONS_URL, opts.campaign),
      'link-external',
      commandId,
    ),
  );
  return [...links, ...items];
}

/** Registers the "More from Indrasol Labs" tree view. Disposed with the extension context. */
export function registerMoreFromLabsView(
  context: vscode.ExtensionContext,
  opts: MoreFromLabsOptions,
): vscode.Disposable {
  const items = buildItems(opts);
  const provider: vscode.TreeDataProvider<LabsItem> = {
    getTreeItem: (item) => item,
    getChildren: (item) => (item ? [] : items),
  };

  const disposable = vscode.Disposable.from(
    vscode.commands.registerCommand(`${opts.viewId}.open`, (url: string) =>
      vscode.env.openExternal(vscode.Uri.parse(url)),
    ),
    vscode.window.createTreeView(opts.viewId, { treeDataProvider: provider }),
  );
  context.subscriptions.push(disposable);
  return disposable;
}
