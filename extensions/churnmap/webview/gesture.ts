/**
 * Pointer and wheel gestures shared by both views: which wheel events zoom and which pan (a
 * two-finger trackpad drag pans, a pinch or a mouse wheel zooms), and whether Space is held
 * (Space + left-drag pans).
 */

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  /** Chromium's legacy wheel delta (120 per mouse-wheel notch; −3 × deltaY on a trackpad). */
  wheelDeltaY?: number;
}

/**
 * `zoom` for a pinch (Chromium reports it as a wheel event with Ctrl), a mouse wheel (line or page
 * deltas, or notches whose legacy delta is not −3 × deltaY) and Ctrl + scroll; `pan` for a
 * two-finger trackpad drag (pixel deltas, any sideways part, or legacy delta exactly −3 × deltaY).
 */
export function wheelGesture(e: WheelLike): 'zoom' | 'pan' {
  if (e.ctrlKey) return 'zoom';
  if (e.deltaMode !== 0) return 'zoom';
  if (e.deltaX !== 0) return 'pan';
  const legacy = e.wheelDeltaY;
  if (legacy !== undefined && legacy !== 0) return legacy === -3 * e.deltaY ? 'pan' : 'zoom';
  return 'zoom';
}

/** Pinches arrive as small deltas; this many times a wheel notch's zoom per unit of delta. */
export const PINCH_BOOST = 5;

let spaceDown = false;
let tracking = false;

/** Whether Space is held now (tracked on the window once anything asks). */
export function spaceHeld(): boolean {
  if (!tracking) {
    tracking = true;
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === ' ') spaceDown = true;
      },
      true,
    );
    window.addEventListener(
      'keyup',
      (e) => {
        if (e.key === ' ') spaceDown = false;
      },
      true,
    );
    window.addEventListener('blur', () => {
      spaceDown = false;
    });
  }
  return spaceDown;
}
