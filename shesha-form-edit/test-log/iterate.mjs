#!/usr/bin/env node
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '..');
const CONFIG_PATH = join(__dirname, 'config.json');
const ENV_PATH = join(__dirname, '.env');

const SKILL = 'shesha-form-edit';

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

async function main() {
  console.log(`\n  ${SKILL} — prepare skill iteration analysis\n`);

  let config = loadJSON(CONFIG_PATH) || { apiUrl: '' };
  if (!config.apiUrl) {
    const env = loadEnv();
    if (env.API_URL) config.apiUrl = env.API_URL;
  }

  const env = loadEnv();

  const aiPrompt = [
    `## Task`,
    `Review all recent test runs and iterations, identify unaddressed issues, and suggest skill improvements.`,
    ``,
    `## Context`,
    `- Skill directory: \`${SKILL_DIR}\``,
    env.PROJECT_DIR ? `- Project directory: \`${env.PROJECT_DIR}\`` : null,
    env.SHESHA_MODULE ? `- Shesha module: \`${env.SHESHA_MODULE}\`` : null,
    config.apiUrl ? `- API URL: \`${config.apiUrl}\`` : null,
    `- Read about shesha: https://docs.shesha.io/`,
    ``,
    `## Instructions for the AI`,
    ``,
    `### 1. Fetch data:`,
    `Call \`GET ${config.apiUrl ? config.apiUrl + '/api/runs' : '<local runs>'}\` and \`GET ${config.apiUrl ? config.apiUrl + '/api/iterations' : '<local iterations>'}\``,
    `to get all recent runs and iterations.`,
    ``,
    `If the API is unreachable, look at local files:`,
    `- \`${join(__dirname, 'runs.json')}\``,
    `- \`${join(__dirname, 'iterations.json')}\``,
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
    `- What should be updated in the skill for future use`,
    `- Ask: "Run npm run iterate to record this iteration, then npm run test to begin the next cycle."`,
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
  console.log('  \u2713 Analysis prompt written to .current-prompt.md');

  const instruction = `Load and execute the task from ${join(SKILL_DIR, '.current-prompt.md')}`;
  console.log('\n  Give this to your AI:\n');
  console.log(`  ${instruction}`);
  console.log('\n  The AI will:');
  console.log('    1. Fetch past runs and iterations');
  console.log('    2. Identify unaddressed issues');
  console.log('    3. Suggest a fix plan');
  console.log('    4. Wait for your approval');
  console.log('    5. Execute the changes');
  console.log('\n  After the AI finishes, run: npm run iterate (to record) then npm run test (next cycle)');
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
