import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  INSTALL_ID_KEY,
  createTelemetry,
  isPathLike,
  scrub,
  type TelemetryEvent,
  type TelemetryTransport,
} from '../src/telemetry.js';
import { asChannel, asContext } from './helpers.js';
import { ExtensionMode, createContext, createMockChannel, mock } from './vscode.mock.js';

const base = { extensionId: 'Indrasol.sample', version: '1.2.3' };

function spyTransport(): {
  transport: TelemetryTransport;
  send: Mock<(event: TelemetryEvent) => void>;
} {
  const send = vi.fn<(event: TelemetryEvent) => void>();
  return { transport: { send }, send };
}

function exercise(t: ReturnType<typeof createTelemetry>): void {
  t.activated();
  t.commandExecuted('sample.run');
  t.featureUsed('preview');
  t.error(new RangeError('/Users/someone/secret.txt'));
}

beforeEach(() => {
  mock.reset();
});

describe('createTelemetry', () => {
  it('sends nothing with the default options', () => {
    const { transport, send } = spyTransport();
    const t = createTelemetry(asContext(createContext()), { ...base, transport });
    exercise(t);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when enabled but VS Code telemetry is off', () => {
    const { transport, send } = spyTransport();
    mock.setTelemetryEnabled(false);
    const t = createTelemetry(asContext(createContext()), { ...base, enabled: true, transport });
    exercise(t);
    const logger = mock.telemetryLoggers[0]?.logger as { logUsage: ReturnType<typeof vi.fn> };
    expect(logger.logUsage).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('stops sending when VS Code telemetry is switched off at runtime', () => {
    const { transport, send } = spyTransport();
    const t = createTelemetry(asContext(createContext()), { ...base, enabled: true, transport });
    t.activated();
    expect(send).toHaveBeenCalledTimes(1);
    mock.setTelemetryEnabled(false);
    exercise(t);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends allowed events with scrubbed, path-free properties when enabled', () => {
    const { transport, send } = spyTransport();
    const t = createTelemetry(asContext(createContext()), { ...base, enabled: true, transport });
    exercise(t);
    const events = send.mock.calls.map(([e]) => e as { name: string; properties: object });
    expect(events.map((e) => e.name)).toEqual([
      'activated',
      'command_executed',
      'feature_used',
      'error',
    ]);
    expect(events[1]?.properties).toMatchObject({ commandId: 'sample.run' });
    expect(events[3]?.properties).toMatchObject({ errorClass: 'RangeError' });
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('reports errors from sendErrorData by class name only', () => {
    const { transport, send } = spyTransport();
    createTelemetry(asContext(createContext()), { ...base, enabled: true, transport });
    const sender = mock.telemetryLoggers[0]?.sender;
    sender?.sendErrorData(new SyntaxError('at C:\\Users\\x'), { stack: '/a/b' });
    const properties = send.mock.calls[0]?.[0].properties;
    expect(properties).toEqual({ errorClass: 'SyntaxError' });
  });

  it('limits common properties and never includes machineId', () => {
    createTelemetry(asContext(createContext()), base);
    const options = mock.telemetryLoggers[0]?.options as {
      ignoreBuiltInCommonProperties: boolean;
      additionalCommonProperties: Record<string, unknown>;
    };
    expect(options.ignoreBuiltInCommonProperties).toBe(true);
    expect(Object.keys(options.additionalCommonProperties).sort()).toEqual([
      'appName',
      'extensionId',
      'extensionVersion',
      'installId',
      'vscodeVersion',
    ]);
    expect(options.additionalCommonProperties).not.toHaveProperty('machineId');
    expect(options.additionalCommonProperties).toMatchObject({
      extensionId: 'Indrasol.sample',
      extensionVersion: '1.2.3',
      vscodeVersion: '1.96.0',
      appName: 'Visual Studio Code',
    });
  });

  it('creates the install id once and reuses it', () => {
    const ctx = createContext();
    createTelemetry(asContext(ctx), base);
    createTelemetry(asContext(ctx), base);
    const ids = mock.telemetryLoggers.map(
      (l) => (l.options.additionalCommonProperties as { installId: string }).installId,
    );
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[1]).toBe(ids[0]);
    expect(ctx.globalState.update).toHaveBeenCalledTimes(1);
    expect(ctx.globalState.update).toHaveBeenCalledWith(INSTALL_ID_KEY, ids[0]);
  });

  it('shows what would be sent in development mode without sending', () => {
    const { transport, send } = spyTransport();
    const devChannel = createMockChannel();
    const t = createTelemetry(asContext(createContext(ExtensionMode.Development)), {
      ...base,
      transport,
      devChannel: asChannel(devChannel),
    });
    t.featureUsed('preview');
    expect(devChannel.info).toHaveBeenCalledWith(
      expect.stringContaining('would send feature_used'),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('creates and disposes its own dev channel and subscriptions', () => {
    const t = createTelemetry(asContext(createContext(ExtensionMode.Development)), base);
    expect(mock.channels).toHaveLength(1);
    t.dispose();
    expect(mock.channels[0]?.dispose).toHaveBeenCalled();
    const logger = mock.telemetryLoggers[0]?.logger as { dispose: ReturnType<typeof vi.fn> };
    expect(logger.dispose).toHaveBeenCalled();
  });

  it('writes nothing to a channel in production mode', () => {
    createTelemetry(asContext(createContext()), base).activated();
    expect(mock.channels).toHaveLength(0);
  });
});

describe('scrub', () => {
  it('rejects path-like strings', () => {
    expect(
      scrub({
        posix: '/Users/someone/project',
        relative: 'src/index.ts',
        windows: 'C:\\Users\\someone',
        drive: 'd:',
        unc: '\\\\server\\share',
      }),
    ).toEqual({});
  });

  it('rejects strings longer than 200 characters', () => {
    expect(scrub({ ok: 'a'.repeat(200), long: 'a'.repeat(201) })).toEqual({ ok: 'a'.repeat(200) });
  });

  it('keeps short plain strings, numbers and booleans, and drops other types', () => {
    expect(
      scrub({
        commandId: 'sample.run',
        appName: 'Visual Studio Code',
        version: '1.96.0',
        count: 3,
        flag: false,
        obj: { a: 1 },
        nothing: undefined,
      }),
    ).toEqual({
      commandId: 'sample.run',
      appName: 'Visual Studio Code',
      version: '1.96.0',
      count: 3,
      flag: false,
    });
  });

  it('detects paths but not ordinary colons', () => {
    expect(isPathLike('C:\\x')).toBe(true);
    expect(isPathLike('see e:foo')).toBe(true);
    expect(isPathLike('error:foo')).toBe(false);
    expect(isPathLike('12:30')).toBe(false);
  });
});
