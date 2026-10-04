const { readFileSync } = require('node:fs');

// Deployment logs contain the public workers.dev URL, never assessment data.
const log = readFileSync(process.argv[2], 'utf8');
const origin = log.match(/https:\/\/quietscore\.[a-z0-9-]+\.workers\.dev\b/)?.[0];
if (!origin) throw new Error('Deployment did not report the QuietScore workers.dev URL.');

async function verify() {
  const health = await fetch(`${origin}/healthz`);
  if (!health.ok || (await health.text()) !== 'ok') throw new Error('Health check failed.');
  const page = await fetch(origin);
  const html = await page.text();
  if (!page.ok || !html.includes('QuietScore') || !html.includes("connect-src 'none'"))
    throw new Error('Calculator page or privacy CSP check failed.');
  const offline = await fetch(`${origin}/quietscore-offline.html`);
  if (!offline.ok || !(await offline.text()).includes('QuietScore'))
    throw new Error('Offline edition is unavailable.');
  const mcp = await fetch(`${origin}/mcp`, { method: 'POST' });
  if (![401, 503].includes(mcp.status))
    throw new Error('Hosted MCP must require authentication or remain disabled.');
  const discovery = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`);
  if (!discovery.ok || (await discovery.json()).resource !== `${origin}/mcp`)
    throw new Error('MCP OAuth discovery failed.');
  const connections = await fetch(`${origin}/connect`);
  if (!connections.ok || !(await connections.text()).includes('Sign in with GitHub'))
    throw new Error('MCP sign-in page is unavailable.');
  console.log(`Deployment verified: ${origin}`);
  if (process.env.GITHUB_STEP_SUMMARY)
    require('node:fs').appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `QuietScore deployed and checked: [Open calculator](${origin})\n`,
    );
}
verify().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
