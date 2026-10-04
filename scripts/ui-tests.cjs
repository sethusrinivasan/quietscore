const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
fs.mkdirSync('reports', { recursive: true });
// Prevent an interrupted run from publishing a previous run's browser statistics.
fs.rmSync('reports/playwright.json', { force: true });
const result = spawnSync('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
require('./report-tests.cjs').publish();
process.exitCode = result.error || result.status !== 0 ? 1 : 0;
