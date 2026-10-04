const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const { transformSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const wasm = fs
  .readFileSync(path.join(root, 'target/wasm32-unknown-unknown/release/quietscore.wasm'))
  .toString('base64');
const css = transformSync(fs.readFileSync(path.join(root, 'style.css'), 'utf8'), {
  loader: 'css',
  minify: true,
}).code;
const sourceJs =
  `const WASM_BASE64=${JSON.stringify(wasm)};\n` +
  `const SAMPLES=${JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'samples.json'), 'utf8'))).replace(/</g, '\\u003c')};\n` +
  fs.readFileSync(path.join(root, 'bridge.js'), 'utf8');
// Hash the exact optimized script embedded in the offline and hosted documents.
const js = transformSync(sourceJs, { loader: 'js', minify: true, target: 'es2022' }).code;
const hash = crypto.createHash('sha256').update(js).digest('base64');
const csp = `default-src 'none'; script-src 'sha256-${hash}' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const license = fs.readFileSync(path.join(root, 'FIRST-LICENSE'), 'utf8');
const html = `<!doctype html><!-- ${license} --><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>QuietScore — Private CVSS 4.0 Calculator</title><meta name="description" content="Understand CVSS 4.0 with plain-language guidance. Rust and WebAssembly calculate locally. Import vectors and export text or JSON."><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23305ef0'/%3E%3Ctext x='8' y='23' fill='white' font-family='Georgia' font-size='28'%3Eq%3C/text%3E%3C/svg%3E"><style>${css}</style></head><body><div id="app"><section class="loading"><h1>Starting your private calculator…</h1><p>The Rust/WebAssembly engine loads on your device.</p></section></div><div id="toast" role="status" aria-live="polite"></div><noscript>This calculator needs JavaScript enabled to connect the browser to its local Rust/WebAssembly engine.</noscript><script type="module">${js}</script></body></html>`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.mkdirSync(path.join(root, 'generated'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'target/wasm32-unknown-unknown/release/quietscore.wasm'),
  path.join(root, 'generated/quietscore.wasm'),
);
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
fs.writeFileSync(path.join(root, 'dist/quietscore-offline.html'), html);
fs.copyFileSync(path.join(root, 'FIRST-LICENSE'), path.join(root, 'dist/FIRST-LICENSE'));
fs.writeFileSync(
  path.join(root, 'dist/_headers'),
  `/*\n  Content-Security-Policy: ${csp}; frame-ancestors 'none'\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`,
);
console.log(
  `Packaged self-contained HTML: ${Math.round(Buffer.byteLength(html) / 1024)} KB. No runtime dependencies or network APIs.`,
);
