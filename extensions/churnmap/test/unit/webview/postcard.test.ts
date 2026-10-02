import { describe, expect, it } from 'vitest';
import {
  cardLabel,
  decodeDataUrl,
  fitText,
  postcardLook,
  topLines,
} from '../../../webview/postcard.js';

describe('postcard text', () => {
  it('writes the top three as "#rank  label  score", or rank and score with no names', () => {
    const top = [
      { rank: 1, label: 'src/billing/invoice.ts', score: 91, heat: 100 },
      { rank: 2, label: 'lib/x.ts', score: 80, heat: 90 },
    ];
    expect(topLines({ detail: 'paths', top })).toEqual([
      '#1  src/billing/invoice.ts  91',
      '#2  lib/x.ts  80',
    ]);
    expect(
      topLines({
        detail: 'none',
        top: [
          { rank: 1, label: '#1', score: 91, heat: 100 },
          { rank: 2, label: '#2', score: 80, heat: 90 },
        ],
      }),
    ).toEqual(['#1  score 91', '#2  score 80']);
  });

  it('shortens text with an ellipsis to fit', () => {
    const measure = (t: string) => t.length * 10;
    expect(fitText('short', 100, measure)).toBe('short');
    expect(fitText('a very long path name', 100, measure)).toBe('a very lo…');
    expect(measure(fitText('a very long path name', 100, measure))).toBeLessThanOrEqual(100);
  });

  it('has a fixed dark look, and a light one only for light themes', () => {
    expect(postcardLook('dark')).toBe(postcardLook('hc'));
    expect(postcardLook('light').theme.kind).toBe('light');
    // A soft vertical gradient from the brand navy (the icon tile, #0B1F3A): lighter on top.
    expect(postcardLook('dark').theme.background).toEqual([11, 31, 58]);
    expect(postcardLook('dark').gradient).toEqual(['rgb(25, 44, 70)', 'rgb(7, 20, 38)']);
    expect(postcardLook('light').gradient[0]).not.toBe(postcardLook('light').gradient[1]);
  });

  it('cards say "Name hidden" instead of a name when no names are allowed', () => {
    expect(cardLabel({ detail: 'none' }, '#1')).toBe('Name hidden');
    expect(cardLabel({ detail: 'districts' }, 'src')).toBe('src');
  });
});

describe('decodeDataUrl', () => {
  it('returns the bytes of a base64 data URL', () => {
    const bytes = new Uint8Array(decodeDataUrl('data:image/png;base64,iVBORw0KGgo='));
    expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
