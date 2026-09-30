# ADR 0011 — Webview rendering: bundled libraries, strict CSP, no remote assets

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

Some Labs extensions render rich views (2D/3D canvases, charts) inside a VS Code webview.
Webviews are ordinary browser contexts: anything loaded from the network or evaluated
dynamically becomes an attack surface inside the editor, and the Marketplace and Open VSX
both scan for remote script loading. Extensions must also work fully offline and in
restricted corporate networks.

## Decision

- Every library a webview needs (for example a 3D renderer) is a pinned npm dependency
  bundled by esbuild into `media/webview.js`; nothing is loaded from a CDN at runtime.
- The webview HTML sets a strict Content Security Policy:
  `default-src 'none'; script-src 'nonce-<nonce>'; style-src 'nonce-<nonce>' <cspSource>; img-src <cspSource> data:;`
  with a fresh nonce per panel, `localResourceRoots` limited to the extension's `media/`, and
  no `unsafe-eval` or `unsafe-inline`.
- The extension host and the webview exchange messages that carry only paths, numbers and
  short strings. File contents never cross into the webview; the host opens files itself.
- Exports (images, reports) are produced inside the webview and handed back as bytes; the
  host writes them only after a `showSaveDialog` chosen by the user.
- Large data sets are rendered with instancing or level-of-detail folding so the webview
  stays responsive; a hard cap on item count is a user setting.

## Alternatives considered

- Loading renderer libraries from a CDN: smaller VSIX, but fails offline and violates the
  no-remote-code rule in `docs/security-practices.md`.
- Rendering in the extension host and sending images: no CSP concerns, but no interaction.

## Consequences

VSIX size grows by the bundled renderer (budget: about 1 MB total). Every webview change
runs the CSP check in the integration tests. Theme changes are forwarded as messages so the
webview matches the editor's colours without loading VS Code CSS remotely.
