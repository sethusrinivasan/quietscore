import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const server = spawn(process.execPath, ['scripts/serve-test.cjs'], { stdio: 'ignore' });
const browser = await chromium.launch();
try {
  await mkdir('docs/screenshots', { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
  });
  for (let i = 0; i < 30; i++) {
    try {
      await page.goto('http://127.0.0.1:4174');
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await page.locator('[data-scenario="new"]').waitFor();
  await page.screenshot({ path: 'docs/screenshots/start.png' });
  await page.locator('[data-scenario="new"]').click();
  await page.locator('#scenario-title').fill('Customer portal assessment');
  await page
    .locator('[data-metric-note="AV"]')
    .fill('The affected portal is reachable over the public internet.');
  await page.locator('.workspace').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/guided.png' });
  await page.reload();
  await page.locator('[data-scenario="samples"]').click();
  await page.locator('[data-sample="CVE-2021-44228"]:not([data-clone])').click();
  await page.getByRole('heading', { name: 'Published sample · read-only' }).waitFor();
  await expect(page.locator('#toast')).toHaveText('', { timeout: 7000 });
  await page.locator('.workspace').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/sample.png' });
  await page.locator('.appearance-control select').selectOption('dark');
  await page.locator('.score-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/dark-exports.png' });
  const authPage = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await authPage.goto('https://quietscore.cancun.workers.dev/connect');
  await authPage.getByRole('heading', { name: 'Connect QuietScore to your AI tools' }).waitFor();
  await authPage.screenshot({ path: 'docs/screenshots/mcp-connect.png' });
  console.log('Saved five screenshots using synthetic assessment text and public Log4Shell data.');
} finally {
  await browser.close();
  server.kill();
}
