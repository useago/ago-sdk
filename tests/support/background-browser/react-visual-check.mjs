import { writeFile } from 'node:fs/promises';
import { launchBrowser, launchHarness, outputDir } from './launch.mjs';

const results = [];
let harness, browser, page;
try {
  browser = await launchBrowser();
  harness = await launchHarness('react');
  page = await browser.newPage();
  const target = harness.url;
await page.goto(target);
await page.getByRole('button', { name: 'Approve', exact: true }).waitFor({ timeout: 10000 });
for (const [width, height] of [[320, 800], [390, 844], [768, 1024], [1024, 768], [1440, 900], [844, 390]]) {
  await page.setViewportSize({ width, height });
  await page.getByRole('button', { name: 'Approve', exact: true }).scrollIntoViewIfNeeded();
  const bounds = await page.getByRole('button', { name: 'Approve', exact: true }).boundingBox();
  if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width || bounds.y + bounds.height > height) throw new Error(`Approval control is clipped at ${width}x${height}`);
  await page.screenshot({ path: `${outputDir}/react-waiting-${width}x${height}.png` });
  const metrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, approval: !![...document.querySelectorAll('button')].find((b) => b.textContent === 'Approve') }));
  if (metrics.scrollWidth > metrics.clientWidth || !metrics.approval) throw new Error(`Viewport ${width}x${height}: ${JSON.stringify(metrics)}`);
  results.push({ width, height, ...metrics });
}
await page.getByRole('button', { name: 'Approve', exact: true }).click();
await page.getByText('The report is complete.', { exact: false }).waitFor({ timeout: 10000 });
const download = page.getByRole('link', { name: /background-report.csv/ });
await download.waitFor();
const href = await download.getAttribute('href');
const response = await page.request.get(new URL(href, target).href);
if (!response.ok() || !(await response.text()).includes(',')) throw new Error('CSV download failed');
results.push({ finalReport: true, csvStatus: response.status() });
await page.setViewportSize({ width: 390, height: 844 });
const field = page.getByRole('textbox');
await field.fill('Draft retained after resize');
await page.setViewportSize({ width: 1440, height: 900 });
if (await field.inputValue() !== 'Draft retained after resize') throw new Error('Draft lost on resize');
await field.focus();
if (!(await field.evaluate((element) => document.activeElement === element))) throw new Error('Composer cannot receive focus');
await page.screenshot({ path: `${outputDir}/react-final-1440x900.png` });
results.push({ draftRetained: true, composerFocused: true });


} finally {
  try { if (page) await page.close(); } finally {
    try { if (browser) await browser.close(); } finally {
      try { if (harness) await harness.close(); } finally {
        await writeFile(`${outputDir}/react-results.json`, JSON.stringify(results, null, 2)).catch(() => {});
      }
    }
  }
}
