# Indrasol Labs — VS Code & Open VSX extensions

Small, secure, free developer tools for the AI-agent era, built by
[Indrasol](https://indrasol.com) Labs and published to the
[VS Code Marketplace](https://marketplace.visualstudio.com/publishers/Indrasol) and
[Open VSX](https://open-vsx.org/namespace/Indrasol) (Cursor, Windsurf, VSCodium and more).

Every extension is MIT-licensed, local-first (no network calls by default), and goes through a
security review, secret scanning, CodeQL and an SBOM before it ships. We build with AI agents and
review everything as humans: see [how we build](docs/how-we-build.md). See
[`SECURITY.md`](SECURITY.md) and [`docs/security-practices.md`](docs/security-practices.md).

![Churnmap: your repository as a 3D city of code hotspots](https://raw.githubusercontent.com/indrasol/vsx-extensions/main/extensions/churnmap/media/readme/demo.gif)

_[Churnmap](extensions/churnmap/README.md): your repository as a 3D city, with hotspots from git history._

## Extensions

| Extension                                 | What it does                                                                                                  | Marketplace                                                                      | Open VSX                                                    | Status   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [Churnmap](extensions/churnmap/README.md) | Your repository as a 3D city: code hotspots from git history, ranked and explained. AI-ready, zero telemetry. | [Install](https://marketplace.visualstudio.com/items?itemName=Indrasol.churnmap) | [Install](https://open-vsx.org/extension/Indrasol/churnmap) | Released |

## Repository layout

```
extensions/      one folder per published extension
packages/        labs-core (shared logger, links and the 'More from Indrasol Labs' view)
templates/       extension-starter, the golden template every extension copies
docs/            architecture, engineering standards, security practices, ADRs, specs, progress log
```

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md). Any open-source idea for developers is welcome, not
just extensions: tools, libraries, agents and more. Open an
[idea issue](https://github.com/indrasol/vsx-extensions/issues/new?template=idea.yml).

## License

MIT © Indrasol
