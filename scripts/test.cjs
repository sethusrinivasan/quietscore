const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const reports = path.join(root, 'reports');
fs.mkdirSync(reports, { recursive: true });
fs.rmSync(path.join(reports, 'playwright.json'), { force: true });
const xmlEscape = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
let failed = false;
function execute(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) failed = true;
  return result;
}
const rust = execute('cargo', ['test']);
process.stdout.write(rust.stdout || '');
process.stderr.write(rust.stderr || rust.error?.message || '');
const rustCases = [...(rust.stdout || '').matchAll(/^test ([\w:]+) \.\.\. (ok|FAILED|ignored)$/gm)];
const rustCounts = {
  passed: rustCases.filter((m) => m[2] === 'ok').length,
  failed: rustCases.filter((m) => m[2] === 'FAILED').length,
  skipped: rustCases.filter((m) => m[2] === 'ignored').length,
};
fs.writeFileSync(
  path.join(reports, 'rust-junit.xml'),
  `<testsuite name="Rust" tests="${rustCases.length}" failures="${rustCounts.failed}" skipped="${rustCounts.skipped}">${rustCases.map((m) => `<testcase name="${xmlEscape(m[1])}">${m[2] === 'FAILED' ? '<failure message="See Rust test log"/>' : m[2] === 'ignored' ? '<skipped/>' : ''}</testcase>`).join('')}</testsuite>`,
);
const verification = [];
for (const name of ['verify-sources', 'verify', 'verify-files']) {
  const result = execute(process.execPath, [`scripts/${name}.cjs`]);
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || result.error?.message || '');
  verification.push({ name, passed: result.status === 0 });
}
const files = fs
  .readdirSync(path.join(root, 'tests'))
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => `tests/${name}`);
const node = execute('pnpm', [
  'exec',
  'tsx',
  '--import',
  './scripts/cloudflare-test-register.mjs',
  '--test',
  '--test-reporter=junit',
  ...files,
]);
const suite = (node.stdout || '').match(/<testsuites\b[^>]*>/)?.[0] || '';
const commentCount = (key) =>
  Number((node.stdout || '').match(new RegExp(`<!-- ${key} (\\d+) -->`))?.[1] || 0);
const nodeCounts = {
  passed: commentCount('pass'),
  failed: commentCount('fail') + commentCount('cancelled'),
  skipped: commentCount('skipped') + commentCount('todo'),
};
const nodeTotal = nodeCounts.passed + nodeCounts.failed + nodeCounts.skipped;
const normalized = (node.stdout || '')
  .replace(
    '<testsuites>',
    `<testsuites tests="${nodeTotal}" failures="${nodeCounts.failed}" skipped="${nodeCounts.skipped}"><testsuite name="Node WASM MCP" tests="${nodeTotal}" failures="${nodeCounts.failed}" skipped="${nodeCounts.skipped}">`,
  )
  .replace('</testsuites>', '</testsuite></testsuites>');
fs.writeFileSync(path.join(reports, 'node-junit.xml'), normalized);
process.stderr.write(node.stderr || node.error?.message || '');
if (node.status !== 0) process.stdout.write(node.stdout || '');
if (!rustCases.length || !suite) failed = true;
fs.writeFileSync(
  path.join(reports, 'unit.json'),
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      rust: rustCounts,
      node: nodeCounts,
      verification,
      complete: !failed,
    },
    null,
    2,
  ),
);
console.log(
  `Rust: ${rustCounts.passed} passed, ${rustCounts.failed} failed; Node: ${nodeCounts.passed} passed, ${nodeCounts.failed} failed.`,
);
require('./report-tests.cjs').publish();
process.exitCode = failed ? 1 : 0;
