import { describe, expect, it } from 'vitest';
import {
  formatSize,
  postcardFileName,
  postcardLabel,
  postcardTop,
} from '../../../src/export/labels.js';
import { hotspot } from '../panel/helpers.js';

describe('postcard labels', () => {
  it('reduces a path to the chosen detail', () => {
    expect(postcardLabel('src/billing/invoice.ts', 1, 'paths')).toBe('src/billing/invoice.ts');
    expect(postcardLabel('src/billing/invoice.ts', 1, 'districts')).toBe('src');
    expect(postcardLabel('README.md', 2, 'districts')).toBe('(root)');
    expect(postcardLabel('src/billing/invoice.ts', 3, 'none')).toBe('#3');
  });

  it('sends only the top three, with whole scores', () => {
    const top = [
      hotspot(1, 'src/a.ts', { score: 91.6 }),
      hotspot(2, 'lib/b.ts', { score: 80.2 }),
      hotspot(3, 'c.ts', { score: 70 }),
      hotspot(4, 'src/d.ts'),
    ];
    expect(postcardTop(top, 'districts')).toEqual([
      { rank: 1, label: 'src', score: 92, heat: 95 },
      { rank: 2, label: 'lib', score: 80, heat: 95 },
      { rank: 3, label: '(root)', score: 70, heat: 95 },
    ]);
    expect(postcardTop(top, 'none').map((t) => t.label)).toEqual(['#1', '#2', '#3']);
    expect(postcardTop(top, 'paths').map((t) => t.label)).toEqual(['src/a.ts', 'lib/b.ts', 'c.ts']);
    expect(postcardTop([], 'paths')).toEqual([]);
  });
});

describe('postcardFileName', () => {
  it('makes a safe file name from any repository name', () => {
    expect(postcardFileName('shop', '2026-09-30')).toBe('churnmap-shop-2026-09-30.png');
    expect(postcardFileName('My Repo (old)', '2026-09-30')).toBe(
      'churnmap-my-repo-old-2026-09-30.png',
    );
    expect(postcardFileName('Café Überblick', '2026-01-02')).toBe(
      'churnmap-cafe-uberblick-2026-01-02.png',
    );
    expect(postcardFileName('日本語', '2026-01-02')).toBe('churnmap-repo-2026-01-02.png');
    expect(postcardFileName('../../etc/passwd', '2026-01-02')).toBe(
      'churnmap-etc-passwd-2026-01-02.png',
    );
    expect(postcardFileName('x'.repeat(200), '2026-01-02')).toHaveLength(
      'churnmap--2026-01-02.png'.length + 60,
    );
  });
});

describe('formatSize', () => {
  it('uses MB from 100 KB, else KB', () => {
    expect(formatSize(1.1 * 1024 * 1024)).toBe('1.1 MB');
    expect(formatSize(412 * 1024)).toBe('0.4 MB');
    expect(formatSize(50 * 1024)).toBe('50 KB');
    expect(formatSize(10)).toBe('1 KB');
  });
});
