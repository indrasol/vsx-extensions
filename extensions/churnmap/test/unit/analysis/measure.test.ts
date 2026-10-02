import { describe, expect, it } from 'vitest';
import { isBinary, measureText } from '../../../src/analysis/measure.js';

// Each expectation is computed by hand from the indentation-complexity rule: depth = tabs + floor(spaces / unit), the unit
// being the most common positive difference in leading spaces between consecutive non-blank lines
// (ties → smaller, clamped to [2, 8], fallback 4; `*` comment-body lines ignored for the unit);
// complexity = 0.6·maxDepth + 0.4·meanDepth, rounded to 3 decimals.
describe('measureText', () => {
  it('2-space indentation: unit 2', () => {
    const text = ['function a() {', '  if (x) {', '    y();', '  }', '}', ''].join('\n');
    // depths 0 1 2 1 0 → max 2, mean 4/5 = 0.8 → 1.2 + 0.32
    expect(measureText(text)).toEqual({ loc: 5, maxDepth: 2, meanDepth: 0.8, complexity: 1.52 });
  });

  it('4-space indentation: unit 4', () => {
    const text = ['def f():', '    if x:', '        return 1', '    return 2'].join('\n');
    // depths 0 1 2 1 → max 2, mean 1 → 1.2 + 0.4
    expect(measureText(text)).toEqual({ loc: 4, maxDepth: 2, meanDepth: 1, complexity: 1.6 });
  });

  it('tabs: one level each', () => {
    const text = 'func() {\n\tif {\n\t\tx\n\t}\n}\n';
    // depths 0 1 2 1 0 → max 2, mean 0.8
    expect(measureText(text)).toEqual({ loc: 5, maxDepth: 2, meanDepth: 0.8, complexity: 1.52 });
  });

  it('mixed tabs and spaces: tabs + spaces / unit', () => {
    const text = 'a\n\tb\n\t  c\n\t    d\n';
    // spaces 0 0 2 4 → unit 2; depths 0, 1, 1+1, 1+2 → max 3, mean 6/4 = 1.5 → 1.8 + 0.6
    expect(measureText(text)).toEqual({ loc: 4, maxDepth: 3, meanDepth: 1.5, complexity: 2.4 });
  });

  it('blank-only text has no lines', () => {
    expect(measureText('\n   \n\t\n\r\n')).toEqual({
      loc: 0,
      maxDepth: 0,
      meanDepth: 0,
      complexity: 0,
    });
    expect(measureText('')).toEqual({ loc: 0, maxDepth: 0, meanDepth: 0, complexity: 0 });
  });

  it('CRLF line endings and blank lines between code', () => {
    const text = 'a\r\n  b\r\n\r\n  c\r\n';
    // spaces 0 2 2 → unit 2; depths 0 1 1 → max 1, mean 2/3 → 0.6 + 0.26667 = 0.867
    expect(measureText(text)).toEqual({ loc: 3, maxDepth: 1, meanDepth: 0.667, complexity: 0.867 });
  });

  it('a single very long line counts as depth 0', () => {
    const text = `${' '.repeat(12)}${'x'.repeat(20_000)}`;
    expect(measureText(text)).toEqual({ loc: 1, maxDepth: 0, meanDepth: 0, complexity: 0 });
  });

  it('a very long line does not set the indent unit', () => {
    const text = `a\n${' '.repeat(3)}${'x'.repeat(10_001)}\n    b\n`;
    // long line ignored for the unit: spaces 0 → 4 gives unit 4; depths 0 0 1 → max 1, mean 1/3
    expect(measureText(text)).toEqual({ loc: 3, maxDepth: 1, meanDepth: 0.333, complexity: 0.733 });
  });

  it('falls back to a 4-space unit when no two lines differ', () => {
    // Every line has 8 spaces: no positive difference, so 8 / 4 = depth 2 each.
    expect(measureText('        a\n        b\n')).toEqual({
      loc: 2,
      maxDepth: 2,
      meanDepth: 2,
      complexity: 2,
    });
  });

  it('ignores JSDoc " * " body lines when finding the unit', () => {
    const text = ['  /**', '   * Doc', '   */', '  run() {', '    go();', '  }'].join('\n');
    // unit lines: spaces 2 2 4 2 → differences 2, 2 → unit 2; depths floor(s/2): 1 1 1 1 2 1
    // → max 2, mean 7/6 → 1.2 + 0.46667
    expect(measureText(text)).toEqual({ loc: 6, maxDepth: 2, meanDepth: 1.167, complexity: 1.667 });
  });

  it('uses the most common difference, not the smallest', () => {
    // spaces 0 4 8 4 0 6 → differences 4 4 4 4 6 → unit 4 (a stray 6 does not win)
    const text = ['a', '    b', '        c', '    d', 'e', '      f'].join('\n');
    // depths 0 1 2 1 0 1 → max 2, mean 5/6
    expect(measureText(text)).toEqual({ loc: 6, maxDepth: 2, meanDepth: 0.833, complexity: 1.533 });
  });

  it('breaks ties towards the smaller difference', () => {
    // spaces 0 2 0 4 → differences 2 2 4 4 → tie → unit 2; depths 0 1 0 2
    const text = ['a', '  b', 'c', '    d'].join('\n');
    expect(measureText(text)).toEqual({ loc: 4, maxDepth: 2, meanDepth: 0.75, complexity: 1.5 });
  });

  it('clamps the unit to [2, 8]', () => {
    // 1-space steps → unit clamped up to 2: spaces 0 1 2 3 → depths 0 0 1 1
    expect(measureText('a\n b\n  c\n   d\n')).toEqual({
      loc: 4,
      maxDepth: 1,
      meanDepth: 0.5,
      complexity: 0.8,
    });
    // 12-space steps → unit clamped down to 8: spaces 0 12 24 → depths 0 1 3
    const wide = `a\n${' '.repeat(12)}b\n${' '.repeat(24)}c\n`;
    expect(measureText(wide)).toEqual({
      loc: 3,
      maxDepth: 3,
      meanDepth: 1.333,
      complexity: 2.333,
    });
  });
});

describe('isBinary', () => {
  it('detects a NUL byte in PNG-like bytes', () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);
    expect(isBinary(png)).toBe(true);
  });

  it('treats text, including UTF-8, as text', () => {
    expect(isBinary(Buffer.from('olá, 世界\n'))).toBe(false);
    expect(isBinary(Buffer.alloc(0))).toBe(false);
  });

  it('only looks at the first 8 KiB', () => {
    const buf = Buffer.concat([Buffer.alloc(8 * 1024, 0x61), Buffer.from([0])]);
    expect(isBinary(buf)).toBe(false);
  });
});
