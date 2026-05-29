// Verify a single form renders, optionally click a button and check a modal opens.
// Usage: node verify-form.mjs <formSlug> [--click "Add"] [--expect-modal]
import { chromium } from 'playwright';

const FRONTEND = 'http://localhost:3000';
const slug = process.argv[2];
const clickIdx = process.argv.indexOf('--click');
const clickLabel = clickIdx >= 0 ? process.argv[clickIdx + 1] : null;
const expectModal = process.argv.includes('--expect-modal');

if (!slug) { console.log(JSON.stringify({ error: 'no slug' })); process.exit(1); }

const out = (o) => process.stdout.write(JSON.stringify(o));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [], net = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)); });
page.on('response', r => { if (r.status() >= 400 && !r.url().includes('favicon')) net.push(`${r.status()} ${r.url().slice(-55)}`); });

try {
  // Login (proven pattern: no waitUntil:load on the URL wait)
  await page.goto(`${FRONTEND}/login`, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForSelector('input:not([type=hidden])', { timeout: 15_000 });
  await page.waitForTimeout(500);
  const inp = page.locator('input:not([type=hidden])');
  await inp.nth(0).fill('admin');
  await inp.nth(1).fill('123qwe');
  const submit = page.locator('button[type="submit"], .ant-btn-primary, button:has-text("Login"), button:has-text("Sign in")').first();
  try { await submit.click({ timeout: 8_000 }); } catch { await inp.nth(1).press('Enter'); }
  // Poll the URL manually — SPA redirect uses history API, not a 'load' navigation
  for (let i = 0; i < 50 && page.url().includes('/login'); i++) {
    await page.waitForTimeout(500);
  }
  if (page.url().includes('/login')) throw new Error('login did not redirect (URL still /login)');

  await page.goto(`${FRONTEND}/dynamic/a.test/${slug}`, { waitUntil: 'load', timeout: 25_000 });
  await page.waitForTimeout(5_000);
  const ssDir = 'C:/Users/Lethabo/Desktop/projects/shesha-new-skills/shesha-form-edit/test-log/screenshots';
  await page.screenshot({ path: `${ssDir}/${slug}.png`, fullPage: true });

  const tables = await page.locator('.ant-table, table').count();
  const bodyLen = ((await page.evaluate(() => document.body.innerText)) || '').trim().length;

  let clicked = false, modalOpened = false, modalInputs = 0;
  if (clickLabel) {
    const btn = page.locator(`button:has-text("${clickLabel}"), [class*=ant-btn]:has-text("${clickLabel}")`).first();
    if (await btn.count()) {
      try {
        await btn.click({ timeout: 6_000 });
        clicked = true;
        await page.waitForTimeout(2_500);
        modalOpened = (await page.locator('.ant-modal-content').count()) > 0;
        modalInputs = await page.locator('.ant-modal input:not([type=hidden])').count();
        await page.screenshot({ path: `${ssDir}/${slug}-after-click.png`, fullPage: true });
      } catch (e) { errs.push('click: ' + e.message.slice(0, 80)); }
    }
  }

  const jsonErr = errs.some(e => /JSON|Unexpected token|position \d+/.test(e));
  const fiveHundred = net.some(n => n.startsWith('5'));
  const fourHundred = net.some(n => n.startsWith('4'));
  out({
    slug, tables, bodyLen, errs: errs.slice(0, 4), net: net.slice(0, 6),
    clicked, modalOpened, modalInputs,
    pass: !jsonErr && !fiveHundred && (!expectModal || modalOpened) && bodyLen > 100
  });
} catch (e) {
  out({ slug, error: e.message.slice(0, 200), errs: errs.slice(0, 3), net: net.slice(0, 4), pass: false });
} finally {
  await browser.close();
}
