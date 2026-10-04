import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Disable developer-CLI usage telemetry as well as the Worker's application logs.
const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
if (result.error) {
  console.error('Wrangler could not start. Install dependencies first.');
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;
