#!/usr/bin/env node
/**
 * Playwright inspection of Shesha forms.
 * Outputs JSON to stdout: { rating, passed, findings, total, ok, errored, formsChecked }
 *
 * Usage:
 *   node test-log/playwright-inspect.mjs
 *   node test-log/playwright-inspect.mjs --frontend http://localhost:3000 --backend http://localhost:21021
 */
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const p = join(__dirname, '.env');
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const argv = process.argv.slice(2);

function getArg(flag, def) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

const FRONTEND = getArg('--frontend', 'http://localhost:3000');
const BACKEND  = getArg('--backend',  'http://localhost:21021');
const MODULE   = getArg('--module',   env.SHESHA_MODULE || 'A.Test');
const USER     = getArg('--username', 'admin');
const PASS     = getArg('--password', '123qwe');
const SS_DIR   = join(__dirname, 'screenshots');

function out(data) {
  process.stdout.write(JSON.stringify(data));
}

async function getAuthToken() {
  const res = await fetch(`${BACKEND}/api/TokenAuth/Authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userNameOrEmailAddress: USER, password: PASS })
  });
  if (!res.ok) throw new Error(`Auth failed: HTTP ${res.status}`);
  const data = await res.json();
  const token = data.result?.accessToken;
  if (!token) throw new Error(`Auth failed: no token in response`);
  return token;
}

async function listForms(token) {
  // Shesha namespace (app namespace returns 404 for this endpoint)
  const res = await fetch(
    `${BACKEND}/api/services/Shesha/FormConfiguration/GetAll?maxResultCount=100&skipCount=0`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`FormConfiguration/GetAll HTTP ${res.status}`);
  const data = await res.json();
  const items = data.result?.items ?? data.result ?? [];
  // Filter by module name (case-insensitive)
  return items.filter(f => {
    const mod = (typeof f.module === 'string' ? f.module : f.module?.name || f.moduleName || '').toLowerCase();
    return mod === MODULE.toLowerCase() || mod.includes(MODULE.toLowerCase());
  });
}

async function main() {
  // ── Step 1: list forms via API ──
  let forms = [];
  try {
    const token = await getAuthToken();
    forms = await listForms(token);
  } catch (e) {
    out({ rating: 1, passed: false, findings: `API unreachable (${BACKEND}): ${e.message}`, total: 0, ok: 0, errored: 0 });
    process.exit(0);
  }

  if (!forms.length) {
    out({ rating: 1, passed: false, findings: `No forms found for module "${MODULE}" — the AI may have failed to create any forms.`, total: 0, ok: 0, errored: 0 });
    process.exit(0);
  }

  // ── Step 2: Playwright inspection ──
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    out({ rating: 1, passed: false, findings: `playwright package not installed. Run: npm install in the skill directory.`, total: forms.length, ok: 0, errored: forms.length });
    process.exit(0);
  }

  mkdirSync(SS_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await context.newPage();

  const pageErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') pageErrors.push(msg.text().slice(0, 200)); });
  page.on('pageerror', err => pageErrors.push(err.message.slice(0, 200)));

  // Login — UI login with Shesha's ant-design form
  try {
    await page.goto(`${FRONTEND}/login`, { waitUntil: 'load', timeout: 30_000 });
    // Wait for inputs to appear (React hydration can take a moment)
    await page.waitForSelector('input:not([type="hidden"])', { timeout: 15_000 });
    await page.waitForTimeout(500);

    // Fill credentials — use broad selectors for ant-design inputs
    const inputs = page.locator('input:not([type="hidden"])');
    const count = await inputs.count();
    if (count >= 2) {
      await inputs.nth(0).fill(USER);
      await inputs.nth(1).fill(PASS);
    } else {
      throw new Error(`Only found ${count} inputs on login page`);
    }

    // Submit — try button click then Enter fallback
    const submitBtn = page.locator('button[type="submit"], .ant-btn-primary, button:has-text("Login"), button:has-text("Sign in")').first();
    try {
      await submitBtn.click({ timeout: 8_000 });
    } catch {
      await inputs.nth(1).press('Enter');
    }

    // Poll the URL manually — SPA redirect uses history API, not a 'load' navigation
    for (let i = 0; i < 50 && page.url().includes('/login'); i++) {
      await page.waitForTimeout(500);
    }
    if (page.url().includes('/login')) throw new Error('login did not redirect');
    console.error('Login succeeded');
  } catch (e) {
    await browser.close();
    out({ rating: 1, passed: false, findings: `Login failed: ${e.message.slice(0, 200)}`, total: forms.length, ok: 0, errored: forms.length });
    process.exit(0);
  }

  const formResults = [];
  const LIMIT = Math.min(forms.length, 20);

  for (let i = 0; i < LIMIT; i++) {
    const form = forms[i];
    const formId   = form.id;
    const formName = form.name || form.label || formId;

    pageErrors.length = 0;

    try {
      // Live form URL: /dynamic/<module>/<form-name>
      const moduleSlug = MODULE.toLowerCase().replace(/\s+/g, '-');
      const formSlug   = (form.name || '').toLowerCase().replace(/\s+/g, '-');
      await page.goto(`${FRONTEND}/dynamic/${moduleSlug}/${formSlug}`, {
        waitUntil: 'load',
        timeout: 20_000
      });
      await page.waitForTimeout(4_000); // let React render complete

      const slug = formName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
      const ssPath = join(SS_DIR, `${slug}.png`);
      await page.screenshot({ path: ssPath, fullPage: false });

      const bodyText = (await page.evaluate(() => document.body.innerText)) || '';

      const jsonError = /JSON\s+at\s+position|cannot\s+be\s+parsed|Unexpected\s+token|SyntaxError/i.test(bodyText);
      const renderCrash = /Something\s+went\s+wrong|Error\s+rendering|TypeError|ReferenceError/i.test(bodyText);
      const consoleErr = pageErrors.some(e => /error|failed|exception/i.test(e));
      const hasError = jsonError || renderCrash || consoleErr;
      const isEmpty  = bodyText.trim().length < 150;

      let status = 'ok';
      if (hasError)  status = 'error';
      else if (isEmpty) status = 'empty';

      formResults.push({
        id: formId, name: formName, status,
        consoleErrors: pageErrors.slice(0, 3),
        jsonError, renderCrash,
        screenshot: ssPath
      });
    } catch (e) {
      formResults.push({ id: formId, name: formName, status: 'crash', error: e.message.slice(0, 150) });
    }
  }

  await browser.close();

  // ── Step 3: Build findings ──
  const total   = formResults.length;
  const ok      = formResults.filter(f => f.status === 'ok').length;
  const errored = formResults.filter(f => f.status === 'error' || f.status === 'crash').length;
  const empty   = formResults.filter(f => f.status === 'empty').length;

  let rating = 5;
  if (errored / total > 0.5)       rating = 1;
  else if (errored / total > 0.25) rating = 2;
  else if (errored > 0 || empty > 2) rating = 3;
  else if (empty > 0 || errored > 0) rating = 4;

  const passed = errored === 0 && ok >= Math.ceil(total * 0.75);

  const problemLines = formResults
    .filter(f => f.status !== 'ok')
    .map(f => {
      const detail = [
        f.jsonError   ? 'JSON parse error'                   : null,
        f.renderCrash ? 'render crash'                       : null,
        f.error       ? f.error.slice(0, 80)                 : null,
        f.consoleErrors?.length ? f.consoleErrors[0].slice(0, 100) : null,
      ].filter(Boolean).join('; ');
      return `${f.name} [${f.status}]${detail ? ': ' + detail : ''}`;
    });

  const findings = [
    `Checked ${total} forms for module "${MODULE}": ${ok} ok, ${errored} error(s), ${empty} empty`,
    ...problemLines
  ].join('\n');

  out({ rating, passed, findings, total, ok, errored, empty, formsChecked: formResults });
}

main().catch(e => {
  out({ rating: 1, passed: false, findings: `Playwright inspection crashed: ${e.message}` });
  process.exit(0);
});
