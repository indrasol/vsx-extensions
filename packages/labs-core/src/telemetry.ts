import * as vscode from 'vscode';
import { errorClassName } from './logger.js';

export type TelemetryProperties = Record<string, string | number | boolean>;

export interface TelemetryEvent {
  name: string;
  properties: TelemetryProperties;
}

/**
 * Delivers events once telemetry is switched on by a future ADR. No transport exists in v1,
 * and this package contains no network code: an extension would have to supply one.
 */
export interface TelemetryTransport {
  send(event: TelemetryEvent): void;
}

export interface TelemetryOptions {
  extensionId: string;
  version: string;
  /** Off by default, and off for every v1 extension (ADR-0006). */
  enabled?: boolean;
  transport?: TelemetryTransport;
  /** Development-mode channel that shows what would be sent. Created on demand if omitted. */
  devChannel?: vscode.LogOutputChannel;
}

export interface Telemetry {
  activated(): void;
  commandExecuted(commandId: string): void;
  featureUsed(feature: string): void;
  /** Sends the error's class name only: never its message or stack. */
  error(err: unknown): void;
  dispose(): void;
}

export const INSTALL_ID_KEY = 'labs.installId';
const MAX_VALUE_LENGTH = 200;

/** True for strings that look like a POSIX or Windows path (`/`, `\`, or a drive letter + `:`). */
export function isPathLike(value: string): boolean {
  return /[/\\]/.test(value) || /(^|[^A-Za-z0-9])[A-Za-z]:/.test(value);
}

/**
 * Keeps only numbers, booleans and short strings that do not look like paths.
 * Everything else is dropped rather than truncated, so nothing partial leaks.
 */
export function scrub(properties: Readonly<Record<string, unknown>>): TelemetryProperties {
  const clean: TelemetryProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    } else if (
      typeof value === 'string' &&
      value.length <= MAX_VALUE_LENGTH &&
      !isPathLike(value)
    ) {
      clean[key] = value;
    }
  }
  return clean;
}

function getInstallId(context: vscode.ExtensionContext): string {
  const existing = context.globalState.get<string>(INSTALL_ID_KEY);
  if (existing) return existing;
  const id = globalThis.crypto.randomUUID();
  void context.globalState.update(INSTALL_ID_KEY, id);
  return id;
}

/**
 * Anonymous telemetry per ADR-0006, built on `vscode.env.createTelemetryLogger()` so the
 * user's `telemetry.telemetryLevel` is honoured. With the default options nothing is sent.
 */
export function createTelemetry(
  context: vscode.ExtensionContext,
  opts: TelemetryOptions,
): Telemetry {
  const enabled = opts.enabled === true;
  const disposables: vscode.Disposable[] = [];

  let devChannel: vscode.LogOutputChannel | undefined;
  if (context.extensionMode === vscode.ExtensionMode.Development) {
    devChannel = opts.devChannel;
    if (!devChannel) {
      devChannel = vscode.window.createOutputChannel('Indrasol Labs Telemetry', { log: true });
      disposables.push(devChannel);
    }
  }

  const deliver = (name: string, data: Readonly<Record<string, unknown>>): void => {
    const properties = scrub(data);
    devChannel?.info(`${enabled ? 'send' : 'would send'} ${name} ${JSON.stringify(properties)}`);
    if (!enabled || !opts.transport) return;
    opts.transport.send({ name, properties });
  };

  const sender: vscode.TelemetrySender = {
    sendEventData: (eventName: string, data?: Record<string, unknown>) => {
      deliver(eventName, data ?? {});
    },
    sendErrorData: (error: Error, data?: Record<string, unknown>) => {
      deliver('error', { ...data, errorClass: errorClassName(error) });
    },
  };

  const logger = vscode.env.createTelemetryLogger(sender, {
    ignoreBuiltInCommonProperties: true,
    ignoreUnhandledErrors: true,
    additionalCommonProperties: {
      extensionId: opts.extensionId,
      extensionVersion: opts.version,
      vscodeVersion: vscode.version,
      appName: vscode.env.appName,
      installId: getInstallId(context),
    },
  });
  disposables.push(logger);

  let vscodeTelemetryEnabled = vscode.env.isTelemetryEnabled;
  disposables.push(
    vscode.env.onDidChangeTelemetryEnabled((isEnabled) => {
      vscodeTelemetryEnabled = isEnabled;
    }),
  );
  const allowed = (): boolean => vscodeTelemetryEnabled && vscode.env.isTelemetryEnabled;

  return {
    activated: () => {
      if (allowed()) logger.logUsage('activated');
    },
    commandExecuted: (commandId) => {
      if (allowed()) logger.logUsage('command_executed', scrub({ commandId }));
    },
    featureUsed: (feature) => {
      if (allowed()) logger.logUsage('feature_used', scrub({ feature }));
    },
    error: (err) => {
      if (allowed()) logger.logUsage('error', scrub({ errorClass: errorClassName(err) }));
    },
    dispose: () => {
      for (const d of disposables.splice(0)) d.dispose();
    },
  };
}
