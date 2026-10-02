import * as vscode from 'vscode';
import { serverEntry } from './mcpConfig.js';

/** Matches `contributes.mcpServerDefinitionProviders[0].id` in package.json. */
export const MCP_PROVIDER_ID = 'churnmap.mcp';
/** globalState key: the user chose "VS Code" in *Connect to AI agent…*. */
export const MCP_ENABLED_KEY = 'churnmap.mcp.vscode';

// The MCP provider API arrived in VS Code 1.101; engines stays ^1.96, so it is typed here and
// feature-detected at runtime.
interface McpStdioServerDefinitionCtor {
  new (
    label: string,
    command: string,
    args?: string[],
    env?: Record<string, string | number | null>,
    version?: string,
  ): { cwd?: vscode.Uri };
}
interface McpProviderApi {
  registerMcpServerDefinitionProvider(
    id: string,
    provider: {
      onDidChangeMcpServerDefinitions?: vscode.Event<void>;
      provideMcpServerDefinitions(): unknown[];
    },
  ): vscode.Disposable;
}

function providerApi():
  { lm: McpProviderApi; Definition: McpStdioServerDefinitionCtor } | undefined {
  const api = vscode as unknown as {
    lm?: Partial<McpProviderApi>;
    McpStdioServerDefinition?: McpStdioServerDefinitionCtor;
  };
  const lm = api.lm;
  if (typeof lm?.registerMcpServerDefinitionProvider !== 'function') return undefined;
  if (typeof api.McpStdioServerDefinition !== 'function') return undefined;
  return { lm: lm as McpProviderApi, Definition: api.McpStdioServerDefinition };
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const manifest: unknown = context.extension.packageJSON;
  const version =
    typeof manifest === 'object' && manifest !== null && 'version' in manifest
      ? manifest.version
      : undefined;
  return typeof version === 'string' ? version : '';
}

export interface McpServerPaths {
  /** Absolute path of `dist/mcp-server.js` in this extension version. */
  serverPath: string;
  /** The extension's global storage folder (the cache is under it). */
  cacheDir: string;
}

/**
 * Lists Churnmap's MCP server in VS Code (1.101+) once the user chose "VS Code" in *Connect to AI
 * agent…*; nothing is written to the workspace. Registering is cheap and starts no process; VS Code
 * starts the server only when an agent uses it. The server runs on VS Code's own runtime
 * (`ELECTRON_RUN_AS_NODE`), so no separate Node.js is needed.
 */
export class McpProvider implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private registration: vscode.Disposable | undefined;
  private folders: vscode.Disposable | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly paths: McpServerPaths,
  ) {
    const api = providerApi();
    if (!api) return;
    try {
      this.registration = api.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
        onDidChangeMcpServerDefinitions: this.changed.event,
        provideMcpServerDefinitions: () => {
          if (this.context.globalState.get(MCP_ENABLED_KEY) !== true) return [];
          // The workspace folders are the server's scope (`--workspace`), as in the agent configs.
          const workspaces = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
          const definition = new api.Definition(
            'Churnmap',
            process.execPath,
            serverEntry('vscode', { ...this.paths, workspaces }).args,
            { ELECTRON_RUN_AS_NODE: '1' },
            extensionVersion(this.context),
          );
          const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
          if (folder) definition.cwd = folder;
          return [definition];
        },
      });
    } catch {
      // An editor with the API but without this contribution point: *Connect* falls back to a file.
      this.registration = undefined;
    }
    // A folder added or removed changes the scope: VS Code asks for the definition again.
    this.folders = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.changed.fire();
    });
  }

  /** True when this VS Code has the MCP provider API. */
  static available(): boolean {
    return providerApi() !== undefined;
  }

  get registered(): boolean {
    return this.registration !== undefined;
  }

  async enable(): Promise<void> {
    await this.context.globalState.update(MCP_ENABLED_KEY, true);
    this.changed.fire();
  }

  dispose(): void {
    this.registration?.dispose();
    this.folders?.dispose();
    this.changed.dispose();
  }
}
