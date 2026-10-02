import { describe, expect, it } from 'vitest';
import {
  AGENT_RULES,
  CONTEXT_FOOTER,
  renderHotspotsJson,
  renderHotspotsMd,
} from '../../../src/ai/agentContext.js';
import { analysis, fileScore } from './helpers.js';

const result = analysis([
  fileScore('src/core/engine.ts', 91.3, { commits: 41, loc: 400, authors: 4 }),
  fileScore('src/api/a|b.ts', 70),
  fileScore('docs/guide.md', 0, { eligible: false, why: 'docs' }),
]);

describe('renderHotspotsJson', () => {
  it('has version 1, the analysis identity and the top list with paths and numbers only', () => {
    const json = renderHotspotsJson(result);
    expect(json).toMatchObject({
      version: 1,
      generatedAt: '2026-09-30T00:00:00.000Z',
      repoRoot: '/work/my-repo',
      head: 'a'.repeat(40),
      window: 90,
    });
    expect(json.top).toHaveLength(2);
    expect(json.top[0]).toEqual({
      rank: 1,
      path: 'src/core/engine.ts',
      score: 91.3,
      band: 'hotspot',
      reasons: expect.arrayContaining(['Changed 41 times in 90 days']) as unknown,
      loc: 400,
      commits: 41,
      authors: 4,
      trend: 'rising',
    });
    expect(Object.keys(json.top[0] ?? {}).sort()).toEqual(
      ['authors', 'band', 'commits', 'loc', 'path', 'rank', 'reasons', 'score', 'trend'].sort(),
    );
  });

  it('round-trips through JSON', () => {
    const json = renderHotspotsJson(result);
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });
});

describe('renderHotspotsMd', () => {
  const md = renderHotspotsMd(result);

  it('explains what it is and when it was generated', () => {
    expect(md.startsWith('# Code hotspots\n')).toBe(true);
    expect(md).toContain('last 90 days of git history');
    expect(md).toContain('Generated 2026-09-30T00:00:00.000Z at commit aaaaaaaaaaaa.');
  });

  it('has the top list as a table with escaped cells, the rules and the footer', () => {
    expect(md).toContain('| # | File | Score | Band | Why |');
    expect(md).toMatch(/\| 1 \| src\/core\/engine\.ts \| 91 \| Hotspot \| Changed 41 times/);
    expect(md).toContain('src/api/a\\|b.ts');
    expect(md).not.toContain('docs/guide.md');
    expect(md).toContain(AGENT_RULES);
    expect(md.trimEnd().endsWith(CONTEXT_FOOTER)).toBe(true);
  });

  it('names ignored files and handles an empty list', () => {
    expect(renderHotspotsMd(result, [{ path: 'src/legacy.ts', reason: 'x', until: 0 }])).toContain(
      'Left out on purpose (ignored in Churnmap): src/legacy.ts.',
    );
    expect(renderHotspotsMd(analysis([]))).toContain('No hotspots in this window.');
  });
});
