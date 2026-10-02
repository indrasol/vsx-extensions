import type { AnyWebviewToHost } from '../src/city/protocol.js';

interface VsCodeApi {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** The one handle to the host; `acquireVsCodeApi` may only be called once per page. */
const api = acquireVsCodeApi();

/**
 * Test-only message types are rejected by the host's guard outside test mode. `transfer` hands
 * over buffers (the postcard's PNG) instead of copying them.
 */
export function post(message: AnyWebviewToHost, transfer?: Transferable[]): void {
  if (transfer) api.postMessage(message, transfer);
  else api.postMessage(message);
}

/**
 * Test mode: the host renders the script URL with `?test=1` only when the extension runs in
 * test mode (renderHtml). Read once, while this script is the current script.
 */
export const TEST_MODE = ((): boolean => {
  const src = document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : '';
  try {
    return new URL(src).searchParams.get('test') === '1';
  } catch {
    return false;
  }
})();
