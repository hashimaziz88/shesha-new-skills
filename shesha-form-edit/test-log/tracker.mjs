#!/usr/bin/env node
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '..');
const CONFIG_PATH = join(__dirname, 'config.json');
const LOCAL_PATH = join(__dirname, 'runs.json');
const PENDING_PATH = join(__dirname, 'pending.json');
const ENV_PATH = join(__dirname, '.env');
const META_PATH = join(SKILL_DIR, '.current-run-meta.json');

const SKILL = 'shesha-form-edit';
const KEEP_FILES = new Set([
  'runs.json', 'iterations.json', 'pending.json', 'completed.json',
  'config.json', 'pending-iteration.json', '.env'
]);

const args = process.argv.slice(2);
const FLAG_NEW = args.includes('--new') || args.includes('-n');
const FLAG_TEST_LOCAL = args.includes('--test-local') || args.includes('-l');

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

function git(...a) {
  return execFileSync('git', a, { cwd: SKILL_DIR, encoding: 'utf8' }).trim();
}

function getGitRemote() {
  try {
    const url = git('remote', 'get-url', 'origin');
    return url.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/');
  } catch { return null; }
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
  if (!config.apiUrl && loadEnv().API_URL) config.apiUrl = loadEnv().API_URL;

  const latest = await getLatestVersion(config.apiUrl);
  const suggested = nextVersion(latest);

  const versionInput = await prompt(`Version [${suggested}]: `);
  const version = versionInput || suggested;
  const branch = version;

  const pending = {
    version, branch,
    prompt: taskPrompt,
    agent: env.DEFAULT_AGENT || 'opencode',
    module: env.SHESHA_MODULE || '',
    projectDir: env.PROJECT_DIR || '',
    createdAt: new Date().toISOString(),
    status: 'pending'
  };

  try { git('checkout', '-b', branch); } catch {}

  saveJSON(PENDING_PATH, pending);
  console.log('\n  ✓ Prompt saved.');

  const aiPrompt = [
    `## Task`,
    taskPrompt,
    ``,
    `## Context`,
    `- Skill directory: \`${SKILL_DIR}\``,
    env.PROJECT_DIR ? `- Project directory: \`${env.PROJECT_DIR}\`` : null,
    env.SHESHA_MODULE ? `- Shesha module: \`${env.SHESHA_MODULE}\`` : null,
    `- Branch: \`${branch}\``,
    `- Version: \`${version}\``,
    `- Read about modules: https://docs.shesha.io/docs/fundamentals/modules`,
    ``,
    `## Instructions for the AI`,
    ``,
    `### After reading this file, DELETE it immediately:`,
    `Delete \`.current-prompt.md\` so it does not persist.`,
    ``,
    `### Module naming for NEW modules/entities:`,
    `\`<Model>.<SystemName>.<VersionOfSkill>\`  e.g. \`OpenCode.DeepSeek.ERecruitment.v0.0.1\``,
    ``,
    `### Running the backend:`,
    `Ask the user to restart/run the backend. NEVER start it yourself.`,
    ``,
    `### npm run test is USER-ONLY:`,
    `After you finish, tell the user "Done — run npm run test to record results."`,
    `Do not run it yourself or fill in its prompts.`,
    ``,
    `### About npm run iterate:`,
    `After finishing, mention: "If the skill needs improvements, run npm run iterate for me to analyse and update it."`,
    ``,
    `### REQUIRED — write .current-run-meta.json before finishing:`,
    `Write this file to \`${META_PATH}\` (create or overwrite):`,
    `\`\`\`json`,
    `{`,
    `  "model": "<exact model ID you are running on, e.g. claude-opus-4-8>",`,
    `  "tokens": <total input+output tokens used in this session as a number>,`,
    `  "time": <whole seconds elapsed since you started this task as a number>,`,
    `  "commitMessage": "<concise conventional-commit message for changes made, e.g. feat: scaffold ERecruitment module>",`,
    `  "version": "${version}"`,
    `}`,
    `\`\`\``,
    `npm run test reads this file to skip those prompts — do not skip writing it.`,
    ``,
    `### REQUIRED — clean up all JSON/JS artifacts you created:`,
    `Delete every \`.json\` and \`.js\` file you created in:`,
    `- \`${__dirname}\``,
    env.PROJECT_DIR ? `- \`${env.PROJECT_DIR}\`` : null,
    `Safe to keep: runs.json, iterations.json, pending.json, completed.json, config.json, pending-iteration.json`,
    `Safe to keep: \`${META_PATH}\` (that is for npm run test)`,
    ``,
    `### Before finishing, report:`,
    `1. What was difficult while working with this skill`,
    `2. What should be updated in the skill (SKILL.md, templates, scripts, etc.)`,
    ``,
    `### Workflow:`,
    `1. Load the skill from SKILL.md in the skill directory and follow its workflow`,
    `2. Execute the task`,
    `3. DELETE \`.current-prompt.md\` after reading it`,
    `4. Write \`.current-run-meta.json\``,
    `5. Delete artifact files`,
    `6. Tell the user: "Done — run npm run test to record results."`,
  ].filter(Boolean).join('\n');

  writeFileSync(join(SKILL_DIR, '.current-prompt.md'), aiPrompt);
  console.log('  ✓ AI-ready prompt written to .current-prompt.md');

  const instruction = `Load and execute the task from ${join(SKILL_DIR, '.current-prompt.md')}`;
  console.log('\n  Give this to your AI:\n');
  console.log(`  ${instruction}`);
  console.log('\n  Then when done, run: npm run test');
  if (FLAG_TEST_LOCAL) console.log('  (--test-local: will auto-run Playwright verify after agent)');
  console.log('');
}

/* ── Phase 2: record results ── */
async function phaseFinish() {
  console.log(`\n  ${SKILL} — record results\n`);

  let config = loadJSON(CONFIG_PATH) || { apiUrl: '' };
  if (!config.apiUrl && loadEnv().API_URL) config.apiUrl = loadEnv().API_URL;
  if (!config.apiUrl) {
    const url = await prompt('API URL (or Enter to skip): ');
    if (url) { config.apiUrl = url.replace(/\/+$/, ''); saveJSON(CONFIG_PATH, config); }
  }

  // Read AI-provided meta and clean it up immediately
  const aiMeta = loadJSON(META_PATH) || {};
  if (existsSync(META_PATH)) { try { unlinkSync(META_PATH); } catch {} }

  if (Object.keys(aiMeta).length) {
    console.log('  Auto-filled from AI:');
    if (aiMeta.model)         console.log(`    Model  : ${aiMeta.model}`);
    if (aiMeta.tokens != null) console.log(`    Tokens : ${aiMeta.tokens}`);
    if (aiMeta.time   != null) console.log(`    Time   : ${aiMeta.time}s`);
    if (aiMeta.commitMessage)  console.log(`    Commit : ${aiMeta.commitMessage}`);
    console.log('');
  }

  const pending = loadJSON(PENDING_PATH);
  if (pending?.prompt) {
    console.log(`  Prompt: ${pending.prompt.slice(0, 120)}${pending.prompt.length > 120 ? '...' : ''}`);
    console.log(`  Branch: ${pending.branch}\n`);
  }

  const version = pending?.version || aiMeta.version || await getLatestVersion(config.apiUrl).then(v => nextVersion(v)) || 'v0.0.1';
  const versionInput = await prompt(`Version [${version}]: `);
  const resolvedVersion = versionInput || version;
  const branch = pending?.branch || resolvedVersion;

  // Commit message: AI suggestion with user override
  let commitMsg;
  if (aiMeta.commitMessage) {
    const override = await prompt(`Commit message [${aiMeta.commitMessage}]: `);
    commitMsg = override || aiMeta.commitMessage;
  } else {
    commitMsg = await prompt('Commit message: ');
  }

  const model  = aiMeta.model   ?? null;
  const tokens = aiMeta.tokens  ?? null;
  const time   = aiMeta.time    ?? null;

  console.log('');
  const rating  = await prompt('Rating 1-5: ');
  const passed  = (await prompt('Passed (y/n): ')).toLowerCase() === 'y';
  const findings = await promptMultiline('Findings');

  const remoteUrl = getGitRemote();

  const run = {
    skill: SKILL,
    version: resolvedVersion, branch,
    githubUrl: remoteUrl ? `${remoteUrl}/tree/${branch}` : null,
    prompt: pending?.prompt || null,
    model,
    tokensUsed: tokens,
    timeTakenSecs: time,
    rating: rating ? +rating : null,
    passed,
    findings: findings || null,
    createdAt: new Date().toISOString()
  };

  // Remove any leftover model artifacts before committing
  const removed = cleanModelArtifacts();
  if (!removed) console.log('\n  (no artifact files to clean)');

  console.log('\n  Committing & pushing...');
  try {
    git('add', '-A');
    git('commit', '-m', commitMsg);
    git('push', '-u', 'origin', branch);
    run.githubUrl = remoteUrl ? `${remoteUrl}/tree/${branch}` : null;
    console.log('  ✓ Pushed');
  } catch (e) {
    console.log(`  ! ${e.message.slice(0, 120)}`);
  }

  const local = loadJSON(LOCAL_PATH) || [];
  local.push(run);
  saveJSON(LOCAL_PATH, local);
  console.log('  ✓ Saved locally');

  if (config.apiUrl) {
    try {
      const res = await fetch(`${config.apiUrl}/api/runs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run)
      });
      if (res.ok) console.log('  ✓ Saved to DB');
      else console.log(`  ! HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      console.log(`  ! API unreachable: ${e.message}`);
    }
  }

  // Archive pending
  if (existsSync(PENDING_PATH)) {
    const completed = loadJSON(PENDING_PATH);
    if (completed?.prompt) saveJSON(join(__dirname, 'completed.json'), completed);
    writeFileSync(PENDING_PATH, '{}');
  }

  // Clean up prompt file if AI left it
  try { unlinkSync(join(SKILL_DIR, '.current-prompt.md')); } catch {}

  console.log(`\n  ── ${resolvedVersion} on ${branch} ──`);
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
