const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
require('esbuild').buildSync({
  entryPoints: ['tests/fixtures/auth.ts'],
  outfile: '.test-build/auth-fixture.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { 'cloudflare:workers': require('node:path').resolve('scripts/cloudflare-test-base.mjs') },
});
require('node:child_process').execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout',
    '.test-build/localhost.key',
    '-out',
    '.test-build/localhost.crt',
  ],
  { stdio: 'ignore' },
);
fs.mkdirSync('reports', { recursive: true });
// Prevent an interrupted run from publishing a previous run's browser statistics.
fs.rmSync('reports/playwright.json', { force: true });
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
require('./report-tests.cjs').publish();
process.exitCode = result.error || result.status !== 0 ? 1 : 0;
