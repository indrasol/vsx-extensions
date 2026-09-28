# ADR 0008 — Naming and branding conventions

- **Status:** Accepted
- **Date:** 2026-09-27

## Context
Marketplace extension identifiers are permanent: a removed extension's name cannot be
reused, and the publisher id cannot change. Consistent naming also makes the "More from
Indrasol Labs" cross-promotion work.

## Decision
- Publisher / namespace: `Indrasol` (capital I, exactly as registered) on both registries. Display name "Indrasol".
- Extension id: `Indrasol.<kebab-name>`; workspace folder `extensions/<kebab-name>`;
  display name Title Case; description ends with "by Indrasol Labs".
- Release tags: `<kebab-name>@vX.Y.Z`. Commit scopes: the workspace name.
- Icons: 256×256 PNG (SVG is not allowed), one shared frame, unique glyph per extension.
- Every README ends with a "More from Indrasol Labs" section linking
  `https://indrasol.com/labs?utm_source=vscode&utm_campaign=<kebab-name>`.
- Disposable test extensions carry an obviously throwaway name (`labs-pipeline-smoke`) because
  the name is burned once published.

## Alternatives considered
- Prefixing every extension with `labs-`: clutters search results; the publisher already brands it.

## Consequences
Names are chosen at G1 (spec approval) and checked for collisions on both registries before
the first tag.
