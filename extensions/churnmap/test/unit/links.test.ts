import { describe, expect, it } from 'vitest';
import { LABS_BASE, links, MORE_FROM_LABS_LINKS, type Placement } from '../../src/links.js';

const PLACEMENTS: Placement[] = ['panel', 'walkthrough', 'readme', 'notfound', 'postcard'];

describe('links', () => {
  it('uses the first-party labs.indrasol.com short links', () => {
    expect(LABS_BASE).toBe('https://labs.indrasol.com');
  });

  it.each(PLACEMENTS)('builds every link for the %s placement', (p) => {
    expect(links.go(p)).toBe(`https://labs.indrasol.com/go/churnmap/${p}`);
    expect(links.talk(p)).toBe(`https://labs.indrasol.com/go/churnmap/${p}?to=talk`);
    expect(links.indrasol(p)).toBe(`https://labs.indrasol.com/go/indrasol/${p}`);
  });

  it('builds URLs that parse and stay on labs.indrasol.com', () => {
    for (const p of PLACEMENTS) {
      for (const url of [links.go(p), links.talk(p), links.indrasol(p)]) {
        const parsed = new URL(url);
        expect(parsed.protocol).toBe('https:');
        expect(parsed.host).toBe('labs.indrasol.com');
      }
    }
  });

  it('adds Talk to Indrasol and Built by Indrasol, in that order, to the More from Labs view', () => {
    expect(MORE_FROM_LABS_LINKS).toEqual([
      { label: 'Talk to Indrasol', url: 'https://labs.indrasol.com/go/churnmap/panel?to=talk' },
      { label: 'Built by Indrasol', url: 'https://labs.indrasol.com/go/indrasol/panel' },
    ]);
  });
});
