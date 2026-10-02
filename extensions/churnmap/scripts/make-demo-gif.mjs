// Records the README demo GIF and the two README screenshots (development only, never shipped).
//
//   node scripts/make-demo-gif.mjs            record, then encode
//   node scripts/make-demo-gif.mjs --encode   encode the frames already in test-output/demo/
//
// Recording runs the `demo` integration configuration (CHURNMAP_DEMO=1 in .vscode-test.mjs): VS Code
// stable opens the seeded demo repository (makeDemoRepo in test/fixtures/make-repo.mjs) and
// test/integration/demo.test.ts captures 150 frames at exact times on a frozen animation clock.
// Encoding turns them into media/readme/demo.gif (960×540, 15 fps, one shared palette, unchanged
// pixels transparent, repeated frames merged) and copies the stills to media/readme/.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import gifenc from 'gifenc';
import { decodePng } from '../test/fixtures/png.mjs';

// gifenc is CommonJS: its named exports are read off the default one.
const { applyPalette, GIFEncoder, quantize } = gifenc;

const FRAMES_DIR = 'test-output/demo';
const OUT_DIR = 'media/readme';
const FPS = 15;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_SECONDS = 10;

/** @param {string} command @param {string[]} args @param {Record<string, string>} [env] */
function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function encode() {
  const files = readdirSync(FRAMES_DIR)
    .filter((f) => /^frame-\d+\.png$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`no frames in ${FRAMES_DIR}; record them first`);
  const frames = files.map((f) => decodePng(readFileSync(join(FRAMES_DIR, f))));
  const { width, height } = frames[0] ?? { width: 0, height: 0 };

  // One palette for the whole GIF (255 colours, the last index is "unchanged"), from every 5th
  // frame, so colours do not shimmer between frames.
  const sample = frames.filter((_, i) => i % 5 === 0);
  const pool = new Uint8Array(sample.length * width * height * 4);
  sample.forEach((f, i) => pool.set(f.rgba, i * width * height * 4));
  const palette = quantize(pool, 255, { format: 'rgb565' });
  const clear = palette.length;
  palette.push([0, 0, 0]);

  /** @type {{ index: Uint8Array, delay: number }[]} */
  const out = [];
  let previous;
  for (const frame of frames) {
    const index = applyPalette(frame.rgba, palette, 'rgb565');
    if (previous && index.every((v, i) => v === previous[i])) {
      const last = out.at(-1);
      if (last) last.delay += 1000 / FPS;
      continue;
    }
    const delta = new Uint8Array(index);
    if (previous)
      for (let i = 0; i < delta.length; i++) if (delta[i] === previous[i]) delta[i] = clear;
    out.push({ index: delta, delay: 1000 / FPS });
    previous = index;
  }

  const gif = GIFEncoder();
  out.forEach(({ index, delay }, i) => {
    gif.writeFrame(index, width, height, {
      palette,
      delay: Math.round(delay),
      ...(i === 0 ? {} : { transparent: true, transparentIndex: clear, dispose: 1 }),
    });
  });
  gif.finish();
  mkdirSync(OUT_DIR, { recursive: true });
  const target = join(OUT_DIR, 'demo.gif');
  writeFileSync(target, gif.bytes());

  for (const still of ['city-dark.png', 'treemap-light.png']) {
    copyFileSync(join(FRAMES_DIR, still), join(OUT_DIR, still));
  }

  const bytes = statSync(target).size;
  const seconds = frames.length / FPS;
  console.log(
    `${target}: ${String(width)}×${String(height)}, ${String(frames.length)} frames at ${String(FPS)} fps ` +
      `(${String(out.length)} distinct), ${seconds.toFixed(1)} s, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
  );
  if (bytes > MAX_BYTES) throw new Error('the GIF is over 4 MB');
  if (seconds > MAX_SECONDS) throw new Error('the GIF is over 10 s');
}

if (!process.argv.includes('--encode')) {
  run('node', ['esbuild.mjs', '--tests']);
  run('pnpm', ['exec', 'vscode-test', '--label', 'demo'], { CHURNMAP_DEMO: '1' });
}
encode();
