import { basename } from 'node:path';
import {
  createLogger,
  type MoreFromLabsOptions,
  registerMoreFromLabsView,
} from '@indrasol/labs-core';
// The view's children are exactly `buildItems(options)`; tests read them through this.
import { buildItems } from '@indrasol/labs-core/src/moreFromLabs.js';
import * as vscode from 'vscode';
import type { Discovery } from './analysis/discover.js';
import type { AnalysisResult } from './analysis/model.js';
import { AnalysisStore } from './analysis/store.js';
import { spawnCount } from './analysis/gitProcess.js';
import { addToAgent, checkAgentConfigs } from './ai/addToAgent.js';
import { createAIPrompt, createAIPromptForChanges } from './ai/aiPrompt.js';
import { exportForAgents, refreshAgentContext } from './ai/exportForAgents.js';
import { McpProvider } from './ai/mcpProvider.js';
import { CoolDownNudge } from './ai/nudge.js';
import { Builder, type BuildSummary, configuredSettings, configuredWindow } from './build.js';
import { COMMANDS } from './commands.js';
import type { AnyHostToWebview, AnyWebviewToHost } from './city/protocol.js';
import { ScmWatch, showChangedHotspots } from './daily/scmWatch.js';
import { type ItemState, RankStatusBar } from './daily/statusBar.js';
import { exportPostcard } from './export/postcard.js';
import { COACH_KEY, CityPanel, PANELS_KEY, RAIL_KEY } from './panel/CityPanel.js';
import { fileNotFoundMessage, resolveRepoPath } from './openFile.js';
import { argPath, type HotspotNode } from './panel/hotspotTree.js';
import { HOTSPOTS_VIEW, HotspotsView } from './panel/HotspotsView.js';
import { IGNORE_KEY, type IgnoreEntry, IgnoreStore } from './panel/ignore.js';
import { ignoreHotspot, unignore } from './panel/ignoreCommands.js';
import { links, MORE_FROM_LABS_LINKS } from './links.js';
import { copiedMessage, hotspotsMarkdown, localDate } from './panel/markdown.js';
import { overridePrompts, type Prompts } from './prompts.js';
import { REPOSITORY_KEY } from './repoChoice.js';
import { isAnalysisAllowed, onAnalysisAllowed, showUntrustedMessage } from './trust.js';
import { warmStart, type WarmStartOutcome } from './warmStart.js';

const moduleLoadedAt = performance.now();

export { HOTSPOTS_VIEW };
export const MORE_FROM_LABS_VIEW = 'churnmap.moreFromLabs';

/** Returned from `activate` only in test mode, so integration tests can read build results. */
export interface TestApi {
  /** Time spent inside `activate()`, from its first line to the end of registration, in ms. */
  __activationMs: number;
  __lastBuildSummary(): BuildSummary | undefined;
  __analysis(): AnalysisResult | undefined;
  __city: {
    /** Resolves with the next message of `type` the host receives from the city webview. */
    nextMessage(type: AnyWebviewToHost['type'], timeoutMs?: number): Promise<AnyWebviewToHost>;
    /** How many messages of `type` the host has received from / posted to the webview. */
    /** Resolves with the next message of `type` the host posts to the city webview. */
    nextPosted(type: AnyHostToWebview['type'], timeoutMs?: number): Promise<AnyHostToWebview>;
    received(type: string): number;
    posted(type: string): number;
    /** Posts to the webview once it is ready; false when no ready test-mode panel is open. */
    post(message: AnyHostToWebview): boolean;
    html(): string | undefined;
  };
  __hotspots: {
    children(node?: HotspotNode): HotspotNode[];
    item(node: HotspotNode): vscode.TreeItem;
    visible(): boolean;
    title(): string | undefined;
    description(): string | undefined;
    badge(): number | undefined;
  };
  /** Answers the next questions instead of the user; returns a function that restores the UI. */
  __prompts(overrides: Partial<Prompts>): () => void;
  __ignores: {
    list(): IgnoreEntry[];
    /** The stored value, unfiltered. */
    stored(): unknown;
    /** Replaces the stored value (to plant expired or malformed entries). */
    store(value: unknown): Promise<void>;
  };
  __daily: { rank(): ItemState; scm(): ItemState };
  /** Runs the warm start into a fresh store (the extension's own store is left alone). */
  __warmStart(): Promise<{
    outcome: WarmStartOutcome;
    ms: number;
    timings: Record<string, number> | undefined;
    /** Processes started while it ran (must be 0). */
    spawns: number;
  }>;
  /** Processes Churnmap has started this session. */
  __spawns(): number;
  /** The "More from Indrasol Labs" view's rows, in order: label and the URL each opens. */
  __moreFromLabs(): { label: string; url: string }[];
  /** The absolute path of this version's `dist/mcp-server.js`. */
  __mcpServerPath(): string;
  /** The extension's global storage folder (the cache is under it). */
  __storageDir(): string;
  /** The first-run coach mark's globalState flag. */
  __coach: { shown(): unknown; reset(): Promise<void> };
  /** The remembered card, rail and legend corners and states (workspaceState). */
  __panels: { stored(): unknown; reset(): Promise<void> };
  __repositories: {
    /** Runs discovery; `spawns` counts the processes started meanwhile (must be 0). */
    discover(): Promise<Discovery & { spawns: number }>;
    /** The remembered repository root (workspaceState). */
    remembered(): unknown;
    forget(): Promise<void>;
  };
}

/** Keep activation under 100 ms: no I/O and no `await` before everything is registered. */
export function activate(context: vscode.ExtensionContext): TestApi | undefined {
  const activateStartedAt = performance.now();
  const logger = createLogger('Churnmap');
  const store = new AnalysisStore();
  const ignores = new IgnoreStore(context.workspaceState);
  store.setIgnoreSource(() => ignores.list());
  context.subscriptions.push(
    ignores,
    ignores.onDidChange(() => {
      store.ignoresChanged();
    }),
  );
  // Selecting a hotspot selects its building when the city is open (it is never opened for it).
  const hotspots = new HotspotsView(store, (path) => CityPanel.instance?.select(path));
  const builder = new Builder(context, logger, store);
  context.subscriptions.push(logger, hotspots, store);

  const rankBar = new RankStatusBar(store);
  const scm = new ScmWatch(store, logger);
  const nudge = new CoolDownNudge(store);
  context.subscriptions.push(rankBar, scm, nudge);
  // After every build, a repository that has `.churnmap/hotspots.json` gets both files rewritten.
  builder.onBuilt = () => {
    const current = store.get();
    return current ? refreshAgentContext(current, store.ignored()) : Promise.resolve(false);
  };

  let lastBuildSummary: BuildSummary | undefined;
  const cityDeps = { context, store, logger };
  const runWarmStart = (into: AnalysisStore) =>
    warmStart({
      store: into,
      storageDir: context.globalStorageUri.fsPath,
      folders: () => builder.repositories.warmStartFolders(),
      trusted: isAnalysisAllowed(),
      window: configuredWindow(),
      settings: configuredSettings(),
      logger,
    });
  const warmStartInBackground = (): void => {
    runWarmStart(store).catch((err: unknown) => {
      logger.warn(`Warm start failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register(COMMANDS.build, async () => {
    if (!isAnalysisAllowed()) {
      showUntrustedMessage();
      return;
    }
    lastBuildSummary = await builder.build();
    // The city opens when a build finishes, unless it is already on screen.
    if (lastBuildSummary && !CityPanel.isVisible()) CityPanel.show(cityDeps);
  });

  register(COMMANDS.open, async () => {
    CityPanel.show(cityDeps);
    // Nothing to draw yet: build (a cache hit when the repository was built before).
    if (!store.get() && isAnalysisAllowed()) {
      lastBuildSummary = (await builder.build()) ?? lastBuildSummary;
    }
  });

  register(COMMANDS.toggleTreemap, async () => {
    const hadPanel = CityPanel.instance !== undefined;
    await CityPanel.toggleView(cityDeps);
    if (!hadPanel && !store.get() && isAnalysisAllowed()) {
      lastBuildSummary = (await builder.build()) ?? lastBuildSummary;
    }
  });

  register(COMMANDS.setWindow, async (window) => {
    if (!isAnalysisAllowed()) {
      showUntrustedMessage();
      return;
    }
    lastBuildSummary =
      (await builder.setWindow(window, (chosen) => {
        CityPanel.instance?.postWindow(chosen);
      })) ?? lastBuildSummary;
  });

  register(COMMANDS.selectRepository, async () => {
    if (!isAnalysisAllowed()) {
      showUntrustedMessage();
      return;
    }
    const picked = await builder.selectRepository();
    if (!picked) return;
    lastBuildSummary = (await builder.build({ target: picked })) ?? lastBuildSummary;
    if (lastBuildSummary && !CityPanel.isVisible()) CityPanel.show(cityDeps);
  });

  register(COMMANDS.clearCache, () => builder.clearCache());

  register(COMMANDS.openFile, (arg) => openRepoFile(store, argPath(arg) ?? arg));

  register(COMMANDS.ignoreHotspot, (arg) => ignoreHotspot(store, ignores, arg));
  register(COMMANDS.unignore, (arg) => unignore(ignores, arg));

  const aiDeps = { context, store, logger };
  register(COMMANDS.showChangedHotspots, () =>
    showChangedHotspots(scm, (hits) => createAIPromptForChanges(aiDeps, hits)),
  );

  register(COMMANDS.createAIPrompt, (arg, template) => createAIPrompt(aiDeps, arg, template));
  // The Hotspots view's title-bar sparkle: the #1 hotspot, no question asked about which.
  register(COMMANDS.createAIPromptTop, (template) => {
    const top = store.get()?.top[0]?.file.path;
    return createAIPrompt(aiDeps, top, template);
  });
  register(COMMANDS.rankCodeOnly, async () => {
    if (!isAnalysisAllowed()) {
      showUntrustedMessage();
      return;
    }
    lastBuildSummary = (await builder.setRank('code')) ?? lastBuildSummary;
  });
  register(COMMANDS.exportForAgents, () => exportForAgents(aiDeps));

  // The MCP server ships in the VSIX; nothing starts it here. Listing it in VS Code (1.101+) is a
  // cheap registration that serves a definition only after the user chose "VS Code".
  const mcpPaths = {
    serverPath: context.asAbsolutePath('dist/mcp-server.js'),
    cacheDir: context.globalStorageUri.fsPath,
  };
  const mcp = new McpProvider(context, mcpPaths);
  context.subscriptions.push(mcp);
  const connectDeps = { ...aiDeps, mcp, paths: mcpPaths };
  register(COMMANDS.addToAgent, (arg) => addToAgent(connectDeps, arg));

  register(COMMANDS.showHotspots, async (arg) => {
    await vscode.commands.executeCommand(`${HOTSPOTS_VIEW}.focus`);
    const path = argPath(arg);
    // The given file (status bar), else rank 1; nothing to reveal before a build.
    if (!(path !== undefined && (await hotspots.reveal(path)))) await hotspots.reveal();
  });

  register(COMMANDS.showInCity, async (arg) => {
    const path = argPath(arg);
    if (path === undefined) return;
    CityPanel.show(cityDeps).select(path);
    if (!store.get() && isAnalysisAllowed()) {
      lastBuildSummary = (await builder.build()) ?? lastBuildSummary;
    }
  });

  register(COMMANDS.copyHotspotsMarkdown, async () => {
    const result = store.get();
    if (!result) {
      void vscode.window.showInformationMessage('Churnmap: build the city first.');
      return;
    }
    await vscode.env.clipboard.writeText(
      hotspotsMarkdown({
        repoName: basename(result.repoRoot),
        window: result.window,
        date: localDate(new Date()),
        top: result.top,
      }),
    );
    void vscode.window.showInformationMessage(copiedMessage(result.top.length));
  });

  register(COMMANDS.exportPostcard, () => exportPostcard(cityDeps));

  // The walkthrough's "Talk to Indrasol" link: opens only when clicked.
  register(COMMANDS.openTalkLink, () =>
    vscode.env.openExternal(vscode.Uri.parse(links.talk('walkthrough'))),
  );

  context.subscriptions.push(
    { dispose: () => CityPanel.instance?.dispose() },
    onAnalysisAllowed(() => {
      logger.info('Workspace trusted: analysis is enabled.');
      hotspots.refresh();
      if (!store.get()) warmStartInBackground();
    }),
  );

  const labsOptions: MoreFromLabsOptions = {
    viewId: MORE_FROM_LABS_VIEW,
    currentExtensionId: context.extension.id,
    campaign: 'churnmap',
    links: MORE_FROM_LABS_LINKS,
  };
  registerMoreFromLabsView(context, labsOptions);

  // Warm start: a cached analysis for this root + HEAD fills the panel, city and status bar
  // without a build. After activation returns, so it costs activation nothing.
  setImmediate(warmStartInBackground);
  // Agent configs written by an older version point at its server path: offer to fix them (reads
  // only; writes on the user's click).
  setImmediate(() => {
    checkAgentConfigs(connectDeps).catch((err: unknown) => {
      logger.warn(`Agent config check failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  const activationMs = performance.now() - activateStartedAt;
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    logger.info(`Activated in ${(performance.now() - moduleLoadedAt).toFixed(1)} ms`);
  }

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    return {
      __activationMs: activationMs,
      __lastBuildSummary: () => lastBuildSummary,
      __analysis: () => store.get(),
      __city: {
        nextMessage: (type, timeoutMs) => CityPanel.__nextMessage(type, timeoutMs),
        nextPosted: (type, timeoutMs) => CityPanel.__nextPosted(type, timeoutMs),
        received: (type) => CityPanel.__received(type),
        posted: (type) => CityPanel.__posted(type),
        post: (message) => CityPanel.__post(message),
        html: () => CityPanel.__html(),
      },
      __hotspots: {
        children: (node) => hotspots.getChildren(node),
        item: (node) => hotspots.resolveTreeItem(hotspots.getTreeItem(node), node),
        visible: () => hotspots.treeView.visible,
        title: () => hotspots.treeView.title,
        description: () => hotspots.treeView.description,
        badge: () => hotspots.treeView.badge?.value,
      },
      __prompts: (overrides) => overridePrompts(overrides),
      __ignores: {
        list: () => ignores.list(),
        stored: () => context.workspaceState.get(IGNORE_KEY),
        store: async (value) => {
          await context.workspaceState.update(IGNORE_KEY, value);
          store.ignoresChanged();
        },
      },
      __daily: { rank: () => rankBar.state(), scm: () => scm.state() },
      __warmStart: async () => {
        const fresh = new AnalysisStore();
        const before = spawnCount();
        const { outcome, ms } = await runWarmStart(fresh);
        return { outcome, ms, timings: fresh.get()?.timings, spawns: spawnCount() - before };
      },
      __spawns: () => spawnCount(),
      __moreFromLabs: () =>
        buildItems(labsOptions).map((item) => ({
          label: typeof item.label === 'string' ? item.label : (item.label?.label ?? ''),
          url: String(item.command?.arguments?.[0] ?? ''),
        })),
      __mcpServerPath: () => mcpPaths.serverPath,
      __storageDir: () => context.globalStorageUri.fsPath,
      __coach: {
        shown: () => context.globalState.get(COACH_KEY),
        reset: async () => {
          await context.globalState.update(COACH_KEY, undefined);
        },
      },
      __panels: {
        stored: () => context.workspaceState.get(PANELS_KEY),
        reset: async () => {
          await context.workspaceState.update(PANELS_KEY, undefined);
          await context.workspaceState.update(RAIL_KEY, undefined);
        },
      },
      __repositories: {
        discover: async () => {
          const before = spawnCount();
          const found = await builder.repositories.discover();
          return { ...found, spawns: spawnCount() - before };
        },
        remembered: () => context.workspaceState.get(REPOSITORY_KEY),
        forget: async () => {
          await context.workspaceState.update(REPOSITORY_KEY, undefined);
        },
      },
    };
  }
  return undefined;
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}

/**
 * `churnmap.openFile`: opens a repository-relative path (from the hotspots view or the city) as a
 * preview at line 1. Absolute paths, `..` and missing files are refused with a warning.
 */
async function openRepoFile(store: AnalysisStore, path: unknown): Promise<boolean> {
  const root = store.get()?.repoRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const full = root === undefined ? undefined : resolveRepoPath(root, path);
  let uri: vscode.Uri | undefined;
  if (full !== undefined) {
    uri = vscode.Uri.file(full);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.File) === 0) uri = undefined;
    } catch {
      uri = undefined;
    }
  }
  if (!uri) {
    void vscode.window.showWarningMessage(fileNotFoundMessage(path));
    return false;
  }
  await vscode.window.showTextDocument(uri, {
    preview: true,
    selection: new vscode.Range(0, 0, 0, 0),
  });
  return true;
}
