import * as vscode from 'vscode';

export interface LoggerOptions {
  /** Log to an existing channel instead of creating one. The caller keeps ownership of it. */
  channel?: vscode.LogOutputChannel;
  /** Append stack traces to logged errors. Off by default: stacks contain file paths. */
  includeStacks?: boolean;
}

export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  /** Logs the error's class name and message; the stack only when `includeStacks` is set. */
  error(err: unknown, context?: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

/** Formats an unknown thrown value as `ClassName: message`, with no stack. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message ? `${errorClassName(err)}: ${err.message}` : errorClassName(err);
  }
  return typeof err === 'string' ? err : `Non-Error value (${typeof err})`;
}

/** The class name of a thrown value, never its message or stack. */
export function errorClassName(err: unknown): string {
  if (err instanceof Error) {
    const ctorName = err.constructor.name;
    return ctorName && ctorName !== 'Error' ? ctorName : err.name || 'Error';
  }
  return typeof err;
}

/**
 * A logger over a `LogOutputChannel`, so the user's "Developer: Set Log Level" setting applies.
 */
export function createLogger(name: string, opts: LoggerOptions = {}): Logger {
  const ownsChannel = opts.channel === undefined;
  const channel = opts.channel ?? vscode.window.createOutputChannel(name, { log: true });
  const includeStacks = opts.includeStacks ?? false;

  return {
    trace: (message, ...args) => {
      channel.trace(message, ...args);
    },
    debug: (message, ...args) => {
      channel.debug(message, ...args);
    },
    info: (message, ...args) => {
      channel.info(message, ...args);
    },
    warn: (message, ...args) => {
      channel.warn(message, ...args);
    },
    error: (err, context) => {
      let text = describeError(err);
      if (context) text = `${context}: ${text}`;
      if (includeStacks && err instanceof Error && err.stack) text = `${text}\n${err.stack}`;
      channel.error(text);
    },
    show: (preserveFocus) => {
      channel.show(preserveFocus);
    },
    dispose: () => {
      if (ownsChannel) channel.dispose();
    },
  };
}
