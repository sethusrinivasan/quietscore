# Privacy

QuietScore requires no calculator account and does not collect assessment analytics.

## Browser and offline calculator

The hosted page loads application assets from Cloudflare. Scoring and validation run in Rust/WebAssembly on the device. Imported files, assessment notes, and exports are processed locally. Vectors are never placed in URLs. The application makes no scoring/API requests, uses no external fonts or scripts, and sets no cookies. Content Security Policy uses `connect-src 'none'`.

Drafts are saved only on request in browser localStorage. They are not encrypted or synced by QuietScore. Anyone with access to that browser profile may read them; clearing site data removes them. Delete drafts in the UI or clear the browser’s site storage. Appearance is a session preference. Downloads and clipboard writes occur only when requested.

The offline HTML embeds the engine, data, icons, and styles. Open it from disk with networking disabled to avoid host requests. Following an external source link contacts its destination.

## MCP

Local stdio MCP processes vectors on the client machine. An AI client may independently send them to its model provider.

Hosted MCP sends vectors over HTTPS to Cloudflare. The Worker uses fresh WASM memory per call and does not persist, cache, or log assessments. Hosted MCP is remote processing; use local MCP or the offline calculator when data must remain on the device.

## Boundaries

Cloudflare may process request/security metadata under its own policies. Application logs/traces and Wrangler telemetry are disabled, but this does not promise that platform-level access records do not exist. Browser extensions, malware, OS synchronization, clipboard managers, print destinations, and AI-provider policies are outside QuietScore’s control.

GitHub README badges and repository services are external resources used on GitHub; they are not loaded by the calculator. CI runs only synthetic fixtures and public sample data. Public CI reports may contain screenshots and traces of those fixtures. Never add private assessments or credentials to tests, issues, or pull requests.
