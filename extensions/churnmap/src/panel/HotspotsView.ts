import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { AnalysisResult } from '../analysis/model.js';
import type { AnalysisStore } from '../analysis/store.js';
import {
  type HotspotNode,
  hotspotChildren,
  hotspotTooltip,
  itemSpec,
  nodePath,
} from './hotspotTree.js';
import { RANK_ALL_LABEL } from '../city/protocol.js';
import { reasonText, untilDate } from './ignore.js';

export const HOTSPOTS_VIEW = 'churnmap.hotspots';
/** Context key: the shown analysis ranks every file (the view's "Rank source code only" button). */
export const RANK_ALL_CONTEXT = 'churnmap.rankAll';
const TITLE = 'Hotspots';

/** The nodes of one analysis result, built once and reused, so `reveal` finds the same objects. */
interface Nodes {
  of: AnalysisResult;
  roots: HotspotNode[];
  byPath: Map<string, HotspotNode>;
  children: Map<string, HotspotNode[]>;
  group: HotspotNode | undefined;
  ignored: HotspotNode[];
}

/**
 * The ranked hotspot tree: the store's top 20 in store order, each with its reasons as
 * children. Empty until analysis exists, so VS Code shows the view's welcome content. Selecting an
 * item selects the building in the city when the city is open.
 */
export class HotspotsView implements vscode.TreeDataProvider<HotspotNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly treeView: vscode.TreeView<HotspotNode>;
  private readonly disposables: { dispose(): void }[] = [];
  private nodes: Nodes | undefined;

  constructor(
    private readonly store: AnalysisStore,
    onSelect: (path: string) => void,
  ) {
    this.treeView = vscode.window.createTreeView(HOTSPOTS_VIEW, {
      treeDataProvider: this,
      showCollapseAll: true,
    });
    this.disposables.push(
      this.treeView,
      this.changed,
      store.onDidChange(() => {
        this.refresh();
      }),
      this.treeView.onDidChangeSelection((e) => {
        const path = e.selection[0] ? nodePath(e.selection[0]) : undefined;
        if (path !== undefined) onSelect(path);
      }),
    );
    this.updateTitle();
  }

  private current(): Nodes | undefined {
    const result = this.store.get();
    if (!result) return undefined;
    if (this.nodes?.of !== result) {
      const layout = this.store.getLayout();
      const roots: HotspotNode[] = result.top.map((hotspot) => ({ kind: 'hotspot', hotspot }));
      const byPath = new Map<string, HotspotNode>();
      const children = new Map<string, HotspotNode[]>();
      for (const node of roots) {
        if (node.kind !== 'hotspot') continue;
        const path = node.hotspot.file.path;
        const id = layout?.byPath[path];
        const building = id === undefined ? undefined : layout?.buildings[id];
        byPath.set(path, node);
        children.set(path, hotspotChildren(node.hotspot, building?.folded?.files));
      }
      const ignored: HotspotNode[] = this.store
        .ignored()
        .map((entry) => ({ kind: 'ignored', entry }));
      const group: HotspotNode | undefined =
        ignored.length > 0 ? { kind: 'ignoredGroup', count: ignored.length } : undefined;
      if (group) roots.push(group);
      this.nodes = { of: result, roots, byPath, children, group, ignored };
    }
    return this.nodes;
  }

  getTreeItem(node: HotspotNode): vscode.TreeItem {
    const spec = itemSpec(node);
    const item = new vscode.TreeItem(
      spec.label,
      spec.collapsible
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    item.id = spec.id;
    if (spec.description !== undefined) item.description = spec.description;
    item.iconPath = new vscode.ThemeIcon(
      spec.icon,
      spec.iconColor ? new vscode.ThemeColor(spec.iconColor) : undefined,
    );
    item.contextValue = spec.contextValue;
    item.accessibilityInformation = { label: spec.accessibilityLabel };
    return item;
  }

  /** The tooltip is built only when the user hovers. */
  resolveTreeItem(item: vscode.TreeItem, node: HotspotNode): vscode.TreeItem {
    const result = this.store.get();
    if (node.kind === 'hotspot' && result) {
      item.tooltip = new vscode.MarkdownString(hotspotTooltip(node.hotspot, result.window));
    } else if (node.kind === 'ignored') {
      item.tooltip = `Ignored until ${untilDate(node.entry)}: ${reasonText(node.entry)}`;
    }
    return item;
  }

  getChildren(node?: HotspotNode): HotspotNode[] {
    const nodes = this.current();
    if (!nodes) return [];
    if (!node) return nodes.roots;
    if (node.kind === 'hotspot') return nodes.children.get(node.hotspot.file.path) ?? [];
    if (node.kind === 'ignoredGroup') return nodes.ignored;
    return [];
  }

  getParent(node: HotspotNode): HotspotNode | undefined {
    switch (node.kind) {
      case 'hotspot':
      case 'ignoredGroup':
        return undefined;
      case 'ignored':
        return this.current()?.group;
      case 'reason':
      case 'meta':
        return this.current()?.byPath.get(node.parent);
    }
  }

  /** The hotspot node for a path, or the rank-1 node when no path is given. */
  nodeFor(path?: string): HotspotNode | undefined {
    const nodes = this.current();
    if (!nodes) return undefined;
    if (path !== undefined) return nodes.byPath.get(path);
    return nodes.roots[0]?.kind === 'hotspot' ? nodes.roots[0] : undefined;
  }

  /** Selects (and scrolls to) a hotspot; false when it is not in the list. */
  async reveal(path?: string): Promise<boolean> {
    const node = this.nodeFor(path);
    if (!node) return false;
    await this.treeView.reveal(node, { select: true, focus: false, expand: false });
    return true;
  }

  refresh(): void {
    this.nodes = undefined;
    this.updateTitle();
    this.changed.fire(undefined);
  }

  private updateTitle(): void {
    const result = this.store.get();
    // Ignored files are already out of `top`; the "Ignored (N)" node carries their count.
    const count = result?.top.length ?? 0;
    this.treeView.title = result ? `${TITLE} · ${String(result.window)} d` : TITLE;
    // Ranking every file is never silent: the view says so next to its title.
    this.treeView.description = result?.rank === 'all' ? RANK_ALL_LABEL : '';
    void vscode.commands.executeCommand('setContext', RANK_ALL_CONTEXT, result?.rank === 'all');
    // With no ranked file the view would be blank: say why and where to go next.
    this.treeView.message =
      result && result.files.every((f) => !f.eligible)
        ? `No source-code hotspots in ${basename(result.repoRoot)}. Run “Churnmap: Select repository…” to pick a code repository, or set churnmap.rank to all.`
        : '';
    this.treeView.badge =
      count > 0
        ? { value: count, tooltip: `${String(count)} ${count === 1 ? 'hotspot' : 'hotspots'}` }
        : undefined;
  }

  dispose(): void {
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
  }
}
