#!/usr/bin/env node
/**
 * Fully autonomous test-and-iterate cycle.
 *
 * Flow:
 *   1. Playwright inspection → findings JSON
 *   2. Merge findings into .current-run-meta.json
 *   3. tracker.mjs --auto  (record test, commit, push)
 *   4. iterate.mjs --new   (write analysis prompt)
 *   5. claude CLI          (execute skill iteration)
 *   6. iterate.mjs --auto  (record iteration)
 *
 * Usage:
 *   node test-log/auto-cycle.mjs
 *   node test-log/auto-cycle.mjs --skip-iterate   (stop after recording test)
 *   node test-log/auto-cycle.mjs --skip-claude    (stop after writing iterate prompt)
 */
import { execFileSync, spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR      = join(__dirname, '..');
const PENDING_PATH   = join(__dirname, 'pending.json');
const META_PATH      = join(SKILL_DIR, '.current-run-meta.json');
const PROMPT_PATH    = join(SKILL_DIR, '.current-prompt.md');

const argv = process.argv.slice(2);
const SKIP_ITERATE = argv.includes('--skip-iterate');
const SKIP_CLAUDE  = argv.includes('--skip-claude');

const SEP = '─'.repeat(50);

function loadJSON(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function saveJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function step(n, total, label) {
  console.log(`\n  [${n}/${total}] ${label}`);
}

function ok(msg)   { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.log(`  ! ${msg}`); }

async function runPlaywright() {
  const { stdout } = execFileSync(
    process.execPath,
    [join(__dirname, 'playwright-inspect.mjs')],
    { encoding: 'utf8', timeout: 180_000 }
  );
  return JSON.parse(stdout.trim());
}

function recordTest(meta) {
  execFileSync(
    process.execPath,
    [join(__dirname, 'tracker.mjs'), '--auto'],
    { stdio: 'inherit', timeout: 90_000 }
  );
}

function writeIteratePrompt() {
  execFileSync(
    process.execPath,
    [join(__dirname, 'iterate.mjs'), '--new'],
    { stdio: 'inherit', timeout: 30_000 }
  );
}

function recordIteration() {
  execFileSync(
    process.execPath,
    [join(__dirname, 'iterate.mjs'), '--auto'],
    { stdio: 'inherit', timeout: 90_000 }
  );
}

function tryInvokeClaudeForIterate() {
  if (!existsSync(PROMPT_PATH)) {
    warn('No iterate prompt found — skipping Claude invocation.');
    return false;
  }

  const prompt = readFileSync(PROMPT_PATH, 'utf8');

  console.log('\n  Invoking Claude CLI to execute skill iteration...');
  console.log('  (This may take several minutes — Claude will read runs, analyse, and update SKILL.md)\n');

  // Try "claude -p <prompt>" — non-interactive print mode with tool access
  const result = spawnSync(
    'claude',
    ['-p', prompt],
    {
      stdio: 'inherit',
      timeout: 600_000, // 10 min
      shell: true,
      windowsHide: false,
    }
  );

  if (result.error) {
    warn(`claude CLI error: ${result.error.message}`);
    return false;
  }

  if (result.status !== 0) {
    warn(`claude exited with status ${result.status}`);
    return false;
  }

  return true;
}

async function main() {
  console.log(`\n${SEP}`);
  console.log('  shesha-form-edit — autonomous test cycle');
  console.log(SEP);

  // ── Guard: must have a pending run ──
  const pending = loadJSON(PENDING_PATH);
  if (!pending?.prompt) {
    warn('No pending run found in test-log/pending.json.');
    console.log('\n  Run "npm run test" first (or "node test-log/tracker.mjs") to start a test run.\n');
    process.exit(1);
  }

  console.log(`\n  Pending: ${pending.prompt.slice(0, 100)}${pending.prompt.length > 100 ? '...' : ''}`);
  console.log(`  Version: ${pending.version}  Branch: ${pending.branch}`);

  const TOTAL = SKIP_ITERATE ? 2 : SKIP_CLAUDE ? 4 : 6;

  // ── Step 1: Playwright inspection ──
  step(1, TOTAL, 'Playwright form inspection');
  let inspection = null;
  try {
    inspection = await runPlaywright();
    ok(`${inspection.total} forms — ${inspection.ok} ok, ${inspection.errored} error(s), ${inspection.empty ?? 0} empty`);
    ok(`Auto-rating: ${inspection.rating}/5  Passed: ${inspection.passed}`);
    if (inspection.findings) {
      console.log('\n  Findings preview:');
      inspection.findings.split('\n').slice(0, 5).forEach(l => console.log(`    ${l}`));
    }
  } catch (e) {
    warn(`Playwright failed: ${e.message.slice(0, 150)}`);
    warn('Falling back: rating=1, passed=false');
    inspection = { rating: 1, passed: false, findings: `Playwright inspection failed: ${e.message.slice(0, 300)}` };
  }

  // ── Step 2: Merge findings into meta ──
  step(2, TOTAL, 'Merging Playwright findings into run meta');
  const existingMeta = loadJSON(META_PATH) || {};
  const meta = {
    ...existingMeta,
    rating:   inspection.rating,
    passed:   inspection.passed,
    findings: inspection.findings ?? '',
  };
  saveJSON(META_PATH, meta);
  ok('Run meta updated with Playwright findings');

  // ── Step 3: Record test ──
  step(3, TOTAL, 'Recording test results (tracker --auto)');
  try {
    recordTest(meta);
    ok('Test recorded, committed, pushed');
  } catch (e) {
    warn(`tracker.mjs --auto failed: ${e.message.slice(0, 150)}`);
    warn('Continuing anyway...');
  }

  if (SKIP_ITERATE) {
    console.log(`\n${SEP}`);
    console.log('  ✓ Cycle complete (--skip-iterate)');
    console.log(SEP + '\n');
    return;
  }

  // ── Step 4: Write iterate prompt ──
  step(4, TOTAL, 'Writing skill-iteration analysis prompt');
  try {
    writeIteratePrompt();
    ok('Iterate prompt written to .current-prompt.md');
  } catch (e) {
    warn(`iterate.mjs --new failed: ${e.message.slice(0, 150)}`);
    if (SKIP_CLAUDE) process.exit(1);
  }

  if (SKIP_CLAUDE) {
    console.log('\n  Prompt ready. Give this to Claude:');
    console.log(`  ${PROMPT_PATH}`);
    console.log('\n  Then run: node test-log/iterate.mjs  to record it.');
    console.log(`\n${SEP}\n`);
    return;
  }

  // ── Step 5: Invoke Claude CLI ──
  step(5, TOTAL, 'Invoking Claude CLI for skill iteration');
  const claudeOk = tryInvokeClaudeForIterate();

  if (!claudeOk) {
    console.log('\n  Claude could not be invoked automatically.');
    console.log('  Give Claude this prompt:');
    console.log(`  ${PROMPT_PATH}`);
    console.log('\n  Then run: node test-log/iterate.mjs  to record it.');
    console.log(`\n${SEP}\n`);
    return;
  }

  // ── Step 6: Record iteration ──
  step(6, TOTAL, 'Recording iteration (iterate --auto)');
  try {
    recordIteration();
    ok('Iteration recorded');
  } catch (e) {
    warn(`iterate.mjs --auto failed: ${e.message.slice(0, 150)}`);
    console.log('  Run: node test-log/iterate.mjs  to record manually.');
  }

  console.log(`\n${SEP}`);
  console.log('  ✓ Full cycle complete');
  console.log(SEP + '\n');
}

main().catch(e => {
  console.error('\n  Cycle failed:', e.message);
  process.exit(1);
});
