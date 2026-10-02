/**
 * Motion rules for the whole city: one easing curve, three durations. Every animation goes through
 * `Animator`, which reports whether anything is still moving, so the render loop runs only while
 * it is (render on demand). With `prefers-reduced-motion`, every animation is an instant state
 * change: `Animator.start` jumps straight to the end.
 */

/** The one easing curve, as CSS writes it. */
export const CSS_EASE = 'cubic-bezier(.2,.8,.2,1)';

/** Durations, ms: hover feedback, state changes (window switch, view morph), the intro. */
export const DURATION = { hover: 180, state: 400, intro: 900 } as const;

/**
 * A CSS cubic-bezier timing function: x(s) is solved for s by Newton's method (bisection as a
 * fallback), then y(s) is returned. Endpoints are exact.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const y = (s: number): number => ((ay * s + by) * s + cy) * s;
  const dx = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = x(s) - t;
      if (Math.abs(err) < 1e-6) return y(s);
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 40; i++) {
      if (x(s) < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return y(s);
  };
}

/** `cubic-bezier(.2,.8,.2,1)`: a quick start that settles softly, like a damped spring. */
export const ease = cubicBezier(0.2, 0.8, 0.2, 1);

/** Eased progress of an animation `elapsed` ms into `duration` ms (1 at once with reduced motion). */
export function progress(elapsed: number, duration: number, reducedMotion = false): number {
  if (reducedMotion || duration <= 0) return 1;
  return ease(Math.min(1, Math.max(0, elapsed / duration)));
}

export interface Animation {
  duration: number;
  /** Called every frame with eased progress 0–1 (and the raw elapsed ms), last with 1. */
  frame(t: number, elapsed: number): void;
  done?(): void;
}

/**
 * Runs named animations off one clock. Starting a name that is running replaces it (the new one
 * picks up from wherever the caller's state is). `step` advances everything and says whether
 * anything is left, so the caller keeps its loop going only while it is needed.
 */
export class Animator {
  private readonly running = new Map<string, { animation: Animation; start: number }>();

  constructor(
    private readonly reducedMotion: () => boolean,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Starts `animation`; with reduced motion it runs its last frame at once. */
  start(name: string, animation: Animation): void {
    this.running.delete(name);
    if (this.reducedMotion() || animation.duration <= 0) {
      animation.frame(1, animation.duration);
      animation.done?.();
      return;
    }
    this.running.set(name, { animation, start: this.now() });
  }

  /** Jumps a running animation to its end. */
  finish(name: string): void {
    const entry = this.running.get(name);
    if (!entry) return;
    this.running.delete(name);
    entry.animation.frame(1, entry.animation.duration);
    entry.animation.done?.();
  }

  /**
   * Finishes every animation that should have ended more than `graceMs` ago (by this animator's
   * clock), for when animation frames stop arriving. True if any was finished.
   */
  finishOverdue(graceMs: number, now = this.now()): boolean {
    let finished = false;
    for (const [name, { animation, start }] of [...this.running]) {
      if (now - start < animation.duration + graceMs) continue;
      this.finish(name);
      finished = true;
    }
    return finished;
  }

  cancel(name: string): void {
    this.running.delete(name);
  }

  isRunning(name: string): boolean {
    return this.running.has(name);
  }

  get active(): boolean {
    return this.running.size > 0;
  }

  /** Advances every animation to `now`; true while any is still running. */
  step(now = this.now()): boolean {
    for (const [name, { animation, start }] of [...this.running]) {
      const elapsed = now - start;
      const finished = elapsed >= animation.duration;
      animation.frame(finished ? 1 : ease(elapsed / animation.duration), elapsed);
      if (finished && this.running.get(name)?.animation === animation) {
        this.running.delete(name);
        animation.done?.();
      }
    }
    return this.active;
  }
}
