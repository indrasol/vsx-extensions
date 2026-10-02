// A small PNG decoder for the dev scripts and integration tests (never shipped).
import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';

/**
 * Decodes an 8-bit, non-interlaced RGB or RGBA PNG (what a canvas writes) to RGBA pixels.
 * @param {Buffer} png
 */
export function decodePng(png) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 0;
  const data = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colourType = body[9] ?? 0;
      if (body[8] !== 8 || body[12] !== 0 || (colourType !== 2 && colourType !== 6)) {
        throw new Error('only 8-bit, non-interlaced RGB or RGBA PNGs are supported');
      }
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? (rows[out + x - channels] ?? 0) : 0;
      const b = y > 0 ? (rows[out - stride + x] ?? 0) : 0;
      const c = x >= channels && y > 0 ? (rows[out - stride + x - channels] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      rows[out + x] = ((line[x] ?? 0) + predicted) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: rows };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
    rgba[j] = rows[i] ?? 0;
    rgba[j + 1] = rows[i + 1] ?? 0;
    rgba[j + 2] = rows[i + 2] ?? 0;
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}
