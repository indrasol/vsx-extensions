import { describe, expect, it } from 'vitest';
import {
  BANDS,
  backgroundGradient,
  bandColour,
  bandOfHeat,
  contrastRatio,
  GLASS,
  glassColour,
  GLASS_OPACITY,
  HIGH_CONTRAST,
  isGlass,
  HUE_JUMP,
  mixOklch,
  mixStops,
  NEUTRAL_CHROMA,
  oklabLightness,
  oklchToSrgb,
  RAMP,
  rampColour,
  rgbCss,
  srgbToOklch,
  variantOf,
} from '../../../src/city/palette.js';

const close = (actual: readonly number[], expected: readonly number[], tolerance = 0.6): void => {
  actual.forEach((v, i) => {
    expect(
      Math.abs(v - (expected[i] ?? 0)),
      `channel ${String(i)}: ${String(v)}`,
    ).toBeLessThanOrEqual(tolerance);
  });
};

describe('oklchToSrgb', () => {
  it('matches known conversions (CSS Color 4 reference values)', () => {
    close(oklchToSrgb({ l: 0.627955, c: 0.257683, h: 29.2339 }), [255, 0, 0]);
    close(oklchToSrgb({ l: 0.519765, c: 0.176858, h: 142.4953 }), [0, 128, 0]);
    close(oklchToSrgb({ l: 0.452014, c: 0.313214, h: 264.052 }), [0, 0, 255]);
    close(oklchToSrgb({ l: 1, c: 0, h: 0 }), [255, 255, 255]);
    close(oklchToSrgb({ l: 0, c: 0, h: 0 }), [0, 0, 0]);
    close(oklchToSrgb({ l: 0.599871, c: 0, h: 0 }), [128, 128, 128]);
  });

  it('brings out-of-gamut colours in by lowering chroma, keeping lightness', () => {
    const rgb = oklchToSrgb({ l: 0.7, c: 0.4, h: 150 });
    for (const v of rgb) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
    expect(oklabLightness(rgb)).toBeCloseTo(0.7, 3);
  });

  it('round-trips lightness through oklabLightness', () => {
    for (const l of [0.2, 0.45, 0.62, 0.8, 0.95]) {
      expect(oklabLightness(oklchToSrgb({ l, c: 0.05, h: 200 }))).toBeCloseTo(l, 3);
    }
  });
});

describe('the ramp', () => {
  it('defines lightness falling and chroma rising through the stops, in both variants', () => {
    for (const stops of [RAMP.dark, RAMP.light]) {
      for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        expect(b?.l).toBeLessThan(a?.l ?? 0);
        expect(b?.c).toBeGreaterThan(a?.c ?? 0);
      }
    }
  });

  it('has monotonically falling perceptual lightness from score 0 to 100 (dark and light)', () => {
    for (const variant of ['dark', 'light'] as const) {
      let previous = Infinity;
      for (let tenth = 0; tenth <= 1000; tenth++) {
        const l = oklabLightness(rampColour(tenth / 10, { variant }));
        expect(l, `${variant} score ${String(tenth / 10)}`).toBeLessThanOrEqual(previous + 1e-9);
        previous = l;
      }
    }
  });

  it('goes teal → amber → coral → magenta-red (hue order)', () => {
    const hue = (score: number): number => {
      const [r, g, b] = rampColour(score);
      return Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * (180 / Math.PI);
    };
    const [teal, amber, hot] = [0, 60, 100].map((s) => rampColour(s));
    expect(teal?.[1]).toBeGreaterThan(teal?.[0] ?? 0); // green over red
    expect(amber?.[0]).toBeGreaterThan(amber?.[2] ?? 0); // red over blue
    expect(hot?.[0]).toBeGreaterThan(200);
    expect(hue(100)).not.toBeCloseTo(hue(0), 0);
  });

  it('clamps scores and treats NaN as 0', () => {
    expect(rampColour(-5)).toEqual(rampColour(0));
    expect(rampColour(150)).toEqual(rampColour(100));
    expect(rampColour(Number.NaN)).toEqual(rampColour(0));
  });

  it('never draws a score of 40 or more green (OKLCH hue 100°–165° with chroma > 0.05)', () => {
    for (const variant of ['dark', 'light'] as const) {
      for (let tenth = 400; tenth <= 1000; tenth++) {
        const score = tenth / 10;
        const { c, h } = srgbToOklch(rampColour(score, { variant }));
        const green = h >= 100 && h <= 165 && c > 0.05;
        expect(
          green,
          `${variant} score ${String(score)}: hue ${h.toFixed(1)}, chroma ${c.toFixed(3)}`,
        ).toBe(false);
      }
    }
  });

  it('crosses a wide hue step through grey, keeping each end’s hue', () => {
    const teal = { l: 0.79, c: 0.095, h: 180 };
    const amber = { l: 0.77, c: 0.15, h: 75 };
    expect(Math.abs(amber.h - teal.h)).toBeGreaterThan(HUE_JUMP);
    const mid = mixStops(teal, amber, 0.5);
    expect(mid.c).toBeCloseTo(NEUTRAL_CHROMA, 6);
    expect(mid.l).toBeCloseTo(0.78, 6);
    expect(mixStops(teal, amber, 0.25).h).toBe(180);
    expect(mixStops(teal, amber, 0.75).h).toBe(75);
    expect(mixStops(teal, amber, 0)).toEqual(teal);
    expect(mixStops(teal, amber, 1)).toEqual(amber);
    // Narrow steps still blend in OKLCH.
    const coral = { l: 0.69, c: 0.17, h: 35 };
    expect(mixStops(amber, coral, 0.5)).toEqual(mixOklch(amber, coral, 0.5));
  });

  it('round-trips OKLCH through srgbToOklch', () => {
    const back = srgbToOklch(oklchToSrgb({ l: 0.7, c: 0.12, h: 40 }));
    expect(back.l).toBeCloseTo(0.7, 3);
    expect(back.c).toBeCloseTo(0.12, 3);
    expect(back.h).toBeCloseTo(40, 1);
  });

  it('mixes hue the short way round', () => {
    expect(mixOklch({ l: 0.5, c: 0.1, h: 350 }, { l: 0.5, c: 0.1, h: 10 }, 0.5).h).toBeCloseTo(
      0,
      6,
    );
  });
});

describe('bands and high contrast', () => {
  it('names the bands Stable, Watch, Hotspot, each with its relative rule and colour range', () => {
    expect(BANDS.map((b) => [b.label, b.from, b.rule])).toEqual([
      ['Stable', 0, 'the rest'],
      ['Watch', 60, 'the next 15 %'],
      ['Hotspot', 85, 'top 5 % of your code files (at least 3, at most 20)'],
    ]);
    expect([0, 59.9, 60, 84.9, 85, 100].map(bandOfHeat)).toEqual([
      'stable',
      'stable',
      'watch',
      'watch',
      'hotspot',
      'hotspot',
    ]);
  });

  it('high contrast is one flat colour per band with ≥ 3:1 luminance contrast between bands', () => {
    const hc = (s: number) => rampColour(s, { highContrast: true });
    expect(hc(0)).toEqual(hc(59.9));
    expect(hc(60)).toEqual(hc(84.9));
    expect(hc(85)).toEqual(hc(100));
    expect(contrastRatio(hc(0), hc(60))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hc(60), hc(85))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hc(0), hc(85))).toBeGreaterThanOrEqual(9);
    expect(HIGH_CONTRAST.stable.l).toBeGreaterThan(HIGH_CONTRAST.watch.l);
    expect(bandColour('watch', { highContrast: true })).toEqual(hc(70));
  });

  it('band colours follow the ramp', () => {
    expect(bandColour('hotspot')).toEqual(rampColour(95));
    expect(bandColour('stable', { variant: 'light' })).toEqual(
      rampColour(30, { variant: 'light' }),
    );
  });
});

describe('glass, variants and backdrop', () => {
  it('unranked files are low-chroma slate at 55 %', () => {
    expect(GLASS_OPACITY).toBe(0.55);
    expect(GLASS.dark.c).toBeLessThan(0.03);
    const [r, g, b] = glassColour('dark');
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(25);
    expect(oklabLightness(glassColour('light'))).toBeGreaterThan(
      oklabLightness(glassColour('dark')),
    );
  });

  it('isGlass: unranked files and folded blocks with nothing ranked', () => {
    expect(isGlass({ why: 'few-commits', score: 0 })).toBe(true);
    expect(isGlass({ score: 0 })).toBe(false);
    expect(isGlass({ score: 0, folded: { files: 3, loc: 90 } })).toBe(true);
    expect(isGlass({ score: 40, folded: { files: 3, loc: 90 } })).toBe(false);
  });

  it('light themes use the light variant; dark and high contrast the dark one', () => {
    expect(variantOf('light')).toBe('light');
    expect(variantOf('dark')).toBe('dark');
    expect(variantOf('hc')).toBe('dark');
  });

  it('the backdrop is a soft vertical gradient from the editor background', () => {
    const [top, bottom] = backgroundGradient([30, 30, 30], [212, 212, 212]);
    expect(top[0]).toBeGreaterThan(30);
    expect(bottom[0]).toBeLessThan(30);
    const [lightTop, lightBottom] = backgroundGradient([255, 255, 255], [51, 51, 51]);
    expect(lightTop[0]).toBeLessThanOrEqual(255);
    expect(lightBottom[0]).toBeLessThan(lightTop[0]);
    expect(rgbCss([10.4, 20.6, 30], 0.5)).toBe('rgba(10, 21, 30, 0.5)');
  });
});
