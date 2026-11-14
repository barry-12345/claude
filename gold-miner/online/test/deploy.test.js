'use strict';
// O-40 .. O-45: the coexistence deployment scripts, run in a sandbox: GM_ROOT=<temp dir> plus fake caddy / systemctl / ss / curl /
// useradd / userdel / id / npm / node (and logging traps for apt-get, nginx, certbot, ufw, kill, pkill) first in PATH.
// Every fake call is appended to $GM_LOG.  Real `caddy validate` / `caddy adapt` (O-41) use a downloaded official binary when available.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const DEPLOY = path.join(REPO, 'deploy');
const DOMAIN = 'goldminer.43.161.221.249.sslip.io';
const MARK_BEGIN = '# >>> goldminer (由 deploy-online.sh 添加;卸载请运行 uninstall-online.sh)';
const MARK_END = '# <<< goldminer';
// the user's Caddyfile (SPEC s0: the existing site proxies to 127.0.0.1:8787), braces completed
const USER_CADDYFILE = '# 现有站点(不属于本项目)\n43.161.221.249.sslip.io {\n\treverse_proxy 127.0.0.1:8787\n}\n';
const sh = (cmd, args, opts = {}) => cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts));
const have = bin => sh('sh', ['-c', `command -v ${bin}`]).status === 0;

// ---------------------------------------------------------------- sandbox
const FAKES = {
  id: `if [ "$1" = "-u" ]; then echo 0; exit 0; fi
if [ "$1" = goldminer ]; then [ -f "$FAKE/user-goldminer" ]; exit $?; fi
exit 0`,
  useradd: 'for a; do last="$a"; done; touch "$FAKE/user-$last"',
  userdel: 'rm -f "$FAKE/user-$1"',
  caddy: `if [ "$1" = validate ]; then
  f="$3"
  if [ -f "$FAKE/validate-orig-fail" ] && ! grep -q '^import /etc/caddy/goldminer.caddy' "$f"; then exit 1; fi
  if [ -f "$FAKE/validate-import-fail" ] && grep -q '^import /etc/caddy/goldminer.caddy' "$f"; then exit 1; fi
  exit 0
fi
[ "$1" = version ] && echo v2.6.2
exit 0`,
  systemctl: `case "$1 $2 $3" in
  "is-active --quiet caddy") exit 0 ;;
  "is-active --quiet goldminer-online") [ -f "$FAKE/svc-active" ]; exit $? ;;
  "reload caddy"*) if [ -f "$FAKE/reload-fail" ]; then exit 1; fi; exit 0 ;;
  "restart goldminer-online"*) touch "$FAKE/svc-active" ;;
  "stop goldminer-online"*) rm -f "$FAKE/svc-active" ;;
esac
exit 0`,
  ss: '[ -f "$FAKE/ss-listen" ] && cat "$FAKE/ss-listen"; exit 0',
  curl: `for a; do url="$a"; done
case "$url" in
  */online/health) [ -f "$FAKE/health-fail" ] && exit 7; echo "{\\"ok\\":true,\\"games\\":$(cat "$FAKE/games" 2>/dev/null || echo 0)}"; exit 0 ;;
  https://43.161.221.249.sslip.io/)
    code=200
    if [ -f "$FAKE/break-existing" ] && grep -q '^import /etc/caddy/goldminer.caddy' "$GM_ROOT/etc/caddy/Caddyfile"; then code=502; fi
    echo "$code"; exit 0 ;;
esac
echo 200`,
  npm: 'mkdir -p node_modules/ws && echo fake > node_modules/ws/index.js',
  node: 'echo 22',
};
const TRAPS = ['apt-get', 'apt', 'nginx', 'certbot', 'ufw', 'kill', 'pkill', 'killall', 'n', 'nvm'];
function sandbox(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-deploy-'));
  const bin = path.join(root, '.bin'), fake = path.join(root, '.fake');
  fs.mkdirSync(bin); fs.mkdirSync(fake);
  const write = (p, s, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, mode ? { mode } : undefined); };
  for (const [name, body] of Object.entries(FAKES)) write(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "$GM_LOG"\n${body}\n`, 0o755);
  for (const name of TRAPS) write(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "$GM_LOG"\nexit 0\n`, 0o755);
  write(path.join(root, 'etc/os-release'), 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.4 LTS"\n');
  write(path.join(root, 'etc/caddy/Caddyfile'), opts.caddyfile != null ? opts.caddyfile : USER_CADDYFILE);
  write(path.join(root, 'usr/bin/node'), `#!/bin/sh\necho "node $*" >> "$GM_LOG"\necho 22\n`, 0o755);
  fs.mkdirSync(path.join(root, 'etc/systemd/system'), { recursive: true });
  for (const f of opts.flags || []) fs.writeFileSync(path.join(fake, f), '');
  const log = path.join(root, '.calls.log'); fs.writeFileSync(log, '');
  const env = Object.assign({}, process.env, { GM_ROOT: root, GM_LOG: log, FAKE: fake, PATH: `${bin}:${process.env.PATH}` });
  const run = (script, args = []) => {
    fs.writeFileSync(log, '');                                              // calls of this run only
    const r = sh('bash', [path.join(DEPLOY, script), ...args], { env, timeout: 120000 });
    r.calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
    return r;
  };
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');
  const exists = p => fs.existsSync(path.join(root, p));
  const flag = (f, on = true) => { const p = path.join(fake, f); if (on) fs.writeFileSync(p, ''); else fs.rmSync(p, { force: true }); };
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, run, read, exists, flag, log, cleanup, env };
}
// hash of the whole sandbox tree (paths, modes, contents), without the fake-command area and the call log
function treeHash(root) {
  const h = crypto.createHash('sha256');
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (d === root && (e.name === '.bin' || e.name === '.fake' || e.name === '.calls.log')) continue;
      const p = path.join(d, e.name), st = fs.lstatSync(p);
      h.update(path.relative(root, p) + ':' + (st.mode & 0o7777) + '\n');
      if (e.isDirectory()) walk(p); else if (e.isFile()) h.update(fs.readFileSync(p));
    }
  };
  walk(root);
  return h.digest('hex');
}
const allCalls = [];
const record = r => { allCalls.push(...r.calls); return r; };
const deploy = (s, extra = []) => record(s.run('deploy-online.sh', ['--domain', DOMAIN, ...extra]));

// ---------------------------------------------------------------- O-40
test('O-40 ① normal deployment: files, modes, unit, env, Caddy site, 3 appended lines', () => {
  const s = sandbox();
  try {
    const r = deploy(s);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const mode = p => (fs.statSync(path.join(s.root, p)).mode & 0o777).toString(8);
    assert.strictEqual(s.read('var/www/goldminer/index.html'), fs.readFileSync(path.join(REPO, 'index.html'), 'utf8'));
    assert.strictEqual(mode('var/www/goldminer'), '755'); assert.strictEqual(mode('var/www/goldminer/index.html'), '644');
    for (const f of ['src/server.js', 'src/sim-host.js', 'src/room.js', 'package.json', 'package-lock.json', 'node_modules/ws/index.js']) assert.ok(s.exists('opt/goldminer-online/' + f), f);
    assert.ok(!s.exists('opt/goldminer-online/test'), 'tests are not deployed');
    assert.strictEqual(mode('etc/goldminer-online.env'), '600');
    assert.strictEqual(s.read('etc/goldminer-online.env'), `PORT=8790\nHOST=127.0.0.1\nALLOWED_ORIGINS=https://${DOMAIN}\nGAME_HTML=/var/www/goldminer/index.html\nTRUST_PROXY=1\n`);
    const unit = s.read('etc/systemd/system/goldminer-online.service');
    assert.strictEqual(unit, fs.readFileSync(path.join(DEPLOY, 'goldminer-online.service'), 'utf8')); assert.strictEqual(mode('etc/systemd/system/goldminer-online.service'), '644');
    for (const l of ['User=goldminer', 'EnvironmentFile=/etc/goldminer-online.env', 'ExecStart=/usr/bin/node /opt/goldminer-online/src/server.js', 'Restart=always', 'RestartSec=3', 'NoNewPrivileges=true', 'ProtectSystem=strict', 'ProtectHome=true', 'PrivateTmp=true', 'MemoryMax=256M'])
      assert.ok(unit.split('\n').includes(l), 'unit: ' + l);
    const site = s.read('etc/caddy/goldminer.caddy');
    assert.ok(site.startsWith('# 黄金矿工联机版 —— 由 deploy-online.sh 生成'));
    assert.ok(site.includes(`${DOMAIN} {`) && site.includes('reverse_proxy 127.0.0.1:8790') && site.includes('root * /var/www/goldminer'));
    assert.ok(!/^\s*log\b/m.test(site));
    assert.strictEqual(s.read('etc/caddy/Caddyfile'), USER_CADDYFILE + `${MARK_BEGIN}\nimport /etc/caddy/goldminer.caddy\n${MARK_END}\n`);
    const bak = fs.readdirSync(path.join(s.root, 'etc/caddy')).filter(f => f.startsWith('Caddyfile.bak-goldminer-'));
    assert.strictEqual(bak.length, 1); assert.strictEqual(s.read('etc/caddy/' + bak[0]), USER_CADDYFILE);
    const c = r.calls.join('\n');
    assert.match(c, /^useradd --system --shell \/usr\/sbin\/nologin .*goldminer$/m);
    assert.match(c, /^npm ci --omit=dev/m);
    for (const re of [/^systemctl daemon-reload/m, /^systemctl enable goldminer-online/m, /^systemctl restart goldminer-online/m, /^systemctl reload caddy/m, /^caddy validate --config .*Caddyfile --adapter caddyfile/m])
      assert.match(c, re);
    assert.ok(c.indexOf('curl -fsS --max-time 2 http://127.0.0.1:8790/online/health') < c.indexOf('systemctl reload caddy'), 'service health before Caddy is touched');
    assert.match(c, new RegExp(`curl -fsS --max-time 10 https://${DOMAIN.replace(/\./g, '\\.')}/online/health`));
    console.log(`# O-40① exit 0; index.html 644 in a 755 dir, env 600 (5 lines), unit == template (644), site file rendered, Caddyfile == original + 3 lines, 1 backup == original; ${r.calls.length} fake calls`);
  } finally { s.cleanup(); }
});

test('O-40 ② original Caddyfile invalid -> exit != 0, nothing changed, no systemctl call', () => {
  const s = sandbox({ flags: ['validate-orig-fail'] });
  try {
    const h0 = treeHash(s.root);
    const r = deploy(s);
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /本身没有通过 caddy validate/);
    assert.strictEqual(treeHash(s.root), h0);
    assert.ok(!r.calls.some(l => l.startsWith('systemctl')), r.calls.join('\n'));
    console.log(`# O-40② exit ${r.status}, tree hash unchanged, systemctl calls: 0`);
  } finally { s.cleanup(); }
});

test('O-40 ③ validate fails after the append -> Caddyfile restored byte for byte, goldminer.caddy removed', () => {
  const s = sandbox({ flags: ['validate-import-fail'] });
  try {
    const r = deploy(s);
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /追加后 caddy validate 没有通过/);
    assert.strictEqual(s.read('etc/caddy/Caddyfile'), USER_CADDYFILE);
    assert.ok(!s.exists('etc/caddy/goldminer.caddy'));
    assert.ok(!r.calls.some(l => l.startsWith('systemctl reload caddy')));
    console.log(`# O-40③ exit ${r.status}; Caddyfile identical to the original; goldminer.caddy removed; no reload`);
  } finally { s.cleanup(); }
});

test('O-40 ④ reload fails -> restored and reloaded again, exit != 0', () => {
  const s = sandbox({ flags: ['reload-fail'] });
  try {
    const r = deploy(s);
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /reload caddy 失败/);
    assert.strictEqual(s.read('etc/caddy/Caddyfile'), USER_CADDYFILE);
    assert.ok(!s.exists('etc/caddy/goldminer.caddy'));
    assert.strictEqual(r.calls.filter(l => l.startsWith('systemctl reload caddy')).length, 2);
    console.log(`# O-40④ exit ${r.status}; Caddyfile restored; systemctl reload caddy called twice (try + after restore)`);
  } finally { s.cleanup(); }
});

test('O-40 ⑤ existing site unreachable after the reload -> restored automatically and reloaded', () => {
  const s = sandbox({ flags: ['break-existing'] });
  try {
    const r = deploy(s);
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /变得不可访问,已自动还原/);
    assert.strictEqual(s.read('etc/caddy/Caddyfile'), USER_CADDYFILE);
    assert.strictEqual(r.calls.filter(l => l.startsWith('systemctl reload caddy')).length, 2);
    assert.ok(r.calls.filter(l => /^curl .*https:\/\/43\.161\.221\.249\.sslip\.io\/$/.test(l)).length >= 2, 'existing site probed before and after');
    console.log(`# O-40⑤ exit ${r.status}; existing site 200 -> 502 after reload: Caddyfile restored + second reload`);
  } finally { s.cleanup(); }
});

test('O-40 ⑥ port taken by another program -> exit, no change; forbidden ports rejected', () => {
  const s = sandbox();
  try {
    fs.writeFileSync(path.join(s.root, '.fake/ss-listen'), 'LISTEN 0 511 127.0.0.1:8790 0.0.0.0:*\n');
    const h0 = treeHash(s.root);
    const r = deploy(s);
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /端口 8790 已被其他程序占用/);
    assert.strictEqual(treeHash(s.root), h0);
    const refused = [];
    for (const p of ['8787', '22', '80', '443', '2019']) { const x = deploy(s, ['--port', p]); assert.strictEqual(x.status, 2, p); assert.match(x.stderr, /不能使用/); refused.push(p); }
    assert.strictEqual(treeHash(s.root), h0);
    console.log(`# O-40⑥ busy 8790 -> exit ${r.status}, tree unchanged; --port ${refused.join('/')} -> exit 2 each`);
  } finally { s.cleanup(); }
});

test('O-40 ⑦ second run: still one import line, env file kept', () => {
  const s = sandbox();
  try {
    assert.strictEqual(deploy(s).status, 0);
    const envPath = path.join(s.root, 'etc/goldminer-online.env');
    fs.appendFileSync(envPath, '# edited by the user\n');
    const r2 = deploy(s);
    assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
    const cf = s.read('etc/caddy/Caddyfile');
    assert.strictEqual(cf.split('\n').filter(l => l === 'import /etc/caddy/goldminer.caddy').length, 1);
    assert.strictEqual(cf, USER_CADDYFILE + `${MARK_BEGIN}\nimport /etc/caddy/goldminer.caddy\n${MARK_END}\n`);
    assert.ok(fs.readFileSync(envPath, 'utf8').endsWith('# edited by the user\n'));
    console.log('# O-40⑦ second run exit 0: 1 import line, Caddyfile unchanged, env file kept (user edit preserved)');
  } finally { s.cleanup(); }
});

test('O-40 ⑧ ⑨ no trailing newline: import on its own line; uninstall restores the exact bytes; --purge', () => {
  for (const original of [USER_CADDYFILE, USER_CADDYFILE.replace(/\n$/, '')]) {
    const s = sandbox({ caddyfile: original });
    try {
      assert.strictEqual(deploy(s).status, 0);
      const cf = s.read('etc/caddy/Caddyfile');
      assert.ok(cf.includes('}\n' + MARK_BEGIN + '\nimport /etc/caddy/goldminer.caddy\n' + MARK_END + '\n'), JSON.stringify(cf));
      const u = record(s.run('uninstall-online.sh'));
      assert.strictEqual(u.status, 0, u.stdout + u.stderr);
      assert.strictEqual(s.read('etc/caddy/Caddyfile'), original, 'byte-identical after uninstall');
      assert.ok(!s.exists('etc/systemd/system/goldminer-online.service') && !s.exists('etc/caddy/goldminer.caddy'));
      assert.ok(s.exists('opt/goldminer-online') && s.exists('var/www/goldminer/index.html') && s.exists('etc/goldminer-online.env'), 'kept without --purge');
      assert.ok(u.calls.includes('systemctl stop goldminer-online') && u.calls.includes('systemctl disable goldminer-online') && u.calls.includes('systemctl reload caddy'));
      const p = record(s.run('uninstall-online.sh', ['--purge']));
      assert.strictEqual(p.status, 0, p.stdout + p.stderr);
      assert.ok(!s.exists('opt/goldminer-online') && !s.exists('var/www/goldminer') && !s.exists('etc/goldminer-online.env'));
      assert.ok(p.calls.includes('userdel goldminer'));
      assert.strictEqual(s.read('etc/caddy/Caddyfile'), original);
    } finally { s.cleanup(); }
  }
  // another goldminer service (the leaderboard) present: --purge keeps the shared page directory and the user
  const s = sandbox();
  try {
    assert.strictEqual(deploy(s).status, 0);
    fs.writeFileSync(path.join(s.root, 'etc/systemd/system/goldminer.service'), '[Unit]\n');
    const p = record(s.run('uninstall-online.sh', ['--purge']));
    assert.strictEqual(p.status, 0);
    assert.ok(s.exists('var/www/goldminer/index.html') && !p.calls.includes('userdel goldminer') && !s.exists('opt/goldminer-online'));
  } finally { s.cleanup(); }
  console.log('# O-40⑧⑨ with and without a final newline: import on its own line, uninstall -> Caddyfile byte-identical, unit + site removed; --purge removes program, page, env, user (kept when another goldminer service exists)');
});

test('O-40 ⑩ --dry-run of all three scripts changes nothing', () => {
  const s = sandbox();
  try {
    const h0 = treeHash(s.root);
    for (const [script, args] of [['deploy-online.sh', ['--domain', DOMAIN, '--dry-run']], ['update-online.sh', ['--dry-run']], ['uninstall-online.sh', ['--dry-run', '--purge']]]) {
      const r = record(s.run(script, args)); assert.strictEqual(r.status, 0, script + r.stderr); assert.match(r.stdout, /试运行/);
    }
    assert.strictEqual(treeHash(s.root), h0);
    assert.strictEqual(deploy(s).status, 0);                                   // and once installed
    const h1 = treeHash(s.root);
    for (const [script, args] of [['deploy-online.sh', ['--domain', DOMAIN, '--dry-run']], ['update-online.sh', ['--dry-run']], ['uninstall-online.sh', ['--dry-run', '--purge']]]) {
      const r = record(s.run(script, args)); assert.strictEqual(r.status, 0, script + r.stderr);
    }
    assert.strictEqual(treeHash(s.root), h1);
    console.log('# O-40⑩ deploy/update/uninstall --dry-run before and after an install: sandbox tree hash unchanged');
  } finally { s.cleanup(); }
});

test('update-online.sh refuses while games are running unless --force', () => {
  const s = sandbox();
  try {
    assert.strictEqual(deploy(s).status, 0);
    fs.writeFileSync(path.join(s.root, '.fake/games'), '1');
    const r = record(s.run('update-online.sh'));
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /正在进行/);
    assert.ok(!r.calls.some(l => l.startsWith('systemctl restart')));
    const f = record(s.run('update-online.sh', ['--force']));
    assert.strictEqual(f.status, 0, f.stdout + f.stderr);
    assert.ok(f.calls.includes('systemctl restart goldminer-online'));
    console.log('# update-online.sh: games=1 -> refused (no restart); --force -> restarted');
  } finally { s.cleanup(); }
});

// ---------------------------------------------------------------- O-42 (runs after the scenarios above: same process, sequential)
test('O-42 forbidden actions never happen in any scenario', () => {
  assert.ok(allCalls.length > 100, 'calls recorded: ' + allCalls.length);
  const bad = allCalls.filter(l => /^(apt-get|apt|nginx|certbot|ufw|kill|pkill|killall|n|nvm) /.test(l) || /^systemctl (restart|stop|start) caddy/.test(l) || /^npm (install|i) -g|node(source)?.*setup/.test(l));
  assert.deepStrictEqual(bad, []);
  const port8787 = allCalls.filter(l => l.includes('8787'));
  assert.deepStrictEqual(port8787, []);
  console.log(`# O-42 ${allCalls.length} fake calls over all scenarios: apt-get/nginx/certbot/ufw/kill/pkill/caddy restart|stop/Node installs: 0; calls mentioning 8787: 0 (8787 only appears in the forbidden-port message); Caddyfile diff = 3 appended lines (checked in ①)`);
});

// ---------------------------------------------------------------- O-41 real Caddy
function findCaddy() {
  if (process.env.CADDY_BIN && fs.existsSync(process.env.CADDY_BIN)) return process.env.CADDY_BIN;
  if (have('caddy') && !String(sh('sh', ['-c', 'command -v caddy']).stdout).includes('gm-deploy-')) return 'caddy';
  const dir = path.join(os.tmpdir(), 'goldminer-caddy-2.8.4'), bin = path.join(dir, 'caddy');
  if (fs.existsSync(bin)) return bin;
  // official static release, verified against the published SHA-512
  fs.mkdirSync(dir, { recursive: true });
  const base = 'https://github.com/caddyserver/caddy/releases/download/v2.8.4/';
  const tgz = path.join(dir, 'caddy.tgz');
  if (sh('curl', ['-sSLf', '--max-time', '120', '-o', tgz, base + 'caddy_2.8.4_linux_amd64.tar.gz']).status !== 0) return null;
  const sums = sh('curl', ['-sSLf', '--max-time', '30', base + 'caddy_2.8.4_checksums.txt']).stdout || '';
  const want = (sums.split('\n').find(l => l.endsWith('caddy_2.8.4_linux_amd64.tar.gz')) || '').split(/\s+/)[0];
  const got = crypto.createHash('sha512').update(fs.readFileSync(tgz)).digest('hex');
  if (!want || want !== got) return null;
  if (sh('tar', ['-xzf', tgz, '-C', dir, 'caddy']).status !== 0) return null;
  return bin;
}
test('O-41 real caddy: validate passes; existing host routes identical before/after; /online/* -> 127.0.0.1:8790; no log', t => {
  const caddy = findCaddy();
  if (!caddy) return t.skip('no caddy binary (CADDY_BIN, PATH or download of the official 2.8.4 release failed)');
  const ver = sh(caddy, ['version']).stdout.trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-caddy-'));
  try {
    const site = fs.readFileSync(path.join(DEPLOY, 'goldminer.caddy.tpl'), 'utf8').replaceAll('__DOMAIN__', DOMAIN).replaceAll('__PORT__', '8790');
    fs.writeFileSync(path.join(dir, 'goldminer.caddy'), site);
    const before = path.join(dir, 'Caddyfile.before'), after = path.join(dir, 'Caddyfile');
    fs.writeFileSync(before, USER_CADDYFILE);
    // the import line as deploy-online.sh writes it, pointing at the rendered site file in this temp dir instead of /etc/caddy
    fs.writeFileSync(after, USER_CADDYFILE + `${MARK_BEGIN}\nimport ${path.join(dir, 'goldminer.caddy')}\n${MARK_END}\n`);
    const env = Object.assign({}, process.env, { HOME: dir, XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir });
    const v = sh(caddy, ['validate', '--config', after, '--adapter', 'caddyfile'], { env });
    assert.strictEqual(v.status, 0, v.stdout + v.stderr);
    const adapt = f => { const r = sh(caddy, ['adapt', '--config', f, '--adapter', 'caddyfile'], { env }); assert.strictEqual(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
    const jb = adapt(before), ja = adapt(after);
    const routesFor = (j, host) => { const out = []; for (const s of Object.values(j.apps.http.servers)) for (const r of s.routes || []) if ((r.match || []).some(m => (m.host || []).includes(host))) out.push(r); return out; };
    const old0 = routesFor(jb, '43.161.221.249.sslip.io'), old1 = routesFor(ja, '43.161.221.249.sslip.io');
    assert.ok(old0.length >= 1); assert.strictEqual(JSON.stringify(old1), JSON.stringify(old0));
    const mine = JSON.stringify(routesFor(ja, DOMAIN));
    assert.ok(mine.includes('"/online/*"') && mine.includes('"dial":"127.0.0.1:8790"'), mine);
    assert.ok(!/"logs"|"logging"|"log"/.test(JSON.stringify(ja)), 'no log configuration');
    console.log(`# O-41 ${ver}: caddy validate of user Caddyfile + import + rendered template: OK; adapt: routes of 43.161.221.249.sslip.io identical before/after (${JSON.stringify(old0).length} bytes JSON); ${DOMAIN} handles /online/* -> 127.0.0.1:8790; no log settings`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- O-43 / O-44 / O-45
test('O-43 bash -n and shellcheck -S warning for deploy/*.sh; D-01..D-05 still pass', t => {
  const scripts = fs.readdirSync(DEPLOY).filter(f => f.endsWith('.sh'));
  for (const f of scripts) { const r = sh('bash', ['-n', path.join(DEPLOY, f)]); assert.strictEqual(r.status, 0, f + r.stderr); }
  let sc = 'shellcheck not available';
  if (have('shellcheck')) {
    for (const f of scripts) { const r = sh('shellcheck', ['-S', 'warning', path.join(DEPLOY, f)]); assert.strictEqual(r.status, 0, f + '\n' + r.stdout); }
    sc = sh('shellcheck', ['--version']).stdout.split('\n').find(l => l.startsWith('version')) || 'shellcheck';
  }
  const server = path.join(REPO, 'server');
  if (!fs.existsSync(path.join(server, 'node_modules', 'better-sqlite3'))) sh('npm', ['ci', '--no-audit', '--no-fund'], { cwd: server });
  const env = Object.assign({}, process.env); delete env.NODE_TEST_CONTEXT;  // a nested node --test must report on its own, not to this runner
  const d = sh(process.execPath, ['--test', '--test-reporter=tap', 'test/deploy.test.js'], { cwd: server, timeout: 300000, env });
  const n = k => { const m = new RegExp('^# ' + k + ' (\\d+)', 'm').exec(d.stdout); return m ? +m[1] : -1; };
  assert.strictEqual(d.status, 0, d.stdout.slice(-3000));
  assert.ok(n('pass') >= 10 && n('fail') === 0, 'server deploy tests: ' + d.stdout.slice(-500));
  console.log(`# O-43 ${scripts.length} scripts (${scripts.join(', ')}): bash -n OK; ${sc} -S warning: clean; server/test/deploy.test.js: pass ${n('pass')}, fail ${n('fail')}, skipped ${n('skipped')}`);
  if (!have('shellcheck')) t.diagnostic('shellcheck missing: pip install shellcheck-py');
});

test('O-44 deploy.sh stops before any change when something other than nginx holds 80/443', () => {
  const s = sandbox();
  try {
    fs.writeFileSync(path.join(s.root, '.fake/ss-listen'), 'LISTEN 0 4096 *:443 *:* users:(("caddy",pid=811,fd=7))\nLISTEN 0 4096 *:80 *:* users:(("caddy",pid=811,fd=6))\nLISTEN 0 511 127.0.0.1:8787 0.0.0.0:* users:(("node",pid=900,fd=20))\n');
    const r = s.run('deploy.sh', ['--domain', 'game.example.com', '--email', 'a@b.c']);
    assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /deploy-online\.sh/);
    assert.ok(!r.calls.some(l => /^(apt-get|useradd|systemctl|nginx|certbot|ufw|npm)/.test(l)), r.calls.join('\n'));
    assert.ok(!/==> \[1\/11\]/.test(r.stdout));
    const dr = s.run('deploy.sh', ['--domain', 'game.example.com', '--email', 'a@b.c', '--dry-run']);
    assert.strictEqual(dr.status, 0); assert.match(dr.stdout, /检查 80\/443 是否被 nginx 以外的程序占用: 80 端口\(caddy\) 443 端口\(caddy\)/);
    // nginx on 80/443 is fine for deploy.sh
    fs.writeFileSync(path.join(s.root, '.fake/ss-listen'), 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=1,fd=6))\n');
    const ng = s.run('deploy.sh', ['--domain', 'game.example.com', '--email', 'a@b.c', '--dry-run']);
    assert.match(ng.stdout, /占用: 没有/);
    console.log(`# O-44 fake ss: Caddy on 80/443 -> deploy.sh exit ${r.status} before step 1 (no apt-get/useradd/systemctl/nginx/certbot/ufw calls), message points to deploy-online.sh; --dry-run only prints the check; nginx on 80 -> no conflict`);
  } finally { s.cleanup(); }
});

test('O-45 DEPLOY-online.md: 9 sections, the sslip.io address, custom-domain option, "两人都需要用电脑", no secrets', () => {
  const md = fs.readFileSync(path.join(DEPLOY, 'DEPLOY-online.md'), 'utf8');
  const heads = (md.match(/^## \d+\. .*/gm) || []);
  assert.strictEqual(heads.length, 9, heads.join('\n'));
  const need = [
    // 1 what it does / does not do
    '不会做什么', '8787', 'sudo ss -ltnp | grep 8787', 'ps -o user,cmd -p', 'ufw', 'nginx', 'certbot', 'apt-get',
    // 2 address
    'goldminer.43.161.221.249.sslip.io', 'nslookup goldminer.43.161.221.249.sslip.io', 'A 记录', '43.161.221.249',
    // 3 firewall
    '不需要新开任何端口', '8790',
    // 4 upload + dry-run
    'git clone', 'scp ', 'sudo bash deploy/deploy-online.sh --domain goldminer.43.161.221.249.sslip.io --dry-run', 'sudo bash deploy/deploy-online.sh --domain goldminer.43.161.221.249.sslip.io',
    // 5 verify
    'curl https://goldminer.43.161.221.249.sslip.io/online/health', '原来的站点',
    // 6 itdog
    'itdog.cn',
    // 7 how to play together
    '两人都需要用电脑', '复制邀请链接', '在默认浏览器打开', '联机对战需在电脑上进行',
    // 8 commands
    'update-online.sh', 'uninstall-online.sh', '--purge', 'journalctl -u goldminer-online', 'systemctl restart goldminer-online',
    // 9 FAQ
    '证书', 'Let\'s Encrypt', 'ZeroSSL', '游戏已更新', '代理', 'Caddyfile.bak-goldminer-',
  ];
  const missing = need.filter(k => !md.includes(k));
  assert.deepStrictEqual(missing, []);
  assert.ok(!/(password|passwd|token|secret|密码)\s*[:=]\s*\S{6,}/i.test(md), 'looks like a secret');
  assert.ok(!/[A-Za-z0-9_-]{40,}/.test(md.replace(/https?:\/\/\S+/g, '')), 'long random-looking string');
  for (const f of ['deploy-online.sh', 'update-online.sh', 'uninstall-online.sh', 'goldminer-online.service', 'goldminer.caddy.tpl']) assert.ok(fs.existsSync(path.join(DEPLOY, f)), f);
  console.log(`# O-45 ${heads.length} sections: ${heads.map(h => h.replace(/^## /, '')).join(' | ')}; ${need.length} required phrases present; no secrets`);
});
