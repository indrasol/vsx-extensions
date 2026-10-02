import { describe, expect, it } from 'vitest';
import {
  argPath,
  escapeMarkdown,
  type HotspotNode,
  hotspotAccessibilityLabel,
  hotspotChildren,
  hotspotDescription,
  hotspotLabel,
  hotspotTooltip,
  itemSpec,
  nodePath,
  bandColor,
  trendText,
} from '../../../src/panel/hotspotTree.js';
import { hotspot } from './helpers.js';

describe('hotspot labels', () => {
  it('labels a rising hotspot with rank, path, score, trend and two owners', () => {
    const h = hotspot(3, 'billing/invoice.ts');
    expect(hotspotLabel(h)).toBe('#3  billing/invoice.ts');
    expect(hotspotDescription(h)).toBe('Hotspot 82 · Complexity rising ↑ · alice, bob');
    expect(hotspotAccessibilityLabel(h)).toBe(
      'Rank 3, billing/invoice.ts, Hotspot, score 82, complexity rising; reasons: Changed 41 times in 90 days; Rewritten about 2× in 90 days; owners: alice, bob.',
    );
  });

  it('words flat, falling and unknown trends', () => {
    expect(hotspotDescription(hotspot(1, 'a.ts', { trend: 'flat', owners: ['carol'] }))).toBe(
      'Hotspot 82 · Complexity steady · carol',
    );
    expect(hotspotDescription(hotspot(1, 'a.ts', { trend: 'falling' }))).toContain(
      'Complexity falling ↓',
    );
    const unknown = hotspot(2, 'a.ts', { trend: 'unknown', owners: [], band: 'watch' });
    expect(hotspotDescription(unknown)).toBe('Watch 82 · —');
    expect(hotspotAccessibilityLabel(unknown)).toBe(
      'Rank 2, a.ts, Watch, score 82, trend unknown; reasons: Changed 41 times in 90 days; Rewritten about 2× in 90 days.',
    );
  });

  it('shows one owner, and at most two', () => {
    expect(hotspotDescription(hotspot(1, 'a.ts', { owners: ['alice'] }))).toBe(
      'Hotspot 82 · Complexity rising ↑ · alice',
    );
    const three = hotspot(1, 'a.ts', { owners: ['a', 'b', 'c'] });
    expect(hotspotDescription(three)).toBe('Hotspot 82 · Complexity rising ↑ · a, b');
    expect(hotspotAccessibilityLabel(three)).toMatch(/owners: a, b\.$/);
  });

  it('colours the flame by relative band', () => {
    expect(bandColor('hotspot')).toBe('charts.red');
    expect(bandColor('watch')).toBe('charts.orange');
    expect(bandColor('stable')).toBe('charts.foreground');
    expect(trendText('unknown')).toBe('—');
  });

  it('builds a Markdown tooltip with every reason, lines, commits and window; paths escaped', () => {
    const md = hotspotTooltip(hotspot(1, 'src/[x]_y.ts'), 90);
    expect(md).toContain('**#1 src/\\[x\\]\\_y\\.ts**');
    expect(md).toContain('Hotspot · score 82.4');
    expect(md).toContain('- Changed 41 times in 90 days (more often than 98% of files)');
    expect(md).toContain(
      '- Rewritten about 2× in 90 days (\\~900 lines added or removed vs 1,234 lines today)',
    );
    expect(md).toContain('1,234 lines · People 3 · changed 41 times in the last 90 days');
    expect(md).toContain('Complexity rising ↑ (compared with the start of the window)');
    expect(md).not.toMatch(/\btop \d+%/);
    expect(md).toContain('Owners: alice, bob');
    expect(md).not.toMatch(/<[a-z]/i);
    expect(hotspotTooltip(hotspot(1, 'a.ts', { owners: [] }), 30)).not.toContain('Owners');
    expect(escapeMarkdown('a|b<c>')).toBe('a\\|b\\<c\\>');
  });
});

describe('tree nodes', () => {
  it('gives each reason a child node, plus a folded note for folded leaves', () => {
    const h = hotspot(1, 'src/a.ts', { reasons: ['r1', 'r2', 'r3'] });
    const children = hotspotChildren(h);
    expect(children.map((c) => c.kind)).toEqual(['reason', 'reason', 'reason']);
    const folded = hotspotChildren(h, 12);
    expect(folded).toHaveLength(4);
    expect(folded[3]).toEqual({ kind: 'meta', parent: 'src/a.ts', text: 'folded: 12 files' });
    expect(hotspotChildren(h, 0)).toHaveLength(3);
  });

  it('gives every node an icon, a stable id and a non-empty screen-reader label', () => {
    const h = hotspot(1, 'src/a.ts', { score: 90 });
    const nodes: HotspotNode[] = [{ kind: 'hotspot', hotspot: h }, ...hotspotChildren(h, 3)];
    const specs = nodes.map(itemSpec);
    expect(specs.map((s) => s.id)).toEqual([
      'hotspot:src/a.ts',
      'reason:src/a.ts:frequency',
      'reason:src/a.ts:relChurn',
      'meta:src/a.ts',
    ]);
    for (const spec of specs) {
      expect(spec.accessibilityLabel.length).toBeGreaterThan(0);
      expect(spec.accessibilityLabel).not.toMatch(/\$\(|[↑↓→]/);
    }
    expect(specs[0]).toMatchObject({
      icon: 'flame',
      iconColor: 'charts.red',
      contextValue: 'hotspot',
      collapsible: true,
    });
    expect(specs[1]).toMatchObject({
      icon: 'info',
      label: 'Changed 41 times in 90 days',
      description: 'more often than 98% of files',
    });
    expect(specs[3]?.label).toBe('folded: 3 files');
    expect(nodes.map(nodePath)).toEqual(['src/a.ts', 'src/a.ts', 'src/a.ts', 'src/a.ts']);
  });

  it('reads the path from a string or a tree node, nothing else', () => {
    const h = hotspot(1, 'src/a.ts');
    expect(argPath('x/y.ts')).toBe('x/y.ts');
    expect(argPath({ kind: 'hotspot', hotspot: h })).toBe('src/a.ts');
    expect(argPath(hotspotChildren(h)[0])).toBe('src/a.ts');
    for (const bad of [
      undefined,
      null,
      3,
      {},
      { kind: 'hotspot' },
      { kind: 'reason', parent: 1 },
      { kind: 'x' },
    ]) {
      expect(argPath(bad)).toBeUndefined();
    }
  });
});

describe('ignored nodes', () => {
  const now = Date.UTC(2026, 8, 30);
  const entry = {
    path: 'src/billing/invoice.ts',
    reason: 'rewrite in Q4',
    until: now + 30 * 86_400_000,
  };

  it('groups ignored files under "Ignored (N)" with days left and the reason', () => {
    const group = itemSpec({ kind: 'ignoredGroup', count: 2 }, now);
    expect(group).toMatchObject({ id: 'ignored', label: 'Ignored (2)', collapsible: true });
    const item = itemSpec({ kind: 'ignored', entry }, now);
    expect(item).toMatchObject({
      id: 'ignored:src/billing/invoice.ts',
      label: 'src/billing/invoice.ts',
      description: '30 d left · rewrite in Q4',
      contextValue: 'ignoredHotspot',
      collapsible: false,
    });
    expect(item.accessibilityLabel).toBe(
      'Ignored src/billing/invoice.ts until 2026-10-30, 30 days left; reason: rewrite in Q4.',
    );
    expect(itemSpec({ kind: 'ignored', entry: { ...entry, reason: '' } }, now).description).toBe(
      '30 d left · no reason given',
    );
    expect(group.accessibilityLabel.length).toBeGreaterThan(0);
  });

  it('gives the path of an ignored item, none for the group', () => {
    expect(nodePath({ kind: 'ignored', entry })).toBe(entry.path);
    expect(nodePath({ kind: 'ignoredGroup', count: 1 })).toBeUndefined();
    expect(argPath({ kind: 'ignored', entry })).toBe(entry.path);
    expect(argPath({ kind: 'ignored' })).toBeUndefined();
    expect(argPath({ kind: 'ignoredGroup', count: 1 })).toBeUndefined();
  });
});
