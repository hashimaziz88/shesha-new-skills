#!/usr/bin/env node
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '..');
const CONFIG_PATH = join(__dirname, 'config.json');
const ENV_PATH = join(__dirname, '.env');
const PENDING_PATH = join(__dirname, 'pending-iteration.json');
const LOCAL_PATH = join(__dirname, 'iterations.json');
const RUNS_PATH = join(__dirname, 'runs.json');

const SKILL = 'shesha-form-edit';
const args = process.argv.slice(2);
const FLAG_NEW = args.includes('--new') || args.includes('-n');

/* ── helpers ── */

function prompt(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
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

function loadJSON(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
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

function getApiUrl() {
  let config = loadJSON(CONFIG_PATH) || {};
  if (config.apiUrl) return config.apiUrl.replace(/\/$/, '');
  const env = loadEnv();
  return (env.API_URL || '').replace(/\/$/, '');
}

function getLatestRunVersion() {
  const runs = loadJSON(RUNS_PATH) || [];
  return runs.length ? runs[runs.length - 1].version : null;
}

/* ── Phase 1: write analysis prompt ── */
async function phaseStart() {
  console.log(`\n  ${SKILL} — prepare skill iteration analysis\n`);

  const env = loadEnv();
  const apiUrl = getApiUrl();
  const latestRun = getLatestRunVersion();

  if (env.PROJECT_DIR) console.log(`  Project : ${env.PROJECT_DIR}`);
  if (env.SHESHA_MODULE) console.log(`  Module  : ${env.SHESHA_MODULE}`);
  if (latestRun) console.log(`  Last run: ${latestRun}`);
  console.log('');

  const aiPrompt = [
    `## Task`,
    `Review all recent test runs and iterations, identify unaddressed issues, and suggest skill improvements.`,
    ``,
    `## Context`,
    `- Skill directory: \`${SKILL_DIR}\``,
    env.PROJECT_DIR ? `- Project directory: \`${env.PROJECT_DIR}\`` : null,
    env.SHESHA_MODULE ? `- Shesha module: \`${env.SHESHA_MODULE}\`` : null,
    apiUrl ? `- API URL: \`${apiUrl}\`` : null,
    `- Read about shesha: https://docs.shesha.io/`,
    ``,
    `## Instructions for the AI`,
    ``,
    `### 1. Fetch data:`,
    `Call \`GET ${apiUrl ? apiUrl + '/api/runs?skill=' + SKILL : '<local runs>'}\``,
    `and \`GET ${apiUrl ? apiUrl + '/api/iterations?skill=' + SKILL : '<local iterations>'}\``,
    `to get all recent runs and iterations.`,
    ``,
    `If the API is unreachable, look at local files:`,
    `- \`${RUNS_PATH}\``,
    `- \`${LOCAL_PATH}\``,
    ``,
    `### 2. Analyze:`,
    `- Identify runs that failed, have low ratings (< 4), or have findings`,
    `- Check which issues have been addressed in previous iterations`,
    `- Find patterns in the failures (same entity, same template type, same error)`,
    `- List unaddressed issues`,
    ``,
    `### 3. Suggest a plan:`,
    `Present the user with a clear plan of what to update in the skill:`,
    `- Which files to change (SKILL.md, templates, scripts, etc.)`,
    `- What to change and why`,
    `- Expected impact`,
    ``,
    `### 4. Wait for confirmation:`,
    `Ask the user: "Shall I proceed with this plan?"`,
    `Only execute after the user confirms.`,
    ``,
    `### 5. Execute:`,
    `Make the agreed changes to the skill files.`,
    ``,
    `### 6. After execution, report:`,
    `- What was difficult about working with the skill`,
    `- What was updated`,
    `- Then say: "Run npm run iterate to record this iteration, then npm run test to begin the next cycle."`,
    ``,
    `### Module naming (if new modules needed):`,
    `\`<Model>.<SystemName>.<VersionOfSkill>\``,
    `Example: \`OpenCode.DeepSeek.ERecruitment.v0.0.1\``,
    ``,
    `### Running the backend:`,
    `Ask the user to restart/run the backend. NEVER start it yourself.`,
    ``,
    `### Delete this file:`,
    `Delete \`.current-prompt.md\` after reading.`,
  ].filter(Boolean).join('\n');

  writeFileSync(join(SKILL_DIR, '.current-prompt.md'), aiPrompt);

  // Save pending state so phase 2 knows which run triggered this
  saveJSON(PENDING_PATH, {
    triggeredByVersion: latestRun,
    createdAt: new Date().toISOString()
  });

  console.log('  ✓ Analysis prompt written to .current-prompt.md');
  console.log('  ✓ Pending iteration saved');

  const instruction = `Load and execute the task from ${join(SKILL_DIR, '.current-prompt.md')}`;
  console.log('\n  Give this to your AI:\n');
  console.log(`  ${instruction}`);
  console.log('\n  The AI will:');
  console.log('    1. Fetch past runs and iterations');
  console.log('    2. Identify unaddressed issues');
  console.log('    3. Suggest a fix plan');
  console.log('    4. Wait for your approval');
  console.log('    5. Execute the changes');
  console.log('\n  After the AI finishes, run: npm run iterate  (to record it)');
  console.log('  Then run: npm run test  (to begin the next test cycle)');
  console.log('');
}

/* ── Phase 2: record the iteration ── */
async function phaseFinish() {
  console.log(`\n  ${SKILL} — record iteration\n`);

  const pending = loadJSON(PENDING_PATH);
  const apiUrl = getApiUrl();
  const env = loadEnv();

  if (pending?.triggeredByVersion) {
    console.log(`  Triggered by run: ${pending.triggeredByVersion}`);
  }
  console.log('');

  const version = await prompt('Skill version this improves (e.g. v0.0.6): ');
  const summary = await promptMultiline('Summary — what was changed');
  const rationale = await promptMultiline('Rationale — why (which findings prompted this)');
  const analysis = await promptMultiline('Analysis — patterns found across runs');
  const filesChanged = await promptMultiline('Files changed (one per line)');
  const triggerRunIdsRaw = await promptMultiline('Trigger run IDs (one per line, from API runs)');
  const triggerRunIds = triggerRunIdsRaw ? triggerRunIdsRaw.split('\n').map(s => s.trim()).filter(Boolean).join(',') : null;

  const iteration = {
    skill: SKILL,
    version: version || pending?.triggeredByVersion || 'unknown',
    summary: summary || null,
    rationale: rationale || null,
    analysis: analysis || null,
    filesChanged: filesChanged || null,
    triggerRunIds: triggerRunIds || null
  };

  // Save locally
  const local = loadJSON(LOCAL_PATH) || [];
  local.push(iteration);
  saveJSON(LOCAL_PATH, local);
  console.log('\n  ✓ Saved to iterations.json');

  // POST to API
  if (apiUrl) {
    try {
      const res = await fetch(`${apiUrl}/api/iterations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(iteration)
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        console.log(`  ✓ Saved to API${body.id ? ' (id: ' + body.id + ')' : ''}`);
      } else {
        const text = await res.text().catch(() => '');
        console.log(`  ! API ${res.status}: ${text.slice(0, 120)}`);
        console.log('    (iteration saved locally — push manually when API is ready)');
      }
    } catch (e) {
      console.log(`  ! API unreachable: ${e.message}`);
      console.log('    (iteration saved locally)');
    }
  }

  // Clear pending
  writeFileSync(PENDING_PATH, '{}');
  try { writeFileSync(join(SKILL_DIR, '.current-prompt.md'), ''); } catch {}

  console.log(`\n  ── Iteration recorded for ${iteration.version} ──`);
  if (iteration.summary) console.log(`  ${String(iteration.summary).split('\n')[0].slice(0, 80)}`);
  console.log('');
  console.log('  Next: npm run test  to begin the next test cycle');
  console.log('');
}

/* ── main ── */
async function main() {
  const pending = loadJSON(PENDING_PATH);
  const hasPending = pending && pending.triggeredByVersion;

  if (FLAG_NEW || !hasPending) {
    await phaseStart();
  } else {
    await phaseFinish();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
