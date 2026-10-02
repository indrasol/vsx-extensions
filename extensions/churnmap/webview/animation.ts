/** Inputs that decide whether the city needs a continuous animation loop. */
export interface AnimationState {
  /** Top-20 glow meshes exist. */
  glow: boolean;
  /** The 3D canvas is mounted (not hidden behind the 2D treemap). */
  mounted?: boolean;
  /** The page says it is visible (`document.visibilityState === 'visible'`). */
  visible: boolean;
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
  /** An animation is running: fly-to, intro, window-switch tween, focus fade or view morph. */
  moving: boolean;
}

/**
 * The loop runs only while something moves on the mounted canvas: an animation, or the glow pulse
 * (which reduced motion turns off). Otherwise the city renders on demand only.
 *
 * A running animation (intro, fly-to, window tween, 3D ↔ 2D morph) keeps the loop on even when the
 * page does not report itself visible: Cursor can report `hidden` for a webview on screen, and a
 * morph that never advances leaves the city flat and fogged. A really hidden page gets no
 * animation frames anyway. Only the endless glow pulse waits for visibility.
 */
export function shouldAnimate(s: AnimationState): boolean {
  if (s.mounted === false) return false;
  if (s.moving) return true;
  return s.visible && s.glow && !s.reducedMotion;
}

/** Glow opacity: `base` ± 0.1 at 0.5 Hz; exactly `base` with reduced motion. */
export function pulseOpacity(base: number, timeMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return base;
  return base + 0.1 * Math.sin(2 * Math.PI * 0.5 * (timeMs / 1000));
}

/** Per-rank glow strength: #1 is full, #20 is 40 %. */
export function glowStrength(rank: number): number {
  const r = Math.min(20, Math.max(1, rank));
  return 1 - ((r - 1) / 19) * 0.6;
}

/**
 * How much a ranked building glows: its rank strength (#1 full, #20 at 40 %) times how far its
 * score is into the warm end, so a Stable file in the top 20 does not light up.
 */
export function glowAmount(rank: number, score: number): number {
  const warmth = Math.min(1, Math.max(0, (score - 50) / 40));
  return glowStrength(rank) * warmth;
}
