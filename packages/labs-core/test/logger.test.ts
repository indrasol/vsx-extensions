import { beforeEach, describe, expect, it } from 'vitest';
import { createLogger, describeError, errorClassName } from '../src/logger.js';
import { asChannel } from './helpers.js';
import { createMockChannel, mock, window } from './vscode.mock.js';

class ConfigError extends Error {}

beforeEach(() => {
  mock.reset();
});

describe('createLogger', () => {
  it('creates a log output channel so the user log level applies', () => {
    createLogger('My Ext');
    expect(window.createOutputChannel).toHaveBeenCalledWith('My Ext', { log: true });
  });

  it('routes each level to the matching channel method', () => {
    const channel = createMockChannel();
    const log = createLogger('x', { channel: asChannel(channel) });
    log.trace('t', 1);
    log.debug('d');
    log.info('i', { a: 1 });
    log.warn('w');
    expect(channel.trace).toHaveBeenCalledWith('t', 1);
    expect(channel.debug).toHaveBeenCalledWith('d');
    expect(channel.info).toHaveBeenCalledWith('i', { a: 1 });
    expect(channel.warn).toHaveBeenCalledWith('w');
    expect(channel.error).not.toHaveBeenCalled();
  });

  it('logs errors as class name and message, without the stack by default', () => {
    const channel = createMockChannel();
    const log = createLogger('x', { channel: asChannel(channel) });
    const err = new ConfigError('bad value');
    err.stack = 'ConfigError: bad value\n    at /Users/someone/project/src/file.ts:1:1';
    log.error(err, 'Loading config');
    expect(channel.error).toHaveBeenCalledWith('Loading config: ConfigError: bad value');
    expect(String(channel.error.mock.calls[0]?.[0])).not.toContain('/Users/');
  });

  it('includes the stack only when includeStacks is set', () => {
    const channel = createMockChannel();
    const log = createLogger('x', { channel: asChannel(channel), includeStacks: true });
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at /tmp/a.js:1:1';
    log.error(err);
    expect(channel.error).toHaveBeenCalledWith('Error: boom\nError: boom\n    at /tmp/a.js:1:1');
  });

  it('accepts non-Error values', () => {
    const channel = createMockChannel();
    const log = createLogger('x', { channel: asChannel(channel) });
    log.error('plain string');
    log.error({ secret: 'x' });
    expect(channel.error).toHaveBeenNthCalledWith(1, 'plain string');
    expect(channel.error).toHaveBeenNthCalledWith(2, 'Non-Error value (object)');
  });

  it('shows the channel and disposes only a channel it created', () => {
    const external = createMockChannel();
    const log = createLogger('x', { channel: asChannel(external) });
    log.show(true);
    log.dispose();
    expect(external.show).toHaveBeenCalledWith(true);
    expect(external.dispose).not.toHaveBeenCalled();

    const own = createLogger('y');
    own.dispose();
    expect(mock.channels[0]?.dispose).toHaveBeenCalled();
  });
});

describe('error helpers', () => {
  it('names error classes', () => {
    expect(errorClassName(new ConfigError('x'))).toBe('ConfigError');
    expect(errorClassName(new TypeError('x'))).toBe('TypeError');
    expect(errorClassName(new Error('x'))).toBe('Error');
    expect(errorClassName(42)).toBe('number');
    expect(describeError(new Error(''))).toBe('Error');
  });
});
