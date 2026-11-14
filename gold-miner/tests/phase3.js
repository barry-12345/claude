// Phase-3 suite = the leaderboard server's own tests (server/: node:test, incl. the deploy.sh checks D-01..D-05).
// Runs `npm test` in server/ (after `npm ci` when node_modules is missing) and reports one check per summary line.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { report } = require('./lib');
async function run() {
  const dir = path.join(__dirname, '..', 'server');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'better-sqlite3'))) execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
  const r = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const num = k => { const m = new RegExp('^# ' + k + ' (\\d+)', 'm').exec(out); return m ? +m[1] : -1; };
  const fails = out.split('\n').filter(l => /^not ok /.test(l.trim())).map(l => l.trim());
  report('PHASE3-server', r.status === 0 && num('fail') === 0 && num('pass') > 0,
    `cd server && npm test: exit ${r.status}, tests ${num('tests')}, pass ${num('pass')}, fail ${num('fail')}, skipped ${num('skipped')}${fails.length ? ' FAILED: ' + fails.slice(0, 5).join(' | ') : ''}`);
}
module.exports = { run };
