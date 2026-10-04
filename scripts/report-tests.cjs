const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => {
  const file = path.join(root, 'reports', name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
function publish(options = {}) {
  const unit = read('unit.json');
  const ui = read('playwright.json');
  const rows = [];
  if (unit) {
    rows.push(['Rust unit', unit.rust], ['Node/WASM/MCP', unit.node]);
    rows.push([
      'Source/parity/file checks',
      {
        passed: unit.verification.filter((c) => c.passed).length,
        failed: unit.verification.filter((c) => !c.passed).length,
        skipped: 0,
      },
    ]);
  }
  if (ui)
    rows.push([
      'Playwright browser cases',
      { passed: ui.stats.expected, failed: ui.stats.unexpected, skipped: ui.stats.skipped },
    ]);
  const line = (name, counts) => {
    const executed = counts.passed + counts.failed;
    const rate = executed ? `${((100 * counts.passed) / executed).toFixed(1)}%` : 'Not run';
    return `| ${name} | ${counts.passed} | ${counts.failed} | ${counts.skipped} | ${rate} |`;
  };
  const summary = `## QuietScore test results\n\n| Suite | Passed | Failed | Skipped | Pass rate |\n| --- | ---: | ---: | ---: | ---: |\n${rows.map(([name, counts]) => line(name, counts)).join('\n')}\n\nPass rate = passed / (passed + failed); skipped cases are listed separately. FIRST parity checks compare 116,976 vectors when their check succeeds. Missing suites were not run; no rate is claimed for them.\n`;
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'summary.md'), summary);
  console.log(summary);
  if (options.github && process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  return summary;
}
module.exports = { publish };
if (require.main === module) publish({ github: true });
