# Testing

## Run locally

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm exec playwright install --with-deps
pnpm test:all
pnpm typecheck
pnpm format:check
```

`pnpm test` runs Rust units, source/provenance checks, exhaustive FIRST parity, file/privacy checks, and Node/WASM/MCP tests. `pnpm test:ui` runs Playwright against a local static server on port 4174. Browser binaries, OS libraries, and OpenSSL (for an ephemeral localhost test certificate) are test-only dependencies. Chromium, Firefox, WebKit, and mobile Chromium/dark projects run the same workflow cases. Tests use isolated browser contexts and synthetic notes.

## Coverage

Rust tests cover parsing, defaults, modified-metric inheritance, Supplemental invariance, canonicalization, boundaries, escaping, ZIP CRC, and literal XLSX cells. Node tests cover local-storage failures, draft metadata, sample locking/cloning, file envelopes, source contexts, semantic contrast, MCP transports, authentication, origins, request bounds, and fresh call state. FIRST parity covers 104,976 exhaustive Base vectors plus 12,000 optional combinations.

Browser tests cover valid/invalid vectors, hidden empty read-only notes, cloning, wizard navigation, expanded notes, multiple drafts/reload, JSON/text/XLSX downloads, JSON restoration, printable PDF content, offline calculation/no network calls, export icons, keyboard tabs, themes, and viewport overflow. They test report contents rather than automating OS print dialogs. A desktop browser with a mobile viewport is not physical-device certification.

## Results and pass rates

Every unit/browser run prints counts and a pass rate. Reports are saved under ignored `reports/`:

- `unit.json`, `rust-junit.xml`, and `node-junit.xml`
- `playwright.json`, `browser-junit.xml`, and `browser-html/`
- `summary.md`, including passed, failed, skipped, and per-suite rates

Pass rate is `passed / (passed + failed)`. Skipped/not-run suites are reported separately; verification failures still fail the command. Vector comparisons are reported separately from test-case counts. Browser retries are disabled so failures are not hidden by retries. Traces/screenshots are retained on failures.

GitHub Actions publishes the summary and a seven-day artifact on every run, including failures. Reports contain synthetic fixtures; do not use customer data in tests. Missing reports are identified as not run. The README CI badge reflects the whole workflow, including deployment permissions; a red deployment badge does not imply the scoring tests failed.

## Authentication coverage

Node tests cover OAuth discovery, redirect/PKCE validation, consent browser binding, HTML escaping, GitHub identity exchange with a synthetic upstream, token audience, refresh/revocation, script-token hashing/expiry/owner isolation, and management CSRF. A Node loader supplies only the WorkerEntrypoint base-class marker imported by the library; these tests use exported fetch handlers and in-memory KV. Wrangler packaging and live endpoint checks separately verify the Worker runtime. A real GitHub/browser sign-in is checked during initial setup, not replayed in CI with production credentials.

Playwright also renders the actual auth handler responses with isolated in-memory KV and synthetic identities. Browser cases submit CSRF-protected token creation/revocation/sign-out forms and submit browser-bound consent, verify the generated GitHub URL, and follow a fixture-only local substitute for that external redirect. CSP allowlists are asserted in Node tests and real GitHub redirects are checked during setup. They catch CSP redirect restrictions and the Referrer-Policy/Origin interaction. The UI runner bundles its fixture with an unused WorkerEntrypoint marker; production builds do not use that marker. No production credentials are used in CI.
