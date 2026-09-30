import type * as vscode from 'vscode';
import type { MockContext, MockLogChannel } from './vscode.mock.js';

/** The mocks implement only what labs-core uses; cast them to the real API types. */
export const asContext = (ctx: MockContext) => ctx as unknown as vscode.ExtensionContext;
export const asChannel = (ch: MockLogChannel) => ch as unknown as vscode.LogOutputChannel;
