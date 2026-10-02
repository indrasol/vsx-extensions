import {
  backgroundGradient,
  BANDS,
  bandLabel,
  bandOfHeat,
  luminance,
  type RGB,
  rampColour,
  rgbCss,
} from '../src/city/palette.js';
import {
  POSTCARD_HEIGHT,
  POSTCARD_WIDTH,
  type PostcardMessage,
  type ThemeKind,
} from '../src/city/protocol.js';
import { UI_FONT } from './fonts.js';
import { middleTruncateToWidth } from './text.js';
import type { CityView, PostcardLook } from './view.js';

/** The credit line: plain text (labs.indrasol.com/c is served by the Labs site; nothing links). */
export const POSTCARD_CREDIT = 'Made with Churnmap · labs.indrasol.com/c';

interface Look extends PostcardLook {
  ink: string;
  muted: string;
  card: string;
  cardBorder: string;
}

function look(kind: 'dark' | 'light'): Look {
  const background: RGB = kind === 'dark' ? [11, 31, 58] : [244, 247, 251];
  const foreground: RGB = kind === 'dark' ? [214, 222, 235] : [30, 42, 58];
  const [top, bottom] = backgroundGradient(background, foreground);
  return {
    theme: {
      kind,
      background,
      foreground,
      focus: kind === 'dark' ? [120, 180, 255] : [0, 96, 192],
    },
    gradient: [rgbCss(top), rgbCss(bottom)],
    ink: kind === 'dark' ? '#F2F5FA' : '#132033',
    muted: kind === 'dark' ? 'rgba(242, 245, 250, 0.68)' : 'rgba(19, 32, 51, 0.66)',
    card: kind === 'dark' ? 'rgba(12, 22, 38, 0.72)' : 'rgba(255, 255, 255, 0.78)',
    cardBorder: kind === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(19, 32, 51, 0.12)',
  };
}

/** Fixed looks, so a postcard is the same whatever the editor theme (light only for light themes). */
const LOOKS: Record<'dark' | 'light', Look> = { dark: look('dark'), light: look('light') };

export function postcardLook(kind: ThemeKind): Look {
  return kind === 'light' ? LOOKS.light : LOOKS.dark;
}

/** A top-3 card's title: the (already reduced) label, or "Name hidden" when there are no names. */
export function cardLabel(message: Pick<PostcardMessage, 'detail'>, label: string): string {
  return message.detail === 'none' ? 'Name hidden' : label;
}

/** The top-3 block as text lines (`#1  src/billing/invoice.ts  82`; no names: `#1  score 82`). */
export function topLines(message: Pick<PostcardMessage, 'detail' | 'top'>): string[] {
  return message.top.map((t) =>
    message.detail === 'none'
      ? `#${String(t.rank)}  score ${String(t.score)}`
      : `#${String(t.rank)}  ${t.label}  ${String(t.score)}`,
  );
}

/** Shortens `text` with an ellipsis until `measure` says it fits in `width`. */
export function fitText(text: string, width: number, measure: (t: string) => number): string {
  if (measure(text) <= width) return text;
  let cut = text.length;
  while (cut > 1 && measure(`${text.slice(0, cut)}…`) > width) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  colour: RGB,
  font: string,
): number {
  ctx.font = `600 18px ${font}`;
  const w = ctx.measureText(text).width + 18;
  ctx.fillStyle = rgbCss(colour);
  ctx.beginPath();
  ctx.roundRect(x, y, w, 28, 14);
  ctx.fill();
  ctx.fillStyle = luminance(colour) > 0.35 ? '#10141a' : '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 9, y + 15);
  return w;
}

function overlay(ctx: CanvasRenderingContext2D, message: PostcardMessage, l: Look): void {
  const W = POSTCARD_WIDTH;
  const H = POSTCARD_HEIGHT;
  const margin = 56;
  const font = UI_FONT;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const measure = (t: string): number => ctx.measureText(t).width;

  // Title and subtitle, top left.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = l.ink;
  ctx.font = `600 40px ${font}`;
  ctx.fillText(fitText(message.repoName, W / 2, measure), margin, margin - 6);
  ctx.fillStyle = l.muted;
  ctx.font = `20px ${font}`;
  ctx.fillText(`Hotspots · last ${String(message.window)} days`, margin, margin + 44);

  // Legend, top right: the gradient bar, Stable → Watch → Hotspot, and what the city encodes.
  const barW = 300;
  const barX = W - margin - barW;
  const barY = margin + 4;
  const gradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  for (const s of [0, 20, 40, 60, 70, 80, 90, 100])
    gradient.addColorStop(s / 100, rgbCss(rampColour(s)));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, 10, 5);
  ctx.fill();
  ctx.font = `600 15px ${font}`;
  ctx.fillStyle = l.muted;
  for (const band of BANDS) {
    const x = barX + (band.from / 100) * barW;
    ctx.textAlign = band.band === 'stable' ? 'left' : band.band === 'hotspot' ? 'right' : 'center';
    ctx.fillText(band.label, band.band === 'hotspot' ? barX + barW : x, barY + 18);
  }
  ctx.textAlign = 'right';
  ctx.font = `14px ${font}`;
  ctx.fillText('Height = lines of code · Colour = risk', W - margin, barY + 42);

  // Top three as glass cards, bottom left.
  const cardW = 440;
  const cardH = 74;
  const gap = 16;
  const y = H - margin - cardH;
  message.top.forEach((t, i) => {
    const x = margin + i * (cardW + gap);
    if (x + cardW > W - margin) return;
    ctx.fillStyle = l.card;
    ctx.strokeStyle = l.cardBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 12);
    ctx.fill();
    ctx.stroke();
    const band = bandOfHeat(t.heat);
    ctx.textAlign = 'left';
    const badge = pill(ctx, `#${String(t.rank)}`, x + 16, y + 14, rampColour(t.heat), font);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = l.ink;
    ctx.font = `600 20px ${font}`;
    const labelX = x + 16 + badge + 12;
    const label = cardLabel(message, t.label);
    const fitted =
      message.detail === 'paths'
        ? middleTruncateToWidth(label, x + cardW - 16 - labelX, measure)
        : fitText(label, x + cardW - 16 - labelX, measure);
    ctx.fillText(fitted, labelX, y + 29);
    ctx.fillStyle = l.muted;
    ctx.font = `15px ${font}`;
    ctx.fillText(`${bandLabel(band)} · score ${String(t.score)}`, x + 16, y + 56);
    // The card's risk bar.
    const meterX = x + cardW - 16 - 120;
    ctx.fillStyle = l.cardBorder;
    ctx.beginPath();
    ctx.roundRect(meterX, y + 53, 120, 6, 3);
    ctx.fill();
    ctx.fillStyle = rgbCss(rampColour(t.heat));
    ctx.beginPath();
    ctx.roundRect(meterX, y + 53, Math.max(6, (120 * t.score) / 100), 6, 3);
    ctx.fill();
  });

  // Credit, above the cards on the right.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = l.muted;
  ctx.font = `16px ${font}`;
  ctx.fillText(POSTCARD_CREDIT, W - margin, y - 16);
  ctx.textAlign = 'left';
}

/** The bytes of a base64 `data:` URL. */
export function decodeDataUrl(url: string): ArrayBuffer {
  const base64 = url.slice(url.indexOf(',') + 1);
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

/**
 * The postcard, drawn entirely in the page: the current view (3D city or 2D treemap) from its
 * postcard angle on a fixed gradient, then the text: repository name, window, the legend, the top
 * three at the detail the host chose, and the credit. Nothing else: no hover card, no file
 * contents, no path the host did not send. Returns PNG bytes.
 */
export function renderPostcard(
  message: PostcardMessage,
  view: CityView,
  themeKind: ThemeKind,
): { png: ArrayBuffer; ms: number } {
  const start = performance.now();
  const canvas = document.createElement('canvas');
  canvas.width = POSTCARD_WIDTH;
  canvas.height = POSTCARD_HEIGHT;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available');
  const l = postcardLook(themeKind);
  const backdrop = ctx.createLinearGradient(0, 0, 0, POSTCARD_HEIGHT);
  backdrop.addColorStop(0, l.gradient[0]);
  backdrop.addColorStop(1, l.gradient[1]);
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, POSTCARD_WIDTH, POSTCARD_HEIGHT);
  view.capture(ctx, POSTCARD_WIDTH, POSTCARD_HEIGHT, l);
  overlay(ctx, message, l);
  // Encoded synchronously: `toBlob` encodes in idle time, which a busy page can defer for seconds.
  const png = decodeDataUrl(canvas.toDataURL('image/png'));
  return { png, ms: performance.now() - start };
}
