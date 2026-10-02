/**
 * The postcard export's steps, with every VS Code and webview call injected, so the order (and
 * above all "nothing is written before the save dialog") is unit-tested. `postcard.ts` wires it.
 */
import type { PostcardDetail, PostcardMessage, WebviewToHost } from '../city/protocol.js';

export const POSTCARD_TIMEOUT_MS = 10_000;

/** The city panel as the export uses it. */
export interface PostcardPanel {
  whenReady(timeoutMs: number): Promise<void>;
  request(
    message: PostcardMessage,
    replyTypes: readonly WebviewToHost['type'][],
    timeoutMs: number,
  ): Promise<WebviewToHost>;
}

export type RenderResult = { ok: true; png: Uint8Array; ms: number } | { ok: false; error: string };

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${what} timed out after ${String(ms / 1000)} s`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Asks the city for the PNG; any failure (including no answer in time) is an error result. */
export async function renderPostcard(
  panel: PostcardPanel,
  message: PostcardMessage,
  timeoutMs = POSTCARD_TIMEOUT_MS,
): Promise<RenderResult> {
  try {
    const reply = await withTimeout(
      (async () => {
        await panel.whenReady(timeoutMs);
        return panel.request(message, ['postcardResult', 'postcardError'], timeoutMs);
      })(),
      timeoutMs,
      'Rendering the postcard',
    );
    if (reply.type === 'postcardResult') {
      return { ok: true, png: new Uint8Array(reply.png), ms: reply.ms };
    }
    if (reply.type === 'postcardError') return { ok: false, error: reply.message };
    return { ok: false, error: `unexpected reply ${reply.type}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface PostcardFlowDeps<Target> {
  hasResult(): boolean;
  /** "Build the city first", with a Build button. */
  offerBuild(): void;
  currentDetail(): PostcardDetail;
  pickDetail(current: PostcardDetail): Promise<PostcardDetail | undefined>;
  rememberDetail(detail: PostcardDetail): Promise<void>;
  render(detail: PostcardDetail): Promise<RenderResult>;
  /** The save dialog; undefined when cancelled. */
  chooseTarget(): Promise<Target | undefined>;
  save(target: Target, png: Uint8Array): Promise<void>;
  saved(target: Target, bytes: number): void;
  failed(message: string): void;
}

export type PostcardOutcome = 'saved' | 'no-result' | 'cancelled' | 'failed';

/**
 * Detail level (remembered) → render in the webview → save dialog → write. The bytes stay in
 * memory until the user has picked a file; cancelling anywhere writes nothing.
 */
export async function exportPostcardFlow<Target>(
  deps: PostcardFlowDeps<Target>,
): Promise<PostcardOutcome> {
  if (!deps.hasResult()) {
    deps.offerBuild();
    return 'no-result';
  }
  const detail = await deps.pickDetail(deps.currentDetail());
  if (detail === undefined) return 'cancelled';
  await deps.rememberDetail(detail);
  const rendered = await deps.render(detail);
  if (!rendered.ok) {
    deps.failed(`Churnmap: the postcard could not be made (${rendered.error}).`);
    return 'failed';
  }
  const target = await deps.chooseTarget();
  if (target === undefined) return 'cancelled';
  try {
    await deps.save(target, rendered.png);
  } catch (err) {
    deps.failed(
      `Churnmap: the postcard could not be saved (${err instanceof Error ? err.message : String(err)}).`,
    );
    return 'failed';
  }
  deps.saved(target, rendered.png.byteLength);
  return 'saved';
}
