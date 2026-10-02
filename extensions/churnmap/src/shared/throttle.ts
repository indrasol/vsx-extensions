export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  /** Drops a pending trailing call. */
  cancel(): void;
}

/**
 * Shared by the webview (hover messages) and the host (the SCM warning), so browser-safe.
 * Calls `fn` at most once per `intervalMs`: the first call runs at once, later calls inside the
 * interval collapse into one trailing call with the latest arguments. Clock and timer are
 * injectable for tests.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
  now: () => number = () => performance.now(),
  schedule: (callback: () => void, ms: number) => () => void = (callback, ms) => {
    const id = setTimeout(callback, ms);
    return () => {
      clearTimeout(id);
    };
  },
): Throttled<A> {
  let last = -Infinity;
  let pending: A | undefined;
  let cancelTimer: (() => void) | undefined;

  const run = (args: A): void => {
    last = now();
    fn(...args);
  };

  const throttled = ((...args: A) => {
    const wait = last + intervalMs - now();
    if (wait <= 0 && !cancelTimer) {
      run(args);
      return;
    }
    pending = args;
    cancelTimer ??= schedule(
      () => {
        cancelTimer = undefined;
        const next = pending;
        pending = undefined;
        if (next) run(next);
      },
      Math.max(0, wait),
    );
  }) as Throttled<A>;

  throttled.cancel = () => {
    cancelTimer?.();
    cancelTimer = undefined;
    pending = undefined;
  };
  return throttled;
}
