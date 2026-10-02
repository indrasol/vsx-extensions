import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, GAP_MS, SUSTAIN_MS } from '../../../webview/quality.js';
import { Animator, cubicBezier, DURATION, ease, progress } from '../../../webview/motion.js';
import {
  fileName,
  folderOf,
  middleTruncate,
  middleTruncateToWidth,
} from '../../../webview/text.js';
import { interpolate, planTween, summarize, type Visual } from '../../../webview/tween.js';

const v = (path: string, over: Partial<Visual> = {}): Visual => ({
  path,
  x: 0,
  z: 0,
  w: 10,
  d: 10,
  base: 0,
  height: 50,
  colour: [100, 100, 100],
  glass: false,
  ...over,
});

describe('motion', () => {
  it('has one easing curve and three durations', () => {
    expect(DURATION).toEqual({ hover: 180, state: 400, intro: 900 });
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    // cubic-bezier(.2,.8,.2,1) is well past halfway at t = 0.5 and never overshoots.
    expect(ease(0.5)).toBeGreaterThan(0.8);
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const y = ease(t);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
      previous = y;
    }
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 5); // linear
  });

  it('reduced motion makes every animation an instant state change', () => {
    expect(progress(0, 400, true)).toBe(1);
    expect(progress(200, 400, false)).toBeCloseTo(ease(0.5), 9);
    const frames: number[] = [];
    let done = 0;
    const animator = new Animator(
      () => true,
      () => 0,
    );
    animator.start('x', { duration: 400, frame: (t) => frames.push(t), done: () => (done += 1) });
    expect(frames).toEqual([1]);
    expect(done).toBe(1);
    expect(animator.active).toBe(false);
  });

  it('finishes only overdue animations when frames stop arriving', () => {
    let now = 0;
    const animator = new Animator(
      () => false,
      () => now,
    );
    const ends: string[] = [];
    animator.start('morph', {
      duration: 400,
      frame: () => undefined,
      done: () => ends.push('morph'),
    });
    animator.start('intro', {
      duration: 900,
      frame: () => undefined,
      done: () => ends.push('intro'),
    });
    const last: Record<string, number> = {};
    animator.start('morph', { duration: 400, frame: (t) => (last.morph = t) });
    now = 500;
    expect(animator.finishOverdue(150)).toBe(false); // 500 < 400 + 150
    now = 560;
    expect(animator.finishOverdue(150)).toBe(true);
    expect(last.morph).toBe(1);
    expect(ends).toEqual([]);
    now = 1100;
    expect(animator.finishOverdue(150)).toBe(true);
    expect(ends).toEqual(['intro']);
    expect(animator.active).toBe(false);
  });

  it('runs, replaces and finishes named animations off one clock', () => {
    let now = 0;
    const animator = new Animator(
      () => false,
      () => now,
    );
    const seen: number[] = [];
    let done = 0;
    animator.start('a', { duration: 100, frame: (t) => seen.push(t), done: () => (done += 1) });
    expect(animator.active).toBe(true);
    now = 50;
    expect(animator.step()).toBe(true);
    now = 100;
    expect(animator.step()).toBe(false);
    expect(seen.at(-1)).toBe(1);
    expect(done).toBe(1);
    // Replacing a running animation drops the old one without its `done`.
    const replaced: string[] = [];
    animator.start('b', {
      duration: 100,
      frame: () => undefined,
      done: () => replaced.push('old'),
    });
    animator.start('b', {
      duration: 100,
      frame: () => undefined,
      done: () => replaced.push('new'),
    });
    animator.finish('b');
    expect(replaced).toEqual(['new']);
    animator.start('c', { duration: 100, frame: () => undefined });
    animator.cancel('c');
    expect(animator.isRunning('c')).toBe(false);
  });
});

describe('planTween (keyed by path)', () => {
  it('changed files tween between their old and new looks', () => {
    const entries = planTween(
      [v('a', { height: 10, colour: [0, 0, 0] })],
      [v('a', { height: 30, colour: [200, 100, 0] })],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('changed');
    const mid = entries[0] && interpolate(entries[0], 0.5);
    expect(mid?.height).toBe(20);
    expect(mid?.colour).toEqual([100, 50, 0]);
  });

  it('added files rise from 0 on their own footprint; removed files sink where they stood', () => {
    const entries = planTween(
      [v('gone', { x: 5, height: 40 }), v('kept')],
      [v('kept'), v('new', { x: 9, height: 60 })],
    );
    expect(summarize(entries)).toEqual({ added: 1, removed: 1, changed: 0, same: 1 });
    const added = entries.find((e) => e.kind === 'added');
    expect(added?.index).toBe(1);
    expect(added?.from).toEqual({ ...v('new', { x: 9, height: 60 }), height: 0 });
    expect(added && interpolate(added, 0.25).height).toBe(15);
    const removed = entries.find((e) => e.kind === 'removed');
    expect(removed?.index).toBe(-1);
    expect(removed && interpolate(removed, 0.75).height).toBe(10);
    expect(removed && interpolate(removed, 0.75).x).toBe(5);
    // New buildings keep their order and come first; removed ones follow.
    expect(entries.map((e) => e.to.path)).toEqual(['kept', 'new', 'gone']);
  });

  it('matches by path, not by position', () => {
    const entries = planTween(
      [v('a', { height: 1 }), v('b', { height: 2 })],
      [v('b', { height: 2 }), v('a', { height: 1 })],
    );
    expect(summarize(entries).same).toBe(2);
  });

  it('a file that becomes unranked moves to glass at once; its colour carries the change', () => {
    const [e] = planTween([v('a')], [v('a', { glass: true, colour: [120, 130, 140] })]);
    expect(e && interpolate(e, 0).glass).toBe(true);
    expect(e && interpolate(e, 0).colour).toEqual([100, 100, 100]);
    expect(e && interpolate(e, 1)).toEqual(e?.to);
  });
});

describe('adaptive quality', () => {
  /** Feeds `ms` frames for `durationMs` starting at `from`; returns the steps dropped. */
  function feed(q: AdaptiveQuality, ms: number, durationMs: number, from = 0): string[] {
    const out: string[] = [];
    for (let t = from + ms; t <= from + durationMs; t += ms) {
      const step = q.observe(ms, t);
      if (step) out.push(step);
    }
    return out;
  }

  it('drops shadows, then edges, then labels, each after a full second of slow frames', () => {
    const q = new AdaptiveQuality();
    q.setCadence(16.7);
    expect(feed(q, 25, SUSTAIN_MS - 50)).toEqual([]);
    expect(q.enabled('shadows')).toBe(true);
    expect(feed(q, 25, 3200, SUSTAIN_MS - 50)).toEqual(['shadows', 'edges', 'labels']);
    expect(q.enabled('shadows') || q.enabled('edges') || q.enabled('labels')).toBe(false);
    expect(feed(q, 25, 3000, 5000)).toEqual([]); // nothing left to drop, and nothing twice
    q.reset();
    expect(q.level).toBe(0);
  });

  it('fast frames, and a slow spell that breaks, reset the clock', () => {
    const q = new AdaptiveQuality();
    q.setCadence(16.7);
    feed(q, 25, 800);
    q.observe(16, 816);
    expect(feed(q, 25, 800, 816)).toEqual([]);
    expect(q.level).toBe(0);
  });

  it('pauses between on-demand frames are not frames', () => {
    const q = new AdaptiveQuality();
    for (let t = 0; t < 5000; t += 500) expect(q.observe(500, t)).toBeUndefined();
    expect(q.observe(GAP_MS + 1, 6000)).toBeUndefined();
    expect(q.level).toBe(0);
  });

  it('a display capped at 30 frames per second is not "slow"', () => {
    const q = new AdaptiveQuality();
    q.setCadence(33.3);
    expect(feed(q, 33.3, 3000)).toEqual([]);
    expect(feed(q, 50, 1600, 4000)).toEqual(['shadows']);
  });
});

describe('path text', () => {
  it('cuts paths in the middle, never at the end', () => {
    expect(middleTruncate('src/billing/invoice.ts', 40)).toBe('src/billing/invoice.ts');
    expect(middleTruncate('src/core/billing/v2/invoice.ts', 27)).toBe(
      'src/…/billing/v2/invoice.ts',
    );
    expect(middleTruncate('src/core/billing/v2/invoice.ts', 26)).toBe('src/…/v2/invoice.ts');
    expect(middleTruncate('src/core/billing/v2/invoice.ts', 16)).toBe('src/…/invoice.ts');
    expect(middleTruncate('src/core/billing/v2/invoice.ts', 12)).toBe('…/invoice.ts');
    const cut = middleTruncate('src/a_really_long_generated_file_name.ts', 16);
    expect(cut).toHaveLength(16);
    expect(cut.endsWith('.ts')).toBe(true);
    expect(cut).toContain('…');
    for (let max = 1; max < 40; max++) {
      expect(
        middleTruncate('packages/web/src/components/Button.tsx', max).length,
      ).toBeLessThanOrEqual(max);
    }
  });

  it('fits a pixel width with a measure function', () => {
    const measure = (t: string): number => t.length * 7;
    const text = middleTruncateToWidth('src/core/billing/v2/invoice.ts', 16 * 7, measure);
    expect(text).toBe('src/…/invoice.ts');
    expect(middleTruncateToWidth('a.ts', 100, measure)).toBe('a.ts');
    expect(middleTruncateToWidth('abc/def.ts', 3, measure)).toBe('');
  });

  it('splits names and folders', () => {
    expect(fileName('src/a/b.ts')).toBe('b.ts');
    expect(fileName('vendor/big/…')).toBe('big/…');
    expect(folderOf('src/a/b.ts')).toBe('src/a/');
    expect(folderOf('README.md')).toBe('');
  });
});
