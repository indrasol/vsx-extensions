/**
 * Adaptive quality. When frames stay slow, the city sheds effects one at a time: shadows first,
 * then edge shading, then the floating labels. Each step is taken (and reported) once.
 *
 * "Slow" is a frame interval above 20 ms that is also clearly above the display's own cadence
 * (measured once while the page is idle), so a screen or power mode that caps animation frames at
 * 30 per second does not count as slow. Gaps longer than `GAP_MS` are idle time, not frames.
 */
import type { QualityStep } from '../src/city/protocol.js';

export const QUALITY_STEPS: readonly QualityStep[] = ['shadows', 'edges', 'labels'];
/** Frames slower than this, for `SUSTAIN_MS` in a row, drop the next effect. */
export const SLOW_FRAME_MS = 20;
export const SUSTAIN_MS = 1000;
/** A longer interval is a pause (render on demand), not a frame. */
export const GAP_MS = 100;
/** Frames must also be this much slower than the display cadence to count. */
export const CADENCE_SLACK = 1.2;

export class AdaptiveQuality {
  /** How many steps have been taken (0 = everything on). */
  private dropped = 0;
  private slowSince: number | undefined;
  private cadence = 0;

  /** The display's idle frame interval, ms (from a short probe when the page starts). */
  setCadence(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.cadence = ms;
  }

  get level(): number {
    return this.dropped;
  }

  /** True while `step`'s effect is still on. */
  enabled(step: QualityStep): boolean {
    return QUALITY_STEPS.indexOf(step) >= this.dropped;
  }

  /** The threshold a frame interval must exceed to count as slow. */
  get threshold(): number {
    return Math.max(SLOW_FRAME_MS, this.cadence * CADENCE_SLACK);
  }

  /**
   * Records one frame interval ending at `now`; returns the step it just dropped, if any. After a
   * drop the clock restarts, so the next step needs another full second of slow frames.
   */
  observe(intervalMs: number, now: number): QualityStep | undefined {
    if (!(intervalMs > 0) || intervalMs > GAP_MS) {
      this.slowSince = undefined;
      return undefined;
    }
    if (intervalMs <= this.threshold) {
      this.slowSince = undefined;
      return undefined;
    }
    this.slowSince ??= now - intervalMs;
    if (now - this.slowSince < SUSTAIN_MS || this.dropped >= QUALITY_STEPS.length) return undefined;
    const step = QUALITY_STEPS[this.dropped];
    this.dropped += 1;
    this.slowSince = undefined;
    return step;
  }

  /** Everything back on (the screenshot capture, or a fresh page). */
  reset(): void {
    this.dropped = 0;
    this.slowSince = undefined;
  }
}
