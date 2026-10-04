import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

const vector = 'CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:P/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N';
async function start(page: Page) {
  await page.goto('/');
  await page.locator('[data-scenario="new"]').click();
}
async function apply(page: Page, value = vector) {
  await page.locator('.vector-import > summary').click();
  await page.locator('#vector-input').fill(value);
  await page.getByRole('button', { name: /Apply vector/ }).click();
}
async function sample(page: Page) {
  await page.goto('/');
  await page.locator('[data-scenario="samples"]').click();
  await page.locator('[data-sample="CVE-2021-44228"]:not([data-clone])').click();
}

test('valid vector scores correctly; invalid vector preserves the assessment', async ({ page }) => {
  await start(page);
  await apply(page);
  await expect(page.locator('.score')).toContainText('7.6');
  await page.locator('#vector-input').fill(vector + '/AV:N');
  await page.getByRole('button', { name: /Apply vector/ }).click();
  await expect(page.locator('#vector-status')).toContainText('Duplicate metric');
  await expect(page.locator('.score')).toContainText('7.6');
});

test('samples hide empty notes and lock classifications; cloning restores editable notes', async ({
  page,
}) => {
  await sample(page);
  await expect(page.getByRole('heading', { name: 'Published sample · read-only' })).toBeVisible();
  await expect(page.locator('[data-metric-note]')).toHaveCount(0);
  await expect(page.locator('.sample-rationale')).toHaveCount(11);
  await expect(page.locator('input[name="AV"]').first()).toBeDisabled();
  await page.locator('.sample-lock [data-scenario="clone"]').click();
  await expect(page.locator('[data-metric-note]')).toHaveCount(11);
  await expect(page.locator('input[name="AV"]').first()).toBeEnabled();
  await page.locator('[data-metric-note="AV"]').fill('Cloned evidence');
  await expect(page.locator('[data-metric-note="AV"]')).toHaveValue('Cloned evidence');
});

test('wizard notes persist between steps and expanded notes synchronize', async ({ page }) => {
  await start(page);
  await page.locator('[data-metric-note="AV"]').fill('Public network entry point');
  await page.getByRole('button', { name: 'Confirm classification & continue →' }).click();
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('[data-metric-note="AV"]')).toHaveValue('Public network entry point');
  await page.getByRole('button', { name: 'Expand assessment notes' }).click();
  await page
    .getByLabel('Expanded assessment notes', { exact: true })
    .fill('Evidence and assumptions');
  await page.getByRole('button', { name: 'Close expanded notes' }).click();
  await expect(page.locator('#scenario-notes')).toHaveValue('Evidence and assumptions');
});

test('multiple drafts survive reload and restore independent notes', async ({ page }) => {
  await start(page);
  await page.locator('#scenario-title').fill('First assessment');
  await page.locator('[data-metric-note="AV"]').fill('First note');
  await page.locator('[data-scenario="save"]').click();
  await page.locator('[data-scenario="new"]').click();
  await page.locator('#scenario-title').fill('Second assessment');
  await page.locator('[data-scenario="save"]').click();
  await page.reload();
  await page.locator('[data-scenario="drafts"]').click();
  const first = await page
    .locator('#draft-select option')
    .filter({ hasText: 'First assessment' })
    .getAttribute('value');
  await expect(page.locator('#draft-select option')).toHaveCount(3);
  await page.locator('#draft-select').selectOption(first!);
  await page.locator('[data-scenario="load"]').click();
  await expect(page.locator('#scenario-title')).toHaveValue('First assessment');
  await expect(page.locator('[data-metric-note="AV"]')).toHaveValue('First note');
});

test('JSON and text downloads contain the assessment; JSON import restores notes', async ({
  page,
}) => {
  await start(page);
  await apply(page);
  await page.locator('#scenario-title').fill('Portable assessment');
  await page.locator('[data-metric-note="AV"]').fill('Assessor evidence');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const file = await download;
  const data = JSON.parse(await readFile((await file.path())!, 'utf8'));
  expect(data.score).toBe(7.6);
  expect(data.scenario.metricNotes.AV).toBe('Assessor evidence');
  await page.reload();
  await page.locator('.vector-import > summary').click();
  await page.locator('#file-input').setInputFiles({
    name: 'assessment.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('#scenario-title')).toHaveValue('Portable assessment');
  await expect(page.locator('[data-metric-note="AV"]')).toHaveValue('Assessor evidence');
  const textDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Plain text', exact: true }).click();
  const text = await readFile((await (await textDownload).path())!, 'utf8');
  expect(text).toContain(vector);
  expect(text).toContain('AV: Assessor evidence');
});

test('Excel download is a real archive; PDF report escapes notes and covers all metrics', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await start(page);
  await apply(page);
  await page.locator('#scenario-notes').fill('<script>customer note</script>');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  const bytes = await readFile((await (await download).path())!);
  expect(Buffer.from(bytes.subarray(0, 4)).toString('hex')).toBe('504b0304');
  expect(bytes.toString()).toContain('xl/worksheets/sheet1.xml');
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  await expect(page.locator('#print-report section')).toHaveCount(32);
  await expect(page.locator('#print-report')).toContainText('<script>customer note</script>');
  await expect(page.locator('#print-report script')).toHaveCount(0);
});

test('calculation works offline and does not transmit assessment data', async ({
  page,
  context,
}) => {
  await start(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await context.setOffline(true);
  await apply(page);
  await expect(page.locator('.score')).toContainText('7.6');
  await page.locator('#scenario-notes').fill('Private local evidence');
  await page.locator('[data-scenario="save"]').click();
  expect(requests).toEqual([]);
  expect(page.url()).not.toContain('CVSS');
});

test('all export controls have decorative icons; themes and keyboard tabs remain usable', async ({
  page,
}) => {
  await start(page);
  await page.getByRole('button', { name: 'Show all metrics', exact: true }).click();
  await expect(page.locator('.export-buttons button svg[aria-hidden="true"]')).toHaveCount(4);
  await page.getByRole('tab', { name: /Base/ }).focus();
  await page.getByRole('tab', { name: /Base/ }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Threat/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Appearance', { exact: true }).selectOption('contrast');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
  await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('malformed JSON import reports an error and retains the valid vector', async ({ page }) => {
  await start(page);
  await apply(page);
  await page
    .locator('#file-input')
    .setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{invalid json'),
    });
  await expect(page.locator('#toast')).toContainText('JSON');
  await expect(page.locator('.score')).toContainText('7.6');
  await expect(page.locator('.result-vector code')).toContainText(vector);
});

test('wizard confirms every metric and reaches the final review', async ({ page }) => {
  await start(page);
  for (let step = 0; step < 32; step++) {
    await expect(page.locator('#wizard-heading')).toContainText(`Step ${step + 1} of 32`);
    await page.locator('[data-scenario="next"]').click();
  }
  await expect(page.locator('#wizard-heading')).toHaveText('Review your assessment');
  await expect(page.locator('.wizard-card')).toContainText(
    'All 11 Base classifications have been reviewed',
  );
  await expect(page.locator('.score-top .eyebrow')).toHaveText('LIVE SEVERITY');
});
