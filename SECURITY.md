# Security policy

## Reporting

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/sethusrinivasan/quietscore/security/advisories/new). Include reproduction steps, affected commit/version, expected behavior, and impact. Do not include customer assessments or credentials. Use public issues for non-sensitive bugs. No response-time commitment is implied.

The maintained `main` branch is supported. Older releases receive fixes through an update to the current version.

## Controls

- Strict CVSS 4.0 validation rejects missing, duplicate, unknown, oversized, or invalid metrics. Scoring is compared against pinned FIRST reference data.
- Customer text is escaped in HTML/XML/JSON. XLSX exports use literal text cells, preventing spreadsheet formulas from being created from notes.
- Browser CSP blocks outgoing connections; vectors are excluded from URLs. Samples are locked and must be cloned before editing.
- Hosted MCP requires a bearer secret; explicit public access is disabled. Requests have a 32 KB body limit, 8 KB vector limit, origin checks, no-store responses, and fresh WASM state per call.
- Secrets are separate from source and build assets. Dependency versions are locked and CI actions are commit-pinned. Deployment credentials are unavailable to pull-request validation steps.

These controls reduce risk; they do not establish a formal security certification. The browser profile and exported files are not encrypted by QuietScore. Hosted MCP does not provide user identity, per-client authorization, or a built-in rate limiter.

## Operations

Restrict the deployment token to the target Worker, rotate exposed/revoked credentials, and keep the MCP token separate from Cloudflare deployment credentials. Set secrets through GitHub/Cloudflare secure settings, never chat or source files. Review dependency updates and FIRST provenance changes before merging. Failed tests prevent CI deployment. Revert through Git history or Cloudflare rollback as described in [Deployment](docs/DEPLOYMENT.md).

## Hosted authorization

MCP OAuth uses S256 PKCE, resource-bound tokens, browser-bound consent/state, and expiring grants. Per-client script tokens store hashes only and require authenticated, CSRF-checked management. GitHub upstream credentials never become MCP tokens. KV revocation is eventually consistent. See [Authentication](docs/AUTHENTICATION.md) for lifetimes, migration, and trust boundaries.
