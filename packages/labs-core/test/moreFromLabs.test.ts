import { beforeEach, describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { CATALOG, type Catalog } from '../src/catalog.js';
import { buildItems, registerMoreFromLabsView, withUtm } from '../src/moreFromLabs.js';
import { asContext } from './helpers.js';
import { createContext, env, mock } from './vscode.mock.js';

const catalog: Catalog = [
  {
    id: 'Indrasol.alpha',
    displayName: 'Alpha',
    tagline: 'Does alpha things',
    marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=Indrasol.alpha',
    openVsxUrl: 'https://open-vsx.org/extension/Indrasol/alpha',
  },
  {
    id: 'Indrasol.beta',
    displayName: 'Beta',
    tagline: 'Does beta things',
    marketplaceUrl: 'https://marketplace.visualstudio.com/items?itemName=Indrasol.beta',
    openVsxUrl: 'https://open-vsx.org/extension/Indrasol/beta',
  },
];

const opts = {
  viewId: 'alpha.moreFromLabs',
  currentExtensionId: 'indrasol.ALPHA',
  campaign: 'alpha',
};

const urlOf = (item: vscode.TreeItem) => item.command?.arguments?.[0] as string;

beforeEach(() => {
  mock.reset();
});

describe('More from Indrasol Labs', () => {
  it('ships an empty catalog for now', () => {
    expect(CATALOG).toEqual([]);
  });

  it('hides the current extension and ends with the All extensions item', () => {
    const items = buildItems({ ...opts, catalog });
    expect(items.map((i) => i.label)).toEqual(['Beta', 'All extensions']);
  });

  it('shows only the All extensions item with the built-in catalog', () => {
    const items = buildItems(opts);
    expect(items).toHaveLength(1);
    expect(urlOf(items[0] as vscode.TreeItem)).toBe(
      'https://indrasol.com/labs?utm_source=vscode&utm_campaign=alpha',
    );
  });

  it('appends UTM parameters to every URL', () => {
    for (const item of buildItems({ ...opts, catalog })) {
      const url = new URL(urlOf(item));
      expect(url.searchParams.get('utm_source')).toBe('vscode');
      expect(url.searchParams.get('utm_campaign')).toBe('alpha');
    }
    expect(withUtm('https://example.com/x?itemName=a', 'c')).toBe(
      'https://example.com/x?itemName=a&utm_source=vscode&utm_campaign=c',
    );
  });

  it('links to the Marketplace in VS Code and to Open VSX in other editors', () => {
    expect(urlOf(buildItems({ ...opts, catalog })[0] as vscode.TreeItem)).toContain(
      'marketplace.visualstudio.com',
    );
    env.uriScheme = 'cursor';
    expect(urlOf(buildItems({ ...opts, catalog })[0] as vscode.TreeItem)).toContain('open-vsx.org');
  });

  it('gives every item a tooltip and accessibility label', () => {
    for (const item of buildItems({ ...opts, catalog })) {
      expect(item.tooltip).toBeTruthy();
      expect(item.accessibilityInformation?.label).toContain(item.label as string);
    }
  });

  it('registers a tree view whose items open the URL externally', async () => {
    const ctx = createContext();
    const disposable = registerMoreFromLabsView(asContext(ctx), { ...opts, catalog });
    expect(ctx.subscriptions).toContain(disposable);

    const provider = mock.treeViews.get(opts.viewId) as vscode.TreeDataProvider<vscode.TreeItem>;
    const roots = (await provider.getChildren()) ?? [];
    expect(roots).toHaveLength(2);
    const first = roots[0] as vscode.TreeItem;
    expect(provider.getTreeItem(first)).toBe(first);
    expect(await provider.getChildren(first)).toEqual([]);

    const command = first.command as vscode.Command;
    await mock.commands.get(command.command)?.(urlOf(first));
    expect(env.openExternal).toHaveBeenCalledTimes(1);

    disposable.dispose();
    expect(mock.commands.has(command.command)).toBe(false);
  });
});
