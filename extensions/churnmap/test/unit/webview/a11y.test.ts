import { describe, expect, it } from 'vitest';
import {
  glowAmount,
  glowStrength,
  pulseOpacity,
  shouldAnimate,
} from '../../../webview/animation.js';
import { navFor } from '../../../webview/interaction.js';
import { optionLabel, optionSpec } from '../../../webview/list.js';

const ENTRY = {
  path: 'src/core/engine.js',
  rank: 1,
  score: 92.345,
  heat: 100,
  reasons: ['41 commits', 'deep'],
  sentences: ['Changed 41 times in 90 days', 'Deeply nested code (depth 9)'],
  weekly: [1, 2, 3],
  authors: 3,
  trend: 'rising' as const,
  parts: [],
};

describe('Top hotspots listbox options', () => {
  it('are options that carry rank and score as text and the reasons for assistive tech', () => {
    expect(optionSpec(ENTRY, 0)).toEqual({
      id: 'hotspot-option-0',
      role: 'option',
      text: '#1 src/core/engine.js — 92.3',
      description: '41 commits; deep',
    });
    expect(optionSpec({ ...ENTRY, reasons: [] }, 4).description).toBe('No reasons recorded');
    expect(optionLabel(ENTRY)).toBe('#1 src/core/engine.js — 92.3');
  });
});

describe('keyboard navigation', () => {
  it('arrows pan, Alt+arrows orbit, +/- zoom', () => {
    expect(navFor('ArrowLeft', false)).toEqual({ kind: 'pan', dx: -1, dy: 0 });
    expect(navFor('ArrowDown', false)).toEqual({ kind: 'pan', dx: 0, dy: 1 });
    expect(navFor('ArrowLeft', true)).toEqual({ kind: 'orbit', dx: -1, dy: 0 });
    expect(navFor('ArrowUp', true)).toEqual({ kind: 'orbit', dx: 0, dy: -1 });
    expect(navFor('+', false)).toEqual({ kind: 'zoom', direction: 1 });
    expect(navFor('=', false)).toEqual({ kind: 'zoom', direction: 1 });
    expect(navFor('-', false)).toEqual({ kind: 'zoom', direction: -1 });
    expect(navFor('x', false)).toBeUndefined();
  });
});

describe('animation loop decision', () => {
  const base = { glow: true, visible: true, reducedMotion: false, moving: false };

  it('pulses only while visible; animations always run to their end on a mounted canvas', () => {
    expect(shouldAnimate(base)).toBe(true);
    expect(shouldAnimate({ ...base, visible: false })).toBe(false);
    // Cursor reports `hidden` for a webview on screen: a morph must still finish.
    expect(shouldAnimate({ ...base, visible: false, moving: true })).toBe(true);
    expect(shouldAnimate({ ...base, glow: false })).toBe(false);
    expect(shouldAnimate({ ...base, glow: false, moving: true })).toBe(true);
    // Behind the 2D treemap nothing runs.
    expect(shouldAnimate({ ...base, mounted: false, moving: true })).toBe(false);
  });

  it('reduced motion: no pulse loop, and the opacity stays constant', () => {
    expect(shouldAnimate({ ...base, reducedMotion: true })).toBe(false);
    expect(pulseOpacity(0.35, 500, true)).toBe(0.35);
    expect(pulseOpacity(0.35, 500, false)).toBeCloseTo(0.45, 6); // peak at 0.5 s (0.5 Hz)
    expect(pulseOpacity(0.35, 1500, false)).toBeCloseTo(0.25, 6);
  });

  it('glow strength falls with rank', () => {
    expect(glowStrength(1)).toBe(1);
    expect(glowStrength(20)).toBeCloseTo(0.4, 6);
    expect(glowStrength(99)).toBeCloseTo(0.4, 6);
    expect(glowStrength(10)).toBeGreaterThan(glowStrength(11));
  });

  it('only warm ranked files glow; hotspots glow most', () => {
    expect(glowAmount(1, 30)).toBe(0);
    expect(glowAmount(1, 90)).toBe(1);
    expect(glowAmount(1, 70)).toBeCloseTo(0.5, 6);
    expect(glowAmount(20, 95)).toBeCloseTo(0.4, 6);
  });
});
