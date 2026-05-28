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
const LOCAL_RUNS_PATH = join(__dirname, 'runs.json');

const SKILL = 'shesha-form-edit';

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

function git(...args) {
  return execFileSync('git', args, { cwd: SKILL_DIR, encoding: 'utf8' }).trim();
}

function getGitRemote() {
  try {
    const url = git('remote', 'get-url', 'origin');
    return url.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/');
  } catch { return null; }
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

async function main() {
  console.log(`\n  ${SKILL} — record iteration\n`);

  let config = loadJSON(CONFIG_PATH) || { apiUrl: '' };
  if (!config.apiUrl) {
    const env = loadEnv();
    if (env.API_URL) config.apiUrl = env.API_URL;
  }
  if (!config.apiUrl) {
    const url = await prompt('API URL (or <enter> for offline): ');
    if (url) { config.apiUrl = url.replace(/\/+$/, ''); saveJSON(CONFIG_PATH, config); }
  }

  // Show recent failed / low-rated runs to inform the iteration
  console.log('');
  if (config.apiUrl) {
    try {
      const res = await fetch(`${config.apiUrl}/api/runs`);
      const runs = await res.json();
      const flagged = runs.filter(r => !r.passed || (r.rating != null && r.rating < 4));
      if (flagged.length) {
        console.log(`  ${flagged.length} run(s) with issues:\n`);
        for (const r of flagged.slice(0, 5)) {
          const date = new Date(r.createdAt).toLocaleDateString();
          const rating = r.rating != null ? '★'.repeat(r.rating) : '-';
          const findings = r.findings ? r.findings.slice(0, 100) : '(no findings)';
          console.log(`    ${r.version} ${rating} [${r.passed ? 'pass' : 'FAIL'}] ${findings}${r.findings?.length > 100 ? '…' : ''}`);
        }
      } else {
        console.log('  No flagged runs found.');
      }
    } catch { console.log('  (could not fetch runs from API)'); }
  }

  // Also show local runs
  const localRuns = loadJSON(LOCAL_RUNS_PATH) || [];
  const localFlagged = localRuns.filter(r => !r.passed || (r.rating != null && r.rating < 4));
  if (localFlagged.length) {
    console.log(`\n  ${localFlagged.length} local run(s) with issues:\n`);
    for (const r of localFlagged.slice(0, 5)) {
      const rating = r.rating != null ? '★'.repeat(r.rating) : '-';
      const findings = r.findings ? r.findings.slice(0, 100) : '(no findings)';
      console.log(`    ${r.version} ${rating} [${r.passed ? 'pass' : 'FAIL'}] ${findings}${r.findings?.length > 100 ? '…' : ''}`);
    }
  }

  console.log('\n  Enter iteration details:\n');

  const version = await prompt('Version: ');
  const summary = await prompt('Summary of changes: ');
  const rationale = await promptMultiline('Rationale (why these changes were made)');
  const analysis = await promptMultiline('Analysis (what the AI reviewed and decided)');
  const filesChanged = await prompt('Files changed (comma-separated): ');
  const triggerRunIds = await prompt('Triggered by run IDs (comma-separated, optional): ');

  const branch = version;

  const iteration = {
    skill: SKILL,
    version,
    branch,
    summary,
    rationale,
    analysis,
    filesChanged: filesChanged || null,
    triggerRunIds: triggerRunIds || null,
    createdAt: new Date().toISOString()
  };

  const commitMsg = `iteration ${version}: ${summary.slice(0, 100)}`;

  console.log('\n  Committing & pushing...');
  try {
    git('add', '-A');
    git('commit', '-m', commitMsg);
    git('push', '-u', 'origin', branch);
    console.log('  \u2713 Pushed');
  } catch (e) {
    console.log(`  ! ${e.message.slice(0, 120)}`);
  }

  // Save locally
  const localPath = join(__dirname, 'iterations.json');
  const local = loadJSON(localPath) || [];
  local.push(iteration);
  saveJSON(localPath, local);
  console.log('  \u2713 Saved locally');

  // Post to API
  if (config.apiUrl) {
    try {
      const res = await fetch(`${config.apiUrl}/api/iterations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(iteration)
      });
      if (res.ok) console.log('  \u2713 Saved to DB');
      else console.log(`  ! HTTP ${res.status}: ${await res.text()}`);
    } catch (e) {
      console.log(`  ! API unreachable: ${e.message}`);
    }
  }

  console.log(`\n  \u2500\u2500 ${version} \u2500\u2500`);
  if (summary) console.log(`  ${summary}`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
