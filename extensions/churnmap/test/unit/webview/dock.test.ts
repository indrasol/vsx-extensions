import { describe, expect, it } from 'vitest';
import {
  cornerAfterKey,
  DOCK_GAP,
  DOCK_MARGIN,
  nearestCorner,
  type PanelBox,
  stackPanels,
} from '../../../webview/dock.js';
import { hudMode } from '../../../webview/hud.js';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('stackPanels', () => {
  const panels: PanelBox[] = [
    { id: 'legend', corner: 'bl', w: 250, h: 140 },
    { id: 'card', corner: 'bl', w: 300, h: 260 },
    { id: 'rail', corner: 'tr', w: 280, h: 400 },
  ];

  it('stacks panels in one corner (legend nearest the edge) and starts top corners below the HUD', () => {
    const at = stackPanels(1200, 800, 52, panels);
    expect(at.legend).toEqual({
      left: DOCK_MARGIN,
      top: 800 - DOCK_MARGIN - 140,
      maxHeight: 800 - DOCK_MARGIN - 52 - DOCK_GAP,
      squeezed: false,
    });
    expect(at.card?.top).toBe(800 - DOCK_MARGIN - 140 - DOCK_GAP - 260);
    expect(at.rail).toMatchObject({ left: 1200 - DOCK_MARGIN - 280, top: 52 + DOCK_GAP });
  });

  it.each([
    [360, 640, 120],
    [640, 480, 90],
    [900, 700, 52],
    [1400, 900, 52],
  ])(
    'never overlaps the HUD, another panel or the canvas edge at %i × %i',
    (width, height, hud) => {
      for (const corners of [
        ['bl', 'bl', 'tr'],
        ['tl', 'tl', 'tl'],
        ['br', 'tr', 'br'],
        ['tr', 'br', 'bl'],
      ] as const) {
        const boxes: PanelBox[] = [
          { id: 'legend', corner: corners[0], w: 250, h: 120 },
          { id: 'card', corner: corners[1], w: 300, h: 180 },
          { id: 'rail', corner: corners[2], w: 280, h: 200 },
        ];
        const at = stackPanels(width, height, hud, boxes);
        // Squeezed panels (no room left on a small canvas) are not drawn.
        const rects = boxes.flatMap((b) => {
          const p = at[b.id];
          if (!p) throw new Error(`no place for ${b.id}`);
          return p.squeezed ? [] : [{ x: p.left, y: p.top, w: b.w, h: Math.min(b.h, p.maxHeight) }];
        });
        for (const r of rects) {
          expect(r.x).toBeGreaterThanOrEqual(DOCK_MARGIN);
          expect(r.y).toBeGreaterThanOrEqual(hud + DOCK_GAP);
          expect(r.y + r.h).toBeLessThanOrEqual(height - DOCK_MARGIN + 0.001);
        }
        // No two panels ever overlap, whichever corners they are in (narrow canvases included).
        for (let i = 0; i < rects.length; i++) {
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            if (!a || !b) continue;
            expect(
              overlaps(a, b),
              `${corners.join(',')}: panels ${String(i)} and ${String(j)}`,
            ).toBe(false);
          }
        }
      }
    },
  );
});

describe('small canvases', () => {
  it('squeezes out a panel with no usable room instead of drawing a sliver over another', () => {
    const at = stackPanels(360, 640, 115, [
      { id: 'legend', corner: 'bl', w: 276, h: 196 },
      { id: 'card', corner: 'bl', w: 326, h: 330 },
      { id: 'rail', corner: 'tr', w: 298, h: 321 },
    ]);
    expect(at.legend?.squeezed).toBe(false);
    expect(at.card?.squeezed).toBe(false);
    expect(at.rail?.squeezed).toBe(true);
    // With the card collapsed to a pill the rail fits again, above the pill.
    const pill = stackPanels(360, 640, 115, [
      { id: 'legend', corner: 'bl', w: 276, h: 196 },
      { id: 'card', corner: 'bl', w: 115, h: 36 },
      { id: 'rail', corner: 'tr', w: 298, h: 321 },
    ]);
    expect(pill.rail?.squeezed).toBe(false);
    expect((pill.rail?.top ?? 0) + (pill.rail?.maxHeight ?? 0)).toBeLessThanOrEqual(
      (pill.card?.top ?? 0) - DOCK_GAP,
    );
  });
});

describe('moving panels', () => {
  it('snaps to the corner of the half the panel was dropped in', () => {
    expect(nearestCorner(100, 100, 1000, 800)).toBe('tl');
    expect(nearestCorner(900, 100, 1000, 800)).toBe('tr');
    expect(nearestCorner(100, 700, 1000, 800)).toBe('bl');
    expect(nearestCorner(900, 700, 1000, 800)).toBe('br');
  });

  it('arrow keys move to a side, Enter to the next corner clockwise', () => {
    expect(cornerAfterKey('bl', 'ArrowUp')).toBe('tl');
    expect(cornerAfterKey('bl', 'ArrowRight')).toBe('br');
    expect(cornerAfterKey('tr', 'ArrowLeft')).toBe('tl');
    expect(cornerAfterKey('tr', 'ArrowDown')).toBe('br');
    expect(['tl', 'tr', 'br', 'bl'].map((c) => cornerAfterKey(c as 'tl', 'Enter'))).toEqual([
      'tr',
      'br',
      'bl',
      'tl',
    ]);
    expect(cornerAfterKey('tl', 'x')).toBeUndefined();
  });
});

describe('responsive HUD', () => {
  it('is one row from 900 px, two rows below, and compact below 640 px', () => {
    expect([1400, 900, 899, 640, 639, 360].map(hudMode)).toEqual([
      'wide',
      'wide',
      'wrap',
      'wrap',
      'compact',
      'compact',
    ]);
  });
});
