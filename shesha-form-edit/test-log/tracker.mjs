#!/usr/bin/env node
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, copyFileSync, appendFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '..');
const CONFIG_PATH = join(__dirname, 'config.json');
const LOCAL_PATH = join(__dirname, 'runs.json');
const PENDING_PATH = join(__dirname, 'pending.json');
const ENV_PATH = join(__dirname, '.env');

const SKILL = 'shesha-form-edit';

const args = process.argv.slice(2);
const FLAG_NEW = args.includes('--new') || args.includes('-n');
const FLAG_TEST_LOCAL = args.includes('--test-local') || args.includes('-l');

/* ── helpers ── */

function prompt(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

function promptFindings() {
  console.log('Findings (multi-line; type END on its own line to finish):');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    const lines = [];
    rl.on('line', line => { if (line.trim() === 'END') { rl.close(); return; } lines.push(line); });
    rl.on('close', () => res(lines.join('\n').trim()));
  });
}

function promptMultiline(label) {
  console.log(`${label} (type END on its own line to finish):`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    const lines = [];
    rl.on('line', line => { if (line.trim() === 'END') { rl.close(); return; } lines.push(line); });
    rl.on('close', () => res(lines.join('\n').trim()));
  });
}

function git(...args) {
  return execFileSync('git', args, { cwd: SKILL_DIR, encoding: 'utf8' }).trim();
}

function getGitRemote() {
  try {
    const url = git('remote', 'get-url', 'origin');
    return url.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/');
  } catch { return null; }
}

function getCurrentBranch() {
  try { return git('rev-parse', '--abbrev-ref', 'HEAD'); }
  catch { return 'unknown'; }
}

function loadJSON(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

function parseVersion(v) {
  if (!v) return null;
  const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}
function formatVersion(v) { return `v${v.major}.${v.minor}.${v.patch}`; }
function nextVersion(v) {
  const p = parseVersion(v);
  if (!p) return 'v0.0.1';
  p.patch++;
  return formatVersion(p);
}

async function getLatestVersion(apiUrl) {
  if (apiUrl) {
    try {
      const res = await fetch(`${apiUrl}/api/runs/latest-version?skill=${SKILL}`);
      const d = await res.json();
      if (d.version) return d.version;
    } catch {}
  }
  const local = loadJSON(LOCAL_PATH);
  if (local?.length) return local[local.length - 1].version;
  return null;
}

/* ── Phase 1: record prompt ── */
async function phaseStart() {
  console.log(`\n  ${SKILL} — record prompt\n`);

  const env = loadEnv();
  if (env.PROJECT_DIR) console.log(`  Project : ${env.PROJECT_DIR}`);
  if (env.SHESHA_MODULE) console.log(`  Module  : ${env.SHESHA_MODULE}`);
  if (env.DEFAULT_AGENT) console.log(`  Agent   : ${env.DEFAULT_AGENT}`);
  console.log('');

  const taskPrompt = await promptMultiline('Task prompt');
  if (!taskPrompt) { console.log('  No prompt entered. Aborting.'); return; }

  let config = loadJSON(CONFIG_PATH) || { apiUrl: '' };
  if (!config.apiUrl) {
    const env2 = loadEnv();
    if (env2.API_URL) config.apiUrl = env2.API_URL;
  }
  const latest = await getLatestVersion(config.apiUrl);
  const suggested = nextVersion(latest);

  const version = await prompt(`Version [${suggested}]: `) || suggested;
  const branch = version;

  const pending = {
    version,
    branch,
    prompt: taskPrompt,
    agent: env.DEFAULT_AGENT || 'opencode',
    module: env.SHESHA_MODULE || '',
    projectDir: env.PROJECT_DIR || '',
    createdAt: new Date().toISOString(),
    status: 'pending'
  };

  try { git('checkout', '-b', branch); } catch {}

  saveJSON(PENDING_PATH, pending);
  console.log('\n  \u2713 Prompt saved.');

  // Generate a complete context prompt for the AI
  const aiPrompt = [
    `## Task`,
    taskPrompt,
    ``,
    `## Context`,
    `- Skill directory: \`${SKILL_DIR}\``,
    env.PROJECT_DIR ? `- Project directory: \`${env.PROJECT_DIR}\`` : null,
    env.SHESHA_MODULE ? `- Shesha module: \`${env.SHESHA_MODULE}\`` : null,
    `- Branch: \`${branch}\``,
    env.DEFAULT_AGENT ? `- AI agent: ${env.DEFAULT_AGENT}` : null,
    ``,
    `## Instructions`,
    `1. Load the skill from the skill directory (SKILL.md) and follow its workflow`,
    `2. Execute the task using the skill's tools and templates`,
    `3. When the task is complete, run from the skill directory:`,
    `   \`\`\``,
    `   npm run test`,
    `   \`\`\``,
    `   This will record the results, commit, push, and save to the database.`,
  ].filter(Boolean).join('\n');

  writeFileSync(join(SKILL_DIR, '.current-prompt.md'), aiPrompt);
  console.log('  \u2713 AI-ready prompt written to .current-prompt.md');

  const instruction = `Load and execute the task from ${join(SKILL_DIR, '.current-prompt.md')}`;
  console.log('\n  Give this to your AI:\n');
  console.log(`  ${instruction}`);
  console.log('\n  Then when done, run: npm run test');
  if (FLAG_TEST_LOCAL) {
    console.log('  (--test-local: will auto-run Playwright verify after agent)');
  }
  console.log('');
}

/* ── Phase 2: record results ── */
async function phaseFinish() {
  console.log(`\n  ${SKILL} — record results\n`);

  let config = loadJSON(CONFIG_PATH) || { apiUrl: '' };
  if (!config.apiUrl) {
    const env = loadEnv();
    if (env.API_URL) config.apiUrl = env.API_URL;
  }
  if (!config.apiUrl) {
    const url = await prompt('API URL (or <enter> for offline): ');
    if (url) { config.apiUrl = url.replace(/\/+$/, ''); saveJSON(CONFIG_PATH, config); }
  }

  // Load pending prompt or ask fresh
  let pending = loadJSON(PENDING_PATH);
  if (pending) {
    console.log(`  Prompt: ${pending.prompt.slice(0, 120)}${pending.prompt.length > 120 ? '...' : ''}`);
    console.log(`  Branch: ${pending.branch}\n`);
  }

  const version = pending?.version || await getLatestVersion(config.apiUrl).then(v => nextVersion(v)) || 'v0.0.1';
  const versionInput = await prompt(`Version [${version}]: `);
  const resolvedVersion = versionInput || version;
  const branch = pending?.branch || resolvedVersion;

  console.log('');
  const commitMsg = await prompt('Commit Message (What changed?): ');
  const model = await prompt('Model: ');
  const tokens = await prompt('Tokens: ');
  const time = await prompt('Time (s): ');
  const rating = await prompt('Rating 1-5: ');
  const passed = (await prompt('Passed (y/n): ')).toLowerCase() === 'y';
  const findings = await promptFindings();

  const remoteUrl = getGitRemote();
  let promptText = pending?.prompt || null;

  const run = {
    skill: SKILL,
    version, branch,
    githubUrl: remoteUrl ? `${remoteUrl}/tree/${branch}` : null,
    prompt: promptText,
    model: model || null,
    tokensUsed: tokens ? +tokens : null,
    timeTakenSecs: time ? +time : null,
    rating: rating ? +rating : null,
    passed,
    findings: findings || null,
    createdAt: new Date().toISOString()
  };

  

  console.log('\n  Committing & pushing...');
  try {
    git('add', '-A');
    git('commit', '-m', commitMsg);
    git('push', '-u', 'origin', branch);
    run.githubUrl = remoteUrl ? `${remoteUrl}/tree/${branch}` : null;
    console.log('  \u2713 Pushed');
  } catch (e) {
    console.log(`  ! ${e.message.slice(0, 120)}`);
  }

  const local = loadJSON(LOCAL_PATH) || [];
  local.push(run);
  saveJSON(LOCAL_PATH, local);
  console.log('  \u2713 Saved locally');

  if (config.apiUrl) {
    try {
      const res = await fetch(`${config.apiUrl}/api/runs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run)
      });
      if (res.ok) console.log('  \u2713 Saved to DB');
      else console.log(`  ! HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      console.log(`  ! API unreachable: ${e.message}`);
    }
  }

  // Clear pending
  if (existsSync(PENDING_PATH)) {
    const completed = loadJSON(PENDING_PATH);
    if (completed) saveJSON(join(__dirname, 'completed.json'), completed);
    writeFileSync(PENDING_PATH, '');
  }

  // Clean up
  try { writeFileSync(join(SKILL_DIR, '.current-prompt.md'), ''); } catch {}

  console.log(`\n  \u2500\u2500 ${version} on ${branch} \u2500\u2500`);
  if (run.githubUrl) console.log(`  ${run.githubUrl}`);
  if (run.prompt) console.log(`  Prompt: ${run.prompt.slice(0, 80)}${run.prompt.length > 80 ? '...' : ''}`);
  console.log('');
}

/* ── main ── */
async function main() {
  const hasPending = existsSync(PENDING_PATH) && loadJSON(PENDING_PATH)?.prompt;

  if (FLAG_NEW || !hasPending) {
    await phaseStart();
  } else {
    await phaseFinish();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
