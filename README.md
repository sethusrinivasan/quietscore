# Quiet CVSS

A static CVSS 4.0 calculator with a dependency-free Rust engine compiled to WebAssembly. It supports all 32 Base, Threat, Environmental, and Supplemental metrics, explicit metric guidance, vector validation, canonicalization, JSON/text import and export, clipboard copy, and a single-file offline edition.

## Design decisions after reviewing FIRST

FIRST's reference is authoritative for scoring and metric definitions. Quiet CVSS improves the working surface through always-visible selected-value explanations, comparison disclosures usable without hovering, accessible grouped radios, keyboard tabs, responsive layout, a persistent score panel, and explicit validation errors. Optional groups are kept in separate tabs; Supplemental values are preserved without changing severity. The initial assessment is the vector supplied in the request (7.6, High).

The Rust implementation uses FIRST's MacroVector lookup/interpolation algorithm, not a weighted approximation. Severity bands are None 0, Low 0.1–3.9, Medium 4.0–6.9, High 7.0–8.9, Critical 9.0–10.0. A CVSS score communicates vulnerability severity and does not estimate exploitation probability or replace a complete risk assessment.

## Architecture

- `src/lib.rs`: parsing, canonicalization, effective metric values, scoring, in-memory state, HTML rendering, report serialization.
- `src/metrics.rs`: generated plain-language metric definitions.
- `src/tables.rs`: FIRST's lookup/maxima data converted to Rust matches.
- `bridge.js`: the minimal browser bridge for DOM events, File API, clipboard, and Blob downloads. JSON decoding for file envelopes is browser-side; the contained vector is validated and scored in Rust. There is no JavaScript scoring fallback.
- `style.css`: responsive presentation.
- `scripts/package.cjs`: embeds WebAssembly, styles, and the browser bridge into one HTML file and hashes the executable script for CSP.

A website still requires HTML/CSS and a small JavaScript bridge to call browser APIs. The entire calculation/state/rendering core runs in Rust/WASM; this is not a claim of literally zero JavaScript.

## Privacy model

The calculator has no backend, analytics, remote fonts, runtime third-party scripts, cookies, browser storage, network APIs, or logging of assessments. All current state exists in WASM memory and the visible DOM. Reloading discards it. Clipboard copying and file export are explicit user actions. Imported files are read locally. Vectors are never written into URLs. Content Security Policy blocks outbound connections with `connect-src 'none'`, disallows arbitrary scripts, forms, objects, and remote assets. External FIRST documentation opens only when its link is clicked, with no referrer.

Hosted page loads still expose request metadata to the hosting/access provider, which may keep access logs and may use its own authentication. WebAssembly does not itself confer privacy. The downloadable `dist/quiet-cvss-offline.html` embeds everything required for the calculator and works directly from disk; opening it with networking disabled avoids host requests. Browser extensions, OS clipboard synchronization, malware, and explicitly invoking a browser agent are outside this calculator's privacy boundary. Optional browser WebMCP integration exposes only a local vector-apply operation and does not itself transmit data.

No user assessments or imported customer data were used for development or sent to a server. The hosted deployment contains application source/assets only.

## Build

Requires Rust with `wasm32-unknown-unknown`, Python 3, and Node.js. No Rust crates or npm dependencies are needed.

```sh
rustup target add wasm32-unknown-unknown
python3 scripts/metrics.py
node scripts/generate-tables.cjs
cargo build --target wasm32-unknown-unknown --release
cargo test
node scripts/verify.cjs
node scripts/package.cjs
```

The generated `dist/index.html` and `dist/quiet-cvss-offline.html` embed WASM and work without a server. To preview:

```sh
python3 -m http.server 4173 --directory dist
```

Serve `dist/` with a static host. `_headers` provides CSP and other browser headers on compatible hosts. The HTML also supplies CSP via a meta element. Sites registration is recorded in `.openai/hosting.json` and does not alter the local-only assessment architecture.

## Validation

`scripts/verify.cjs` executes the actual compiled WASM and compares all 104,976 possible Base vectors plus 12,000 deterministic combinations of optional metrics against the vendored FIRST JavaScript reference. It also verifies report roundtrips, all metric-group renders, and invalid-vector rejection while preserving the previous valid assessment. `cargo test` exercises parser boundaries, canonicalization, and no-impact/maximum scores. Browser checks cover vector application, invalid input, live metric selection, and the local WebMCP tool. This is extensive functional verification, not certification or an independent security audit.

## Export format

JSON uses `format: "quiet-cvss"`, `schemaVersion: 1`, `cvssVersion: "4.0"`, `vector`, `score`, `severity`, and `nomenclature`. Import also accepts an object containing a `vector` string; supplied score fields are never trusted. Text reports contain a single vector line followed by the calculated result and metric explanations. Imported scores are always recalculated. Explicit optional `X` values are omitted from the canonical vector because they have the same semantics as omission.

## Reference and attribution

- https://www.first.org/cvss/v4.0/specification-document
- https://www.first.org/cvss/v4.0/user-guide
- https://github.com/FIRSTdotorg/cvss-v4-calculator

FIRST reference code and tables are distributed under BSD-2-Clause; see FIRST-LICENSE. Vendored files in `reference/` are verification inputs only and do not execute in the product. No affiliation or endorsement by FIRST is implied. Plain-language guidance supplements rather than replaces the authoritative specification.
