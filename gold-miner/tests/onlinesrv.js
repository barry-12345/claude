// Online server suite = `cd online && npm test` (node:test: O-01, O-03, O-04, O-26 server side, O-30..O-32, O-40..O-45).
// Installs online/ dependencies first when they are missing; reports one check, with the numbers each test printed.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { report } = require('./lib');
async function run() {
  const dir = path.join(__dirname, '..', 'online');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'ws'))) execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
  const env = Object.assign({}, process.env); delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', 'test/*.test.js'], { cwd: dir, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  for (const l of out.split('\n')) if (/^# \\# O-|^# # O-/.test(l)) console.log('  ' + l.replace(/^# \\?# /, ''));   // the measured numbers
  const num = k => { const m = new RegExp('^# ' + k + ' (\\d+)', 'm').exec(out); return m ? +m[1] : -1; };
  const fails = out.split('\n').filter(l => /^not ok /.test(l.trim())).map(l => l.trim());
  report('ONLINE-server', r.status === 0 && num('fail') === 0 && num('pass') > 0,
    `cd online && npm test: exit ${r.status}, tests ${num('tests')}, pass ${num('pass')}, fail ${num('fail')}, skipped ${num('skipped')}${fails.length ? ' FAILED: ' + fails.slice(0, 5).join(' | ') : ''}`);
}
module.exports = { run };
