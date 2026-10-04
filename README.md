# QuietScore

[![Live site](https://img.shields.io/badge/Live-QuietScore-2563eb?logo=cloudflare)](https://quietscore.cancun.workers.dev/)
[![CI and deployment](https://github.com/sethusrinivasan/quietscore/actions/workflows/cloudflare.yml/badge.svg?branch=main)](https://github.com/sethusrinivasan/quietscore/actions/workflows/cloudflare.yml)
[![License: BSD-2-Clause](https://img.shields.io/badge/License-BSD--2--Clause-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.2.0-475569)](package.json)
[![CVSS 4.0](https://img.shields.io/badge/CVSS-4.0-0f766e)](https://www.first.org/cvss/v4.0/specification-document)
[![Rust + WebAssembly](https://img.shields.io/badge/Rust-WebAssembly-654ff0?logo=rust)](docs/DESIGN.md)

**Clear severity. Quiet data.** A private CVSS 4.0 calculator with a Rust/WebAssembly scoring engine and MCP tools.

[Open calculator](https://quietscore.cancun.workers.dev/) · [Download offline edition](https://quietscore.cancun.workers.dev/quietscore-offline.html) · [Source provenance](docs/SOURCES.md)

## Capabilities

- Paste and validate a CVSS 4.0 vector, or assess all 32 metrics through a guided wizard.
- Save multiple drafts locally; add optional assessment and metric notes.
- Explore ten attributed vulnerability samples. Published samples are read-only; clone one to start an assessment. Empty metric notes are omitted in read-only mode.
- Export JSON, plain text, PDF, or Excel. JSON restores assessment notes; text restores the vector. PDF uses the browser’s print/save dialog; Excel is a static snapshot.
- Use responsive light, dark, and high-contrast views with keyboard controls and labelled severity cues.
- Use the same engine through local stdio or authenticated hosted MCP: `cvss_calculate`, `cvss_explain`, and `cvss_metric`.

Browser scoring, drafts, imports, and exports stay on the device. No analytics or scoring API calls are made by the calculator. Hosted MCP processes vectors at Cloudflare; AI-client handling and host request metadata have separate privacy boundaries. See [Privacy](PRIVACY.md).

CVSS measures vulnerability severity, not exploitation probability or complete business risk. QuietScore is independent of FIRST and is not certified or endorsed by it.

## Development

Requires Node 22+, pnpm 10.17.1, Python 3, and rustup. `rust-toolchain.toml` pins Rust and installs the WASM target and rustfmt.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dev
```

Open the local URL reported by Wrangler. The build produces `dist/index.html`, the self-contained offline edition, and the shared MCP WASM module. Maintained source stays readable; release builds optimize Rust/WASM and minify browser assets.

```sh
pnpm format:check
pnpm typecheck
pnpm exec playwright install --with-deps
pnpm test:all
```

Test runs report pass rates and emit JUnit, JSON, and browser HTML reports. GitHub Actions publishes the summary and downloadable reports even when tests fail. See [Testing](docs/TESTING.md).

## Deployment and MCP

One Cloudflare Worker with Static Assets serves the project. No databases, queues, storage services, or paid add-ons are required. Static asset requests are free; Worker calls use the account’s plan allowance. Keep the Workers Free plan for a free-first deployment. [Cloudflare billing details](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

Every push to `main` triggers build, unit/parity checks, cross-browser tests, bundle validation, deployment, and smoke checks. Pull requests run validation without deployment credentials. Production CI needs `CLOUDFLARE_API_TOKEN` as a repository secret and `CLOUDFLARE_ACCOUNT_ID` as a repository variable. See [Deployment](docs/DEPLOYMENT.md), including token permissions and rollback instructions.

Local MCP: `pnpm mcp:stdio`. Hosted MCP: `https://quietscore.cancun.workers.dev/mcp`, using its separate bearer token. The browser calculator never calls this endpoint.

## Documentation

- [Privacy](PRIVACY.md) and [Security policy](SECURITY.md)
- [Architecture, design, and interaction flows](docs/DESIGN.md)
- [Testing and result publication](docs/TESTING.md)
- [Deployment and operations](docs/DEPLOYMENT.md)
- [CVSS sources and sample acknowledgments](docs/SOURCES.md)

## License and acknowledgments

QuietScore’s original code and documentation use [BSD-2-Clause](LICENSE), permitting commercial use and redistribution with attribution and the license disclaimer. FIRST’s calculator data/reference code retains its [BSD-2-Clause notice](FIRST-LICENSE). Scoring definitions and guidance come from [FIRST’s official materials](docs/SOURCES.md).

Export icons are [Lucide](https://lucide.dev/), version 1.52.0, free for personal and commercial use under the [ISC license](LUCIDE-LICENSE). Four SVGs are embedded locally; there is no icon CDN or font request. The retained upstream notice also covers Feather-derived icons under MIT. See [third-party notices](THIRD_PARTY_NOTICES.md).
