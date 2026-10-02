import { describe, expect, it } from 'vitest';
import type { PostcardDetail, PostcardMessage, WebviewToHost } from '../../../src/city/protocol.js';
import {
  exportPostcardFlow,
  type PostcardFlowDeps,
  type PostcardPanel,
  renderPostcard,
} from '../../../src/export/flow.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MESSAGE: PostcardMessage = {
  type: 'postcard',
  detail: 'none',
  repoName: 'r',
  window: 90,
  top: [{ rank: 1, label: '#1', score: 90, heat: 100 }],
};

function panel(
  reply: () => Promise<WebviewToHost>,
  ready = () => Promise.resolve(),
): PostcardPanel {
  return { whenReady: ready, request: () => reply() };
}

describe('renderPostcard', () => {
  it('returns the bytes of a result', async () => {
    const result = await renderPostcard(
      panel(() =>
        Promise.resolve({
          type: 'postcardResult',
          png: PNG.buffer,
          width: 1600,
          height: 900,
          ms: 5,
        }),
      ),
      MESSAGE,
    );
    expect(result).toEqual({ ok: true, png: PNG, ms: 5 });
  });

  it('turns a webview error into an error result', async () => {
    const result = await renderPostcard(
      panel(() => Promise.resolve({ type: 'postcardError', message: 'no WebGL' })),
      MESSAGE,
    );
    expect(result).toEqual({ ok: false, error: 'no WebGL' });
  });

  it('times out when the panel never answers (or never gets ready)', async () => {
    const never = () => new Promise<never>(() => undefined);
    const start = Date.now();
    expect(await renderPostcard(panel(never), MESSAGE, 30)).toEqual({
      ok: false,
      error: 'Rendering the postcard timed out after 0.03 s',
    });
    expect(Date.now() - start).toBeLessThan(1000);
    const notReady = await renderPostcard(panel(never, never), MESSAGE, 30);
    expect(notReady.ok).toBe(false);
  });

  it('reports a rejected request and an unexpected reply', async () => {
    expect(
      await renderPostcard(
        panel(() => Promise.reject(new Error('panel closed'))),
        MESSAGE,
      ),
    ).toEqual({ ok: false, error: 'panel closed' });
    expect(
      await renderPostcard(
        panel(() => Promise.resolve({ type: 'ready' })),
        MESSAGE,
      ),
    ).toEqual({ ok: false, error: 'unexpected reply ready' });
  });
});

/** Records every step; nothing is written unless `save` is called. */
function flow(over: Partial<PostcardFlowDeps<string>> = {}) {
  const log: string[] = [];
  const written: [string, number][] = [];
  const deps: PostcardFlowDeps<string> = {
    hasResult: () => true,
    offerBuild: () => log.push('offerBuild'),
    currentDetail: () => 'paths',
    pickDetail: (current) => {
      log.push(`pick:${current}`);
      return Promise.resolve<PostcardDetail>('districts');
    },
    rememberDetail: (detail) => {
      log.push(`remember:${detail}`);
      return Promise.resolve();
    },
    render: (detail) => {
      log.push(`render:${detail}`);
      return Promise.resolve({ ok: true, png: PNG, ms: 3 });
    },
    chooseTarget: () => {
      log.push('dialog');
      return Promise.resolve('/out/card.png');
    },
    save: (target, png) => {
      written.push([target, png.byteLength]);
      return Promise.resolve();
    },
    saved: (target, bytes) => log.push(`saved:${target}:${String(bytes)}`),
    failed: (message) => log.push(`failed:${message}`),
    ...over,
  };
  return { deps, log, written };
}

describe('exportPostcardFlow', () => {
  it('asks the detail (preselecting the setting), remembers it, renders, then asks where to save', async () => {
    const { deps, log, written } = flow();
    expect(await exportPostcardFlow(deps)).toBe('saved');
    expect(log).toEqual([
      'pick:paths',
      'remember:districts',
      'render:districts',
      'dialog',
      'saved:/out/card.png:11',
    ]);
    expect(written).toEqual([['/out/card.png', 11]]);
  });

  it('offers a build when there is nothing to draw', async () => {
    const { deps, log, written } = flow({ hasResult: () => false });
    expect(await exportPostcardFlow(deps)).toBe('no-result');
    expect(log).toEqual(['offerBuild']);
    expect(written).toEqual([]);
  });

  it('writes nothing when the detail pick or the save dialog is cancelled', async () => {
    const a = flow({ pickDetail: () => Promise.resolve(undefined) });
    expect(await exportPostcardFlow(a.deps)).toBe('cancelled');
    expect(a.log).toEqual([]);
    const b = flow({ chooseTarget: () => Promise.resolve(undefined) });
    expect(await exportPostcardFlow(b.deps)).toBe('cancelled');
    expect(b.written).toEqual([]);
    expect(b.log.some((l) => l.startsWith('saved'))).toBe(false);
  });

  it('reports a render failure (e.g. the timeout) without opening the save dialog', async () => {
    const { deps, log, written } = flow({
      render: () =>
        Promise.resolve({ ok: false, error: 'Rendering the postcard timed out after 10 s' }),
    });
    expect(await exportPostcardFlow(deps)).toBe('failed');
    expect(log.at(-1)).toBe(
      'failed:Churnmap: the postcard could not be made (Rendering the postcard timed out after 10 s).',
    );
    expect(log).not.toContain('dialog');
    expect(written).toEqual([]);
  });

  it('reports a failed write', async () => {
    const { deps, log } = flow({ save: () => Promise.reject(new Error('EACCES')) });
    expect(await exportPostcardFlow(deps)).toBe('failed');
    expect(log.at(-1)).toBe('failed:Churnmap: the postcard could not be saved (EACCES).');
  });
});
