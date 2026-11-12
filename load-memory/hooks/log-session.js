// Global Stop hook: appends a lightweight breadcrumb line after every assistant
// response, across every project/session. Never throws — a broken log entry
// must never block or crash a Claude Code turn.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const hookInput = input ? JSON.parse(input) : {};
    const cwd = process.cwd();

    let branch = null;
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
    } catch (e) {
      // Not a git repo, or git unavailable -- leave branch null.
    }

    const entry = {
      ts: new Date().toISOString(),
      session_id: hookInput.session_id || null,
      cwd,
      branch,
    };

    const logPath = path.join(os.homedir(), '.claude', 'session-log.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Fail silently -- logging must never break the session.
  }
});
