/**
 * Test mode only: a screenshot of the whole webview (the city plus its HUD, rail, labels and card)
 * as one PNG, so a person can look at the design without opening VS Code. Webviews cannot capture
 * themselves, so the overlays are repainted onto the city frame: boxes (background, border,
 * radius, backdrop blur), text word by word at its laid-out position, and inline SVG through a
 * `data:` image (allowed by the CSP's `img-src data:`). Approximate by design: no box shadows.
 */

import { SVG_NS } from './svg.js';

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function transparent(colour: string): boolean {
  return colour === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(colour);
}

function hidden(el: Element, cs: CSSStyleDeclaration): boolean {
  return (
    (el instanceof HTMLElement && el.hidden === true) ||
    cs.display === 'none' ||
    cs.visibility === 'hidden' ||
    el.getClientRects().length === 0
  );
}

function loadImage(url: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      resolve(undefined);
    };
    img.src = url;
  });
}

interface Painter {
  ctx: CanvasRenderingContext2D;
  origin: DOMRect;
  /** The city frame alone, for backdrop blur. */
  scene: HTMLCanvasElement;
}

async function paintSvg(p: Painter, svg: SVGSVGElement, opacity: number): Promise<void> {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const colour = getComputedStyle(svg).color;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', SVG_NS);
  copy.setAttribute('width', String(rect.width));
  copy.setAttribute('height', String(rect.height));
  const text = new XMLSerializer().serializeToString(copy).replace(/currentColor/g, colour);
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`);
  if (!img) return;
  p.ctx.globalAlpha = opacity;
  p.ctx.drawImage(img, rect.left - p.origin.left, rect.top - p.origin.top, rect.width, rect.height);
}

function paintText(p: Painter, node: Text, cs: CSSStyleDeclaration, opacity: number): void {
  const content = node.data;
  if (!content.trim()) return;
  const { ctx } = p;
  ctx.globalAlpha = opacity;
  ctx.fillStyle = cs.color;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
  const range = document.createRange();
  const upper = cs.textTransform === 'uppercase';
  const re = /\S+/g;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const r = range.getClientRects()[0];
    if (!r || r.width === 0) continue;
    const word = upper ? m[0].toUpperCase() : m[0];
    const metrics = ctx.measureText(word);
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    const y = r.top - p.origin.top + (r.height - (ascent + descent)) / 2 + ascent;
    ctx.fillText(word, r.left - p.origin.left, y);
  }
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cs: CSSStyleDeclaration,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, [
    px(cs.borderTopLeftRadius),
    px(cs.borderTopRightRadius),
    px(cs.borderBottomRightRadius),
    px(cs.borderBottomLeftRadius),
  ]);
}

async function paintElement(p: Painter, el: Element, parentOpacity: number): Promise<void> {
  if (el instanceof HTMLCanvasElement) return;
  const cs = getComputedStyle(el);
  if (hidden(el, cs)) return;
  const opacity = parentOpacity * px(cs.opacity || '1');
  if (opacity <= 0.01) return;
  if (el instanceof SVGSVGElement) {
    await paintSvg(p, el, opacity);
    return;
  }
  const { ctx } = p;
  const rect = el.getBoundingClientRect();
  const x = rect.left - p.origin.left;
  const y = rect.top - p.origin.top;
  ctx.save();
  if (cs.backdropFilter.includes('blur')) {
    roundedPath(ctx, x, y, rect.width, rect.height, cs);
    ctx.clip();
    ctx.globalAlpha = opacity;
    ctx.filter = 'blur(12px)';
    ctx.drawImage(p.scene, 0, 0);
    ctx.filter = 'none';
  }
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = opacity;
  const stops = el instanceof HTMLElement ? el.dataset.stops : undefined;
  if (stops) {
    const gradient = ctx.createLinearGradient(x, 0, x + rect.width, 0);
    for (const stop of stops.split('|')) {
      const m = /^(.*)\s+([\d.]+)%$/.exec(stop.trim());
      if (m?.[1] && m[2]) gradient.addColorStop(Number(m[2]) / 100, m[1]);
    }
    ctx.fillStyle = gradient;
    roundedPath(ctx, x, y, rect.width, rect.height, cs);
    ctx.fill();
  } else if (!transparent(cs.backgroundColor)) {
    ctx.fillStyle = cs.backgroundColor;
    roundedPath(ctx, x, y, rect.width, rect.height, cs);
    ctx.fill();
  }
  const border = px(cs.borderTopWidth);
  if (border > 0 && !transparent(cs.borderTopColor)) {
    ctx.strokeStyle = cs.borderTopColor;
    ctx.lineWidth = border;
    roundedPath(ctx, x + border / 2, y + border / 2, rect.width - border, rect.height - border, cs);
    ctx.stroke();
  }
  const outline = px(cs.outlineWidth);
  if (cs.outlineStyle !== 'none' && outline > 0 && !transparent(cs.outlineColor)) {
    const offset = px(cs.outlineOffset) + outline / 2;
    ctx.strokeStyle = cs.outlineColor;
    ctx.lineWidth = outline;
    ctx.strokeRect(x - offset, y - offset, rect.width + 2 * offset, rect.height + 2 * offset);
  }
  // Text is clipped to its box (ellipsized labels keep inside their pill).
  const clip = cs.overflow !== 'visible' || cs.textOverflow === 'ellipsis';
  if (clip) {
    ctx.beginPath();
    ctx.rect(x, y, rect.width, rect.height);
    ctx.clip();
  }
  for (const child of el.childNodes) {
    if (child instanceof Text) paintText(p, child, cs, opacity);
  }
  ctx.restore();
  for (const child of el.children) {
    ctx.save();
    if (clip) {
      ctx.beginPath();
      ctx.rect(x, y, rect.width, rect.height);
      ctx.clip();
    }
    await paintElement(p, child, opacity);
    ctx.restore();
  }
}

/**
 * Draws `drawScene` (the city) and then every visible overlay under `root`, in stacking order,
 * into a `width` × `height` PNG.
 */
export async function composeSnapshot(
  root: HTMLElement,
  width: number,
  height: number,
  drawScene: (ctx: CanvasRenderingContext2D) => void,
): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available');
  drawScene(ctx);
  const scene = document.createElement('canvas');
  scene.width = width;
  scene.height = height;
  scene.getContext('2d')?.drawImage(canvas, 0, 0);
  const painter: Painter = { ctx, origin: root.getBoundingClientRect(), scene };
  const layers = [...root.children]
    .filter((c) => !(c instanceof HTMLCanvasElement))
    .map((c, i) => ({ c, i, z: Number.parseInt(getComputedStyle(c).zIndex, 10) || 0 }))
    .sort((a, b) => a.z - b.z || a.i - b.i);
  for (const { c } of layers) await paintElement(painter, c, 1);
  const url = canvas.toDataURL('image/png');
  const text = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}
