/**
 * Where "Open in chat" can take a brief. Pure, so the rule is unit-tested; `aiPrompt.ts` feeds it the
 * app name and the registered commands (`commands.getCommands(true)`).
 *
 * - VS Code: `workbench.action.chat.open` accepts `{ query }` and opens the chat with the text.
 * - Cursor: it registers its own chat commands, but none is documented to accept text, so a brief
 *   could not be passed reliably. The button is hidden there and Copy is the path.
 * - Anything else without the VS Code command: hidden too.
 */

export const VSCODE_CHAT_OPEN = 'workbench.action.chat.open';

export interface ChatTarget {
  command: string;
  /** The single argument the command takes, built from the brief. */
  argument(text: string): unknown;
}

export function chatTarget(appName: string, commands: readonly string[]): ChatTarget | undefined {
  if (/cursor/i.test(appName)) return undefined;
  if (!commands.includes(VSCODE_CHAT_OPEN)) return undefined;
  return { command: VSCODE_CHAT_OPEN, argument: (text) => ({ query: text }) };
}
