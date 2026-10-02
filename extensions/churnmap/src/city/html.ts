/**
 * The city webview's HTML. Pure (the host passes in the nonce and URIs), so the CSP can be
 * unit-tested exactly as ADR-0011 states it.
 */

export interface HtmlOptions {
  /** Fresh per panel: 32 random bytes, base64url. */
  nonce: string;
  /** `webview.asWebviewUri(media/webview.js)`. */
  scriptUri: string;
  /** `webview.asWebviewUri(media/webview.css)`. */
  styleUri: string;
  /** `webview.cspSource`. */
  cspSource: string;
  /** Test mode: the script URL carries `?test=1`, which enables the test-only messages. */
  test?: boolean;
}

/** The Content Security Policy from ADR-0011, verbatim. */
export function contentSecurityPolicy(nonce: string, cspSource: string): string {
  return `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}' ${cspSource}; img-src ${cspSource} data:;`;
}

/**
 * Escapes text for a text node or a double-quoted attribute (every attribute here is
 * double-quoted, so `'` stays as is and the CSP reads exactly as ADR-0011 writes it).
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderHtml(opts: HtmlOptions): string {
  const nonce = escapeHtml(opts.nonce);
  const csp = escapeHtml(contentSecurityPolicy(opts.nonce, opts.cspSource));
  const script = escapeHtml(opts.test === true ? `${opts.scriptUri}?test=1` : opts.scriptUri);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" nonce="${nonce}" href="${escapeHtml(opts.styleUri)}">
<title>Churnmap</title>
</head>
<body>
<div id="app">
<div id="hud"></div>
<canvas id="city" tabindex="0" aria-label="Churnmap city" aria-describedby="city-help"></canvas>
<p id="city-help" class="visually-hidden">Arrow keys orbit, Shift and arrow keys pan, plus and minus zoom, Home resets the view, T opens the list of top hotspots, 2 switches between the 3D city and the 2D treemap. Click a building to select it, double-click or press Enter to open it, A asks AI about it, Escape clears the selection.</p>
<p id="status" class="visually-hidden" role="status" aria-live="polite"></p>
</div>
<noscript><p class="noscript">The Churnmap city needs scripts, which this view has disabled.</p></noscript>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>
`;
}

/** A script-free page with one line of text (for example: the workspace is not trusted). */
export function renderMessageHtml(
  opts: Pick<HtmlOptions, 'nonce' | 'styleUri' | 'cspSource'> & {
    message: string;
  },
): string {
  const nonce = escapeHtml(opts.nonce);
  const csp = escapeHtml(contentSecurityPolicy(opts.nonce, opts.cspSource));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" nonce="${nonce}" href="${escapeHtml(opts.styleUri)}">
<title>Churnmap</title>
</head>
<body>
<p class="message" role="status">${escapeHtml(opts.message)}</p>
</body>
</html>
`;
}
