import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  escapeHtml,
  renderHtml,
  renderMessageHtml,
} from '../../../src/city/html.js';

const NONCE = 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c';
const CSP_SOURCE = 'https://*.vscode-cdn.net';
const OPTS = {
  nonce: NONCE,
  scriptUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/media/webview.js',
  styleUri: 'https://file+.vscode-resource.vscode-cdn.net/ext/media/webview.css',
  cspSource: CSP_SOURCE,
};

/** ADR-0011, with the placeholders filled in. */
const ADR_0011_CSP = `default-src 'none'; script-src 'nonce-${NONCE}'; style-src 'nonce-${NONCE}' ${CSP_SOURCE}; img-src ${CSP_SOURCE} data:;`;

function cspOf(html: string): string | undefined {
  return /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1];
}

describe('renderHtml', () => {
  const html = renderHtml(OPTS);

  it('sets the CSP from ADR-0011 exactly', () => {
    expect(contentSecurityPolicy(NONCE, CSP_SOURCE)).toBe(ADR_0011_CSP);
    expect(cspOf(html)).toBe(ADR_0011_CSP);
  });

  it('allows nothing unsafe and loads nothing remote', () => {
    expect(html).not.toMatch(/unsafe-/);
    // The only URLs are the webview resource URIs the host passed in.
    const urls = html.match(/https?:\/\/[^\s"';]+/g) ?? [];
    for (const url of urls) {
      expect(
        url === OPTS.scriptUri ||
          url === OPTS.styleUri ||
          url === CSP_SOURCE.replace('*', '') ||
          url === CSP_SOURCE,
        url,
      ).toBe(true);
    }
    expect(
      renderHtml({ ...OPTS, scriptUri: 'x.js', styleUri: 'x.css', cspSource: 'vscode-webview:' }),
    ).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/\son[a-z]+=/i); // no inline event handlers
    expect(html).not.toMatch(/\sstyle=/i); // no inline styles
  });

  it('puts the nonce on every script and stylesheet, and loads only those two', () => {
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    const links = html.match(/<link\b[^>]*>/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(links).toHaveLength(1);
    for (const tag of [...scripts, ...links]) expect(tag).toContain(`nonce="${NONCE}"`);
    expect(scripts[0]).toContain(`src="${OPTS.scriptUri}"`);
    expect(links[0]).toContain(`href="${OPTS.styleUri}"`);
    expect(html).not.toMatch(/<style\b/);
  });

  it('has a focusable canvas, an aria-live status line and a noscript fallback', () => {
    expect(html).toMatch(/<canvas id="city" tabindex="0" aria-label="Churnmap city"/);
    expect(html).toMatch(/aria-describedby="city-help"/);
    expect(html).toMatch(/<p id="city-help"[^>]*>Arrow keys orbit/);
    expect(html).toMatch(/role="status" aria-live="polite"/);
    expect(html).toMatch(/<noscript>/);
  });

  it('puts the HUD before the canvas, so its controls come first in the focus order', () => {
    expect(html.indexOf('id="hud"')).toBeGreaterThan(0);
    expect(html.indexOf('id="hud"')).toBeLessThan(html.indexOf('<canvas'));
  });

  it('adds ?test=1 to the script only in test mode', () => {
    expect(html).not.toContain('test=1');
    expect(renderHtml({ ...OPTS, test: true })).toContain(`src="${OPTS.scriptUri}?test=1"`);
  });

  it('escapes what it interpolates', () => {
    const hostile = renderHtml({ ...OPTS, scriptUri: '"><script>alert(1)</script>' });
    expect(hostile).not.toContain('<script>alert(1)');
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(`&lt;a href=&quot;x&quot;&gt;&amp;'&lt;/a&gt;`);
  });
});

describe('renderMessageHtml', () => {
  it('is script-free, keeps the CSP and escapes the message', () => {
    const html = renderMessageHtml({ ...OPTS, message: 'Trust <this> workspace' });
    expect(cspOf(html)).toBe(ADR_0011_CSP);
    expect(html).not.toMatch(/<script\b/);
    expect(html).toContain('Trust &lt;this&gt; workspace');
  });
});
