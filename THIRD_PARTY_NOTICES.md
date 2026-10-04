# Third-party notices

Original QuietScore source and documentation: **BSD-2-Clause**, [LICENSE](LICENSE).

- **FIRST CVSS 4.0 reference implementation/data** — BSD-2-Clause. Copyright FIRST.ORG, Inc., Red Hat, and contributors; [FIRST-LICENSE](FIRST-LICENSE). Pinned revision and hashes are in `reference/provenance.json`. Definitions/guidance are attributed in [Sources](docs/SOURCES.md). No FIRST endorsement is implied.
- **Lucide icons 1.52.0** — ISC, with MIT notices for listed Feather-derived icons; [LUCIDE-LICENSE](LUCIDE-LICENSE). Export buttons use `file-json`, `file-text`, `file-type`, and `file-spreadsheet` SVGs from the pinned `lucide-static` package. They are free for personal/commercial use subject to the retained notices. Icons are embedded at build time; no CDN/font calls are made. [Upstream](https://lucide.dev/license).
- **Model Context Protocol SDK** — MIT; [MCP-LICENSE](MCP-LICENSE). Supplies stdio/HTTP protocol adapters. [Upstream](https://github.com/modelcontextprotocol/typescript-sdk).
- **Zod** — MIT; [ZOD-LICENSE](ZOD-LICENSE). Supplies MCP input schemas. [Upstream](https://github.com/colinhacks/zod).

The dependency lockfile records exact versions. Browser output embeds QuietScore, FIRST, and Lucide notices. Runtime and development dependencies retain their own licenses in their packages; the Rust scoring crate has no external dependencies. Public vulnerability records/advisories are linked and paraphrased with source attribution; their inclusion does not grant ownership of those sources.
