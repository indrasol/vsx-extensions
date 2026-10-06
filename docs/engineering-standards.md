# Engineering standards

_Living document. Every extension in this repo meets these standards before release.
Security requirements are in [`security-practices.md`](security-practices.md)._

## Principles

1. **Useful in 60 seconds.** No setup is needed for the first "aha" moment.
2. **Local-first and privacy-first.** No network calls by default.
3. **Secure by default.** See `security-practices.md`.
4. **Small scope, high polish.** Do one job well; the README GIF shows the value in under 10 seconds.
5. **Works everywhere.** One VSIX, published to the VS Code Marketplace and Open VSX.

## Starting a new extension

Copy `templates/extension-starter/` to `extensions/<kebab-name>/`. The template contains:

```
extension-starter/
├── package.json          manifest
├── src/extension.ts      activate/deactivate, command registration
├── test/                 @vscode/test-cli + @vscode/test-electron integration tests
├── media/icon.png        256×256 PNG (SVG icons are not allowed)
├── media/demo.gif        ≤ 10 s, shown at the top of the README
├── README.md · CHANGELOG.md
├── esbuild.mjs           bundles to dist/extension.js
├── .vscodeignore         ship only dist/, media/, README, CHANGELOG, LICENSE
└── tsconfig.json
```

## Manifest (`package.json`)

- `name`, `displayName`, `description` (keyword-rich, under ~100 characters, ends with
  "by Indrasol Labs"), `publisher: "Indrasol"`, SemVer `version`, `license: "MIT"`,
  `repository`, `homepage`, `bugs`, `icon`, `galleryBanner`, `categories`, `keywords` (≤ 30).
- `engines.vscode` about 3 months behind the latest stable release, for reach.
- **Minimal activation:** specific `activationEvents` (commands, languages, `workspaceContains`). Never `*`.
- Declare `capabilities.untrustedWorkspaces` and `capabilities.virtualWorkspaces` honestly.
- Set `extensionKind` when the extension must run in the UI or workspace host (Remote, WSL, Codespaces).
- Add a `browser` entry when feasible so the extension works in vscode.dev and github.dev.
- Add a walkthrough (`contributes.walkthroughs`) for first-run onboarding.
- Only stable VS Code APIs. Proposed APIs cannot be used by Marketplace extensions.

## Code

- TypeScript strict, ESLint and Prettier clean. No `any` in public APIs.
- Bundle with esbuild into `dist/extension.js`; package with `vsce package --no-dependencies` (ADR-0002).
- **No network calls by default.** Any network feature is opt-in, uses HTTPS and is documented in the README.
- Secrets and tokens only in `context.secrets` (SecretStorage), never in settings or files.
- Respect Workspace Trust: disable anything that executes workspace code in untrusted workspaces.
- Performance budget: activation under 100 ms (time spent inside `activate()`, which returns it as
  `activationMs` for the integration test to assert; cold bundle loading is not counted), VSIX under
  1 MB where possible (measure with _Developer: Show Running Extensions_).
- Accessibility: every UI element has a keyboard path and an ARIA label and works in high-contrast themes.
- Tests: ≥ 70% coverage of core logic, plus at least one integration test that activates the extension.

## Telemetry

- Zero telemetry. Extensions collect nothing and store no install or user id.
- Any future measurement needs a new ADR (ADR-0006 is superseded).

## Definition of done (release-ready)

- Works in VS Code stable and at least one fork (Cursor), on macOS and Windows at minimum, and in
  Remote/WSL if relevant.
- A zero-configuration first run delivers value in under 60 seconds.
- README: GIF at the top, 3-bullet value summary, Quick start, Features, Settings, Works with,
  Privacy and telemetry, Security, FAQ, More from Indrasol Labs.
- `security-practices.md` release checklist passed and CI green.

## Git and releases

- Branches `ext/<name>/<task>` or `chore/<task>`; PRs into protected `main`; one human review; CI green.
- Conventional Commits with scope = workspace name: `feat(<ext>): …`.
- Releases only by tag `<ext>@vX.Y.Z` on `main` → `release.yml` (ADR-0003, ADR-0004).
