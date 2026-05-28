#!/usr/bin/env node
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'config.json');
const LOCAL_PATH = join(__dirname, 'runs.json');

const SKILL = 'shesha-form-edit';

function prompt(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

function promptFindings() {
  console.log('Findings (multi-line; type END on its own line to finish):');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    const lines = [];
    rl.on('line', line => {
      if (line.trim() === 'END') { rl.close(); return; }
      lines.push(line);
    });
    rl.on('close', () => res(lines.join('\n').trim()));
  });
}

function git(...args) {
  return execFileSync('git', args, { cwd: join(__dirname, '..'), encoding: 'utf8' }).trim();
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

function parseVersion(v) {
  if (!v) return null;
  const m = v.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
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
      const data = await res.json();
      if (data.version) return data.version;
    } catch {}
  }
  const local = loadJSON(LOCAL_PATH);
  if (local?.length) return local[local.length - 1].version;
  return null;
}

async function main() {
  console.log(`\n  ${SKILL} — test logger\n`);

  let config = loadJSON(CONFIG_PATH) || { apiUrl: '' };

  if (!config.apiUrl) {
    const url = await prompt('API URL (e.g. https://test-tracker.vercel.app) or <enter> for offline: ');
    if (url) { config.apiUrl = url.replace(/\/+$/, ''); saveJSON(CONFIG_PATH, config); }
  }

  const latest = await getLatestVersion(config.apiUrl);
  const suggested = nextVersion(latest);

  const version = await prompt(`Version [${suggested}]: `) || suggested;
  const branch = await prompt(`Branch [${getCurrentBranch()}]: `) || getCurrentBranch();
  const model = await prompt('Model: ');
  const tokens = await prompt('Tokens: ');
  const time = await prompt('Time (s): ');
  const rating = await prompt('Rating 1-5: ');
  const passed = (await prompt('Passed (y/n): ')).toLowerCase() === 'y';
  const findings = await promptFindings();

  const remoteUrl = getGitRemote();
  const run = {
    skill: SKILL,
    version, branch,
    githubUrl: remoteUrl ? `${remoteUrl}/tree/${branch}` : null,
    model: model || null,
    tokensUsed: tokens ? +tokens : null,
    timeTakenSecs: time ? +time : null,
    rating: rating ? +rating : null,
    passed,
    findings: findings || null,
    createdAt: new Date().toISOString()
  };

  const msg = run.findings ? run.findings.split('\n')[0].slice(0, 100) : `test run ${version}`;

  

  console.log('\n  Committing & pushing...');
  try {
    git('add', '-A');
    git('commit', '-m', `${version}: ${msg}`);
    git('push', '-u', 'origin', branch + '-' + version);
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

  console.log(`\n  \u2500\u2500 ${version} on ${branch} \u2500\u2500`);
  if (run.githubUrl) console.log(`  ${run.githubUrl}`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
