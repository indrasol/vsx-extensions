import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PANELS,
  isCorner,
  isIgnoredList,
  isPanelPrefs,
  panelPrefsOrDefault,
  isPngBuffer,
  isPostcardDetail,
  isRepoRelativePath,
  MAX_IGNORED,
  MAX_POSTCARD_BYTES,
  PNG_SIGNATURE,
  isWebviewToHost,
  MAX_PATH_LENGTH,
  MAX_SHORT_STRING,
  toShortString,
} from '../../../src/city/protocol.js';

describe('isRepoRelativePath', () => {
  it('accepts repository-relative paths', () => {
    for (const p of ['a.ts', 'src/core/engine.ts', 'docs/ünïcode ✓.md', '.github/ci.yml', 'a/…']) {
      expect(isRepoRelativePath(p), p).toBe(true);
    }
    expect(isRepoRelativePath('a'.repeat(MAX_PATH_LENGTH))).toBe(true);
  });

  it('rejects traversal, absolute, oversize and non-string paths', () => {
    for (const p of [
      '',
      '..',
      '../secret',
      'src/../../etc/passwd',
      'src/..',
      './a.ts',
      'a//b',
      '/etc/passwd',
      'C:/Windows/win.ini',
      'c:relative',
      'src\\..\\x',
      'a\0b',
      'a'.repeat(MAX_PATH_LENGTH + 1),
      42,
      null,
      undefined,
      ['a.ts'],
      { path: 'a.ts' },
    ]) {
      expect(isRepoRelativePath(p), typeof p === 'string' ? p : typeof p).toBe(false);
    }
  });
});

describe('isWebviewToHost', () => {
  it('accepts every well-formed message', () => {
    expect(isWebviewToHost({ type: 'ready' })).toBe(true);
    expect(isWebviewToHost({ type: 'rendered', buildings: 12, ms: 3.5 })).toBe(true);
    expect(isWebviewToHost({ type: 'openFile', path: 'src/a.ts' })).toBe(true);
    expect(isWebviewToHost({ type: 'error', message: 'WebGL unavailable' })).toBe(true);
    for (const window of [30, 90, 365]) {
      expect(isWebviewToHost({ type: 'setWindow', window })).toBe(true);
    }
    expect(isWebviewToHost({ type: 'hover', path: 'src/a.ts' })).toBe(true);
    expect(isWebviewToHost({ type: 'hover', path: 'src/big/…' })).toBe(true);
    expect(isWebviewToHost({ type: 'hover', path: null })).toBe(true);
  });

  it('accepts viewChanged with a known mode only', () => {
    expect(isWebviewToHost({ type: 'viewChanged', mode: '2d' })).toBe(true);
    expect(isWebviewToHost({ type: 'viewChanged', mode: '3d' })).toBe(true);
    for (const m of [
      { type: 'viewChanged', mode: '4d' },
      { type: 'viewChanged', mode: '2D' },
      { type: 'viewChanged' },
      { type: 'viewChanged', mode: '2d', extra: true },
      { type: 'view', mode: '2d' }, // host → webview only
    ]) {
      expect(isWebviewToHost(m), JSON.stringify(m)).toBe(false);
    }
  });

  it('accepts rankCodeOnly with no payload only (the HUD ranking chip)', () => {
    expect(isWebviewToHost({ type: 'rankCodeOnly' })).toBe(true);
    expect(isWebviewToHost({ type: 'rankCodeOnly', rank: 'all' })).toBe(false);
  });

  it('accepts selectRepository with no payload only (the HUD switch button)', () => {
    expect(isWebviewToHost({ type: 'selectRepository' })).toBe(true);
    for (const m of [
      { type: 'selectRepository', root: '/etc' },
      { type: 'selectRepository', path: 'app' },
      { type: 'selectrepository' },
    ]) {
      expect(isWebviewToHost(m), JSON.stringify(m)).toBe(false);
    }
  });

  it('rejects bad setWindow and hover messages', () => {
    for (const m of [
      { type: 'setWindow', window: 60 },
      { type: 'setWindow', window: '30' },
      { type: 'setWindow' },
      { type: 'hover', path: '../etc/passwd' },
      { type: 'hover', path: '/abs' },
      { type: 'hover', path: '' },
      { type: 'hover' },
      { type: 'hover', path: undefined },
    ]) {
      expect(isWebviewToHost(m), JSON.stringify(m)).toBe(false);
    }
  });

  it('accepts test:stats only in test mode, with flat finite values', () => {
    const stats = { type: 'test:stats', stats: { frames: 3, animating: false } };
    expect(isWebviewToHost(stats)).toBe(false);
    expect(isWebviewToHost(stats, { test: true })).toBe(true);
    expect(isWebviewToHost({ type: 'test:stats', stats: { x: 'text' } }, { test: true })).toBe(
      false,
    );
    expect(isWebviewToHost({ type: 'test:stats', stats: { x: Infinity } }, { test: true })).toBe(
      false,
    );
    expect(isWebviewToHost({ type: 'test:stats', stats: { x: { y: 1 } } }, { test: true })).toBe(
      false,
    );
    expect(isWebviewToHost({ type: 'test:emit', payload: { type: 'ready' } }, { test: true })).toBe(
      false,
    );
  });

  it('rejects unknown types, extra keys and bad fields', () => {
    for (const m of [
      null,
      'ready',
      [],
      {},
      { type: 42 },
      { type: 'nope' },
      { type: 'ready', extra: 1 },
      { type: 'rendered', buildings: -1, ms: 1 },
      { type: 'rendered', buildings: 1.5, ms: 1 },
      { type: 'rendered', buildings: 1, ms: Number.NaN },
      { type: 'rendered', buildings: 1 },
      { type: 'openFile', path: '../x' },
      { type: 'openFile', path: '/abs' },
      { type: 'openFile', path: 7 },
      { type: 'openFile', path: 'a.ts', contents: 'secret' },
      { type: 'error', message: 'x'.repeat(MAX_SHORT_STRING + 1) },
      { type: 'error' },
      { type: 'toString' },
      { type: '__proto__' },
    ]) {
      expect(isWebviewToHost(m), JSON.stringify(m)).toBe(false);
    }
  });
});

describe('toShortString', () => {
  it('keeps short text and cuts long text to the limit', () => {
    expect(toShortString('ok')).toBe('ok');
    const cut = toShortString('y'.repeat(500));
    expect(cut).toHaveLength(MAX_SHORT_STRING);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('isIgnoredList', () => {
  const entry = { path: 'src/a.ts', reason: 'rewrite in Q4', until: 1_800_000_000_000 };

  it('accepts a list of exact { path, reason, until } entries', () => {
    expect(isIgnoredList([])).toBe(true);
    expect(isIgnoredList([entry, { ...entry, path: 'b.ts', reason: '' }])).toBe(true);
    expect(isIgnoredList(Array.from({ length: MAX_IGNORED }, () => entry))).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of [
      undefined,
      null,
      {},
      'src/a.ts',
      [null],
      [{ ...entry, extra: 1 }],
      [{ path: entry.path, reason: entry.reason }],
      [{ ...entry, path: '../x' }],
      [{ ...entry, path: '/etc/passwd' }],
      [{ ...entry, reason: 'x'.repeat(MAX_SHORT_STRING + 1) }],
      [{ ...entry, reason: 3 }],
      [{ ...entry, until: Number.NaN }],
      [{ ...entry, until: '2027-01-01' }],
      Array.from({ length: MAX_IGNORED + 1 }, () => entry),
    ]) {
      expect(isIgnoredList(bad)).toBe(false);
    }
  });
});

describe('postcard messages', () => {
  const png = (size = 64): ArrayBuffer => {
    const bytes = new Uint8Array(size);
    bytes.set(PNG_SIGNATURE.slice(0, size));
    return bytes.buffer;
  };
  const result = { type: 'postcardResult', png: png(), width: 1600, height: 900, ms: 120 };

  it('accepts a PNG ArrayBuffer of at most 4 MiB', () => {
    expect(isPngBuffer(png())).toBe(true);
    expect(isPngBuffer(png(MAX_POSTCARD_BYTES))).toBe(true);
    expect(isPngBuffer(png(MAX_POSTCARD_BYTES + 1))).toBe(false);
    expect(isPngBuffer(new ArrayBuffer(64))).toBe(false); // no signature
    expect(isPngBuffer(png(4))).toBe(false); // shorter than the signature
    expect(isPngBuffer(new Uint8Array(png()))).toBe(false); // a view, not the buffer
    expect(isPngBuffer('\x89PNG')).toBe(false);
    expect(isPngBuffer(null)).toBe(false);
  });

  it('guards postcardResult: exact keys, PNG bytes, exactly 1600×900', () => {
    expect(isWebviewToHost(result)).toBe(true);
    expect(isWebviewToHost({ ...result, width: 1599 })).toBe(false);
    expect(isWebviewToHost({ ...result, height: 1000 })).toBe(false);
    expect(isWebviewToHost({ ...result, png: new ArrayBuffer(10) })).toBe(false);
    expect(isWebviewToHost({ ...result, png: 'data:image/png;base64,' })).toBe(false);
    expect(isWebviewToHost({ ...result, ms: -1 })).toBe(false);
    expect(isWebviewToHost({ ...result, path: '/tmp/x.png' })).toBe(false);
    expect(isWebviewToHost({ type: 'postcardError', message: 'no WebGL' })).toBe(true);
    expect(
      isWebviewToHost({ type: 'postcardError', message: 'x'.repeat(MAX_SHORT_STRING + 1) }),
    ).toBe(false);
  });

  it('knows the three detail levels', () => {
    expect(['paths', 'districts', 'none'].every(isPostcardDetail)).toBe(true);
    expect(isPostcardDetail('all')).toBe(false);
    expect(isPostcardDetail(undefined)).toBe(false);
  });
});

describe('panel prefs', () => {
  it('accepts setPanels with exactly the three panels, a corner and two flags each', () => {
    expect(isWebviewToHost({ type: 'setPanels', panels: DEFAULT_PANELS })).toBe(true);
    const moved = { ...DEFAULT_PANELS, card: { corner: 'tr', collapsed: true, hidden: false } };
    expect(isWebviewToHost({ type: 'setPanels', panels: moved })).toBe(true);
    for (const bad of [
      { ...DEFAULT_PANELS, card: { corner: 'middle', collapsed: false, hidden: false } },
      { ...DEFAULT_PANELS, card: { corner: 'tl', collapsed: 'yes', hidden: false } },
      { ...DEFAULT_PANELS, extra: DEFAULT_PANELS.card },
      { card: DEFAULT_PANELS.card },
    ]) {
      expect(isWebviewToHost({ type: 'setPanels', panels: bad })).toBe(false);
    }
    expect(isWebviewToHost({ type: 'setPanels', panels: DEFAULT_PANELS, x: 1 })).toBe(false);
  });

  it('falls back to the defaults for anything missing or malformed', () => {
    expect(panelPrefsOrDefault(undefined)).toEqual(DEFAULT_PANELS);
    const rail = { corner: 'bl', collapsed: true, hidden: true };
    expect(panelPrefsOrDefault({ rail, card: 3 })).toEqual({ ...DEFAULT_PANELS, rail });
    expect(isPanelPrefs(DEFAULT_PANELS)).toBe(true);
    expect(isCorner('br')).toBe(true);
    expect(isCorner('center')).toBe(false);
  });

  it('accepts test:boxes only in test mode, with finite named boxes', () => {
    const boxes = {
      type: 'test:boxes',
      width: 360,
      height: 640,
      boxes: [{ name: 'hud:x', x: 1, y: 2, w: 3, h: 4 }],
    };
    expect(isWebviewToHost(boxes)).toBe(false);
    expect(isWebviewToHost(boxes, { test: true })).toBe(true);
    expect(
      isWebviewToHost(
        { ...boxes, boxes: [{ name: 'x', x: Number.NaN, y: 0, w: 0, h: 0 }] },
        { test: true },
      ),
    ).toBe(false);
  });
});
