/** A hotspot's save nudge is shown at most once per file per this interval. */
export const NUDGE_INTERVAL_MS = 10 * 60_000;
/** How long the nudge stays in the status bar. */
export const NUDGE_VISIBLE_MS = 20_000;
/** Only the top this-many hotspots nudge. */
export const NUDGE_TOP = 20;

/** Remembers when each file last nudged. Pure (the clock is passed in). */
export class NudgeClock {
  private readonly last = new Map<string, number>();

  constructor(private readonly intervalMs: number = NUDGE_INTERVAL_MS) {}

  /** True (and remembered) when `path` has not nudged within the interval before `now`. */
  take(path: string, now: number): boolean {
    const previous = this.last.get(path);
    if (previous !== undefined && now - previous < this.intervalMs) return false;
    this.last.set(path, now);
    return true;
  }
}
