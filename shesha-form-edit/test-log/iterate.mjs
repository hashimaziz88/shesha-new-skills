#!/usr/bin/env node
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '..');
const CONFIG_PATH = join(__dirname, 'config.json');
const ENV_PATH = join(__dirname, '.env');
const PENDING_PATH = join(__dirname, 'pending-iteration.json');
const LOCAL_PATH = join(__dirname, 'iterations.json');
const RUNS_PATH = join(__dirname, 'runs.json');
const META_PATH = join(SKILL_DIR, '.current-iteration-meta.json');

const SKILL = 'shesha-form-edit';
const KEEP_FILES = new Set([
  'runs.json', 'iterations.json', 'pending.json', 'completed.json',
  'config.json', 'pending-iteration.json', '.env'
]);

const args = process.argv.slice(2);
const FLAG_NEW = args.includes('--new') || args.includes('-n');

/* ── helpers ── */

function prompt(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

function promptMultiline(label) {
  console.log(`${label} (blank line to finish):`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    const lines = [];
    rl.on('line', line => {
      if (line === '') { rl.close(); return; }
      lines.push(line);
    });
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
  const config = loadJSON(CONFIG_PATH) || {};
  if (config.apiUrl) return config.apiUrl.replace(/\/$/, '');
  return (loadEnv().API_URL || '').replace(/\/$/, '');
}

function getLatestRunVersion() {
  const runs = loadJSON(RUNS_PATH) || [];
  return runs.length ? runs[runs.length - 1].version : null;
}

function cleanModelArtifacts() {
  let removed = 0;
  try {
    for (const f of readdirSync(__dirname)) {
      if ((f.endsWith('.json') || f.endsWith('.js')) && !KEEP_FILES.has(f)) {
        try { unlinkSync(join(__dirname, f)); removed++; console.log(`  ✓ Removed artifact: ${f}`); } catch {}
      }
    }
  } catch {}
  return removed;
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
    `Review all recent test runs and iterations, identify unaddressed issues, and improve the skill.`,
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
    apiUrl
      ? `Call GET \`${apiUrl}/api/runs?skill=${SKILL}\` and GET \`${apiUrl}/api/iterations?skill=${SKILL}\``
      : `Read local files: \`${RUNS_PATH}\` and \`${LOCAL_PATH}\``,
    `If the API is unreachable, fall back to local files:`,
    `- \`${RUNS_PATH}\``,
    `- \`${LOCAL_PATH}\``,
    ``,
    `### 2. Analyse:`,
    `- Identify runs that failed, have low ratings (< 4), or have findings`,
    `- Check which issues have been addressed in previous iterations`,
    `- Find patterns in failures (same entity, same template type, same error)`,
    `- List unaddressed issues`,
    ``,
    `### 3. Suggest a plan:`,
    `Present the user with a clear plan of what to update in the skill:`,
    `- Which files to change (SKILL.md, templates, scripts, etc.)`,
    `- What to change and why`,
    `- Expected impact`,
    ``,
    `### 4. Wait for confirmation:`,
    `Ask: "Shall I proceed with this plan?" — only execute after the user confirms.`,
    ``,
    `### 5. Execute:`,
    `Make the agreed changes to the skill files.`,
    ``,
    `### REQUIRED — write .current-iteration-meta.json before finishing:`,
    `Write this file to \`${META_PATH}\` (create or overwrite):`,
    `\`\`\`json`,
    `{`,
    `  "version": "<skill version you improved, e.g. v0.0.7>",`,
    `  "summary": "<one-paragraph description of what was changed>",`,
    `  "rationale": "<which findings or failures prompted this>",`,
    `  "analysis": "<patterns you found across runs>",`,
    `  "filesChanged": "<newline-separated list of files you modified>",`,
    `  "triggerRunIds": "<comma-separated run IDs that triggered this, or empty string>"`,
    `}`,
    `\`\`\``,
    `npm run iterate reads this file to skip those prompts — do not skip writing it.`,
    ``,
    `### REQUIRED — clean up all JSON/JS artifacts you created:`,
    `Delete every \`.json\` and \`.js\` file you created in \`${__dirname}\`.`,
    `Safe to keep: runs.json, iterations.json, pending.json, completed.json, config.json, pending-iteration.json`,
    `Safe to keep: \`${META_PATH}\` (that is for npm run iterate)`,
    ``,
    `### Module naming (if new modules needed):`,
    `\`<Model>.<SystemName>.<VersionOfSkill>\`  e.g. \`OpenCode.DeepSeek.ERecruitment.v0.0.1\``,
    ``,
    `### Running the backend:`,
    `Ask the user to restart/run the backend. NEVER start it yourself.`,
    ``,
    `### 6. After execution, say:`,
    `"Run npm run iterate to record this iteration, then npm run test to begin the next cycle."`,
    ``,
    `### Delete this file:`,
    `Delete \`.current-prompt.md\` immediately after reading.`,
  ].filter(Boolean).join('\n');

  writeFileSync(join(SKILL_DIR, '.current-prompt.md'), aiPrompt);

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

  if (pending?.triggeredByVersion) {
    console.log(`  Triggered by run: ${pending.triggeredByVersion}`);
  }

  // Read AI-provided meta and clean it up immediately
  const aiMeta = loadJSON(META_PATH) || {};
  if (existsSync(META_PATH)) { try { unlinkSync(META_PATH); } catch {} }

  if (Object.keys(aiMeta).length) {
    console.log('\n  Auto-filled from AI:');
    if (aiMeta.version)      console.log(`    Version      : ${aiMeta.version}`);
    if (aiMeta.summary)      console.log(`    Summary      : ${String(aiMeta.summary).split('\n')[0].slice(0, 80)}`);
    if (aiMeta.filesChanged) console.log(`    Files changed: ${String(aiMeta.filesChanged).split('\n').length} file(s)`);
    console.log('');
  }

  // Version: AI or pending, with user confirm
  const versionDefault = aiMeta.version || pending?.triggeredByVersion || 'unknown';
  const versionInput = await prompt(`Skill version this improves [${versionDefault}]: `);
  const version = versionInput || versionDefault;

  // Summary: AI suggestion with optional override
  let summary;
  if (aiMeta.summary) {
    console.log(`\n  Summary (from AI):\n${aiMeta.summary}\n`);
    const override = await prompt('Override summary? (Enter to keep): ');
    summary = override || aiMeta.summary;
  } else {
    summary = await promptMultiline('Summary — what was changed');
  }

  // Rationale
  let rationale;
  if (aiMeta.rationale) {
    console.log(`\n  Rationale (from AI):\n${aiMeta.rationale}\n`);
    const override = await prompt('Override rationale? (Enter to keep): ');
    rationale = override || aiMeta.rationale;
  } else {
    rationale = await promptMultiline('Rationale — why (which findings prompted this)');
  }

  // Analysis
  let analysis;
  if (aiMeta.analysis) {
    console.log(`\n  Analysis (from AI):\n${aiMeta.analysis}\n`);
    const override = await prompt('Override analysis? (Enter to keep): ');
    analysis = override || aiMeta.analysis;
  } else {
    analysis = await promptMultiline('Analysis — patterns found across runs');
  }

  // Files changed
  const filesChanged = aiMeta.filesChanged || await promptMultiline('Files changed (one per line)');

  // Trigger run IDs
  const triggerRunIdsDefault = aiMeta.triggerRunIds || '';
  const triggerRunIdsInput = await prompt(`Trigger run IDs [${triggerRunIdsDefault || 'none'}]: `);
  const triggerRunIds = triggerRunIdsInput || triggerRunIdsDefault || null;

  const iteration = {
    skill: SKILL,
    version,
    summary: summary || null,
    rationale: rationale || null,
    analysis: analysis || null,
    filesChanged: filesChanged || null,
    triggerRunIds: triggerRunIds || null
  };

  // Clean up any leftover model artifacts
  cleanModelArtifacts();

  const local = loadJSON(LOCAL_PATH) || [];
  local.push(iteration);
  saveJSON(LOCAL_PATH, local);
  console.log('\n  ✓ Saved to iterations.json');

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
        console.log('    (saved locally — push manually when API is ready)');
      }
    } catch (e) {
      console.log(`  ! API unreachable: ${e.message}`);
      console.log('    (saved locally)');
    }
  }

  writeFileSync(PENDING_PATH, '{}');
  try { unlinkSync(join(SKILL_DIR, '.current-prompt.md')); } catch {}

  console.log(`\n  ── Iteration recorded for ${version} ──`);
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
