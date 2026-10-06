/**
 * Minimal stand-in for the `vscode` module, aliased in vitest.config.ts. It implements only
 * what labs-core touches, and records calls so tests can assert on them.
 */
import { vi } from 'vitest';

type Listener<T> = (value: T) => void;

export class Disposable {
  constructor(private readonly callOnDispose: () => void) {}
  static from(...items: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => {
      for (const item of items) item.dispose();
    });
  }
  dispose(): void {
    this.callOnDispose();
  }
}

export class EventEmitter<T> {
  private listeners: Listener<T>[] = [];
  event = (listener: Listener<T>): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  };
  fire(value: T): void {
    for (const l of this.listeners) l(value);
  }
}

export enum ExtensionMode {
  Production = 1,
  Development = 2,
  Test = 3,
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class ThemeIcon {
  constructor(readonly id: string) {}
}

export class TreeItem {
  description?: string;
  tooltip?: string;
  iconPath?: ThemeIcon;
  accessibilityInformation?: { label: string; role?: string };
  command?: { command: string; title: string; arguments?: unknown[] };
  constructor(
    readonly label: string,
    readonly collapsibleState: TreeItemCollapsibleState,
  ) {}
}

export const Uri = {
  parse: (value: string) => ({ toString: () => value }),
};

export interface MockLogChannel {
  name: string;
  trace: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

export function createMockChannel(name = 'mock'): MockLogChannel {
  return {
    name,
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  };
}

export const env = {
  appName: 'Visual Studio Code',
  uriScheme: 'vscode',
  openExternal: vi.fn(() => Promise.resolve(true)),
};

export const version = '1.96.0';

export const window = {
  createOutputChannel: vi.fn((name: string) => {
    const channel = createMockChannel(name);
    mock.channels.push(channel);
    return channel;
  }),
  createTreeView: vi.fn((viewId: string, options: { treeDataProvider: unknown }) => {
    mock.treeViews.set(viewId, options.treeDataProvider);
    return { dispose: vi.fn() };
  }),
};

export const commands = {
  registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => unknown) => {
    mock.commands.set(id, handler);
    return new Disposable(() => mock.commands.delete(id));
  }),
};

/** Recorded state and helpers for tests. */
export const mock = {
  channels: [] as MockLogChannel[],
  treeViews: new Map<string, unknown>(),
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  reset(): void {
    mock.channels.length = 0;
    mock.treeViews.clear();
    mock.commands.clear();
    env.uriScheme = 'vscode';
    vi.clearAllMocks();
  },
};

export interface MockContext {
  extensionMode: ExtensionMode;
  subscriptions: { dispose(): unknown }[];
  globalState: {
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

export function createContext(mode: ExtensionMode = ExtensionMode.Production): MockContext {
  const store = new Map<string, unknown>();
  return {
    extensionMode: mode,
    subscriptions: [],
    globalState: {
      get: vi.fn((key: string) => store.get(key)),
      update: vi.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
    },
  };
}
