import { describe, expect, it } from 'vitest';
import { throttle } from '../../../src/shared/throttle.js';

function fakeClock() {
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 0;
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return () => {
        timers = timers.filter((t) => t.id !== id);
      };
    },
    advance(ms: number) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
    },
  };
}

describe('throttle', () => {
  it('runs the first call at once and folds later ones into one trailing call', () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const t = throttle((v: string) => calls.push(v), 100, clock.now, clock.schedule);
    t('a');
    t('b');
    t('c');
    expect(calls).toEqual(['a']);
    clock.advance(99);
    expect(calls).toEqual(['a']);
    clock.advance(1);
    expect(calls).toEqual(['a', 'c']);
  });

  it('keeps to ≤ 10 calls per second under a stream of events', () => {
    const clock = fakeClock();
    let count = 0;
    const t = throttle(() => (count += 1), 100, clock.now, clock.schedule);
    for (let ms = 0; ms < 1000; ms += 5) {
      t();
      clock.advance(5);
    }
    expect(count).toBeLessThanOrEqual(11); // 10 per second plus the leading call
    expect(count).toBeGreaterThanOrEqual(9);
  });

  it('runs again immediately after a quiet interval', () => {
    const clock = fakeClock();
    const calls: number[] = [];
    const t = throttle((v: number) => calls.push(v), 100, clock.now, clock.schedule);
    t(1);
    clock.advance(500);
    t(2);
    expect(calls).toEqual([1, 2]);
  });

  it('SCM cadence: a burst inside 2 s ends in one trailing call with the latest state, at 2 s', () => {
    const clock = fakeClock();
    const calls: [number, number][] = [];
    const t = throttle(
      (n: number) => calls.push([clock.now(), n]),
      2000,
      clock.now,
      clock.schedule,
    );
    t(1); // leading edge: at once
    clock.advance(300);
    t(2);
    clock.advance(900);
    t(3);
    clock.advance(799);
    expect(calls).toEqual([[0, 1]]);
    clock.advance(1); // trailing edge, 2 s after the leading call
    expect(calls).toEqual([
      [0, 1],
      [2000, 3],
    ]);
    t(4); // inside the next interval: waits for its trailing edge
    clock.advance(1999);
    expect(calls).toHaveLength(2);
    clock.advance(1);
    expect(calls.at(-1)).toEqual([4000, 4]);
  });

  it('cancel drops the pending trailing call', () => {
    const clock = fakeClock();
    const calls: number[] = [];
    const t = throttle((v: number) => calls.push(v), 100, clock.now, clock.schedule);
    t(1);
    t(2);
    t.cancel();
    clock.advance(200);
    expect(calls).toEqual([1]);
  });

  it('uses real timers by default', async () => {
    const calls: number[] = [];
    const t = throttle((v: number) => calls.push(v), 10);
    t(1);
    t(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toEqual([1, 2]);
  });
});
