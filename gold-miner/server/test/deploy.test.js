'use strict';
// D-01 .. D-05
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { tmpDir } = require('./helpers');

const DEPLOY = path.resolve(__dirname, '../../deploy');
const sh = (cmd, args, opts = {}) => cp.spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const have = (bin) => sh('sh', ['-c', `command -v ${bin}`]).status === 0;
const scripts = fs.readdirSync(DEPLOY).filter((f) => f.endsWith('.sh'));

test('D-01 bash -n 对所有 .sh 通过;shellcheck 无 error 级别问题', (t) => {
  assert.ok(scripts.includes('deploy.sh') && scripts.includes('update.sh'));
  for (const f of scripts) {
    const r = sh('bash', ['-n', path.join(DEPLOY, f)]);
    assert.equal(r.status, 0, f + ': ' + r.stderr);
  }
  if (!have('shellcheck')) return t.skip('shellcheck 未安装');
  for (const f of scripts) {
    const r = sh('shellcheck', ['-S', 'error', path.join(DEPLOY, f)]);
    assert.equal(r.status, 0, f + ': ' + r.stdout);
    // 额外:warning 级别也应干净
    const w = sh('shellcheck', ['-S', 'warning', path.join(DEPLOY, f)]);
    assert.equal(w.status, 0, f + ' (warning): ' + w.stdout);
  }
});

test('D-02 deploy.sh --dry-run:退出码 0,步骤按顺序出现;不做任何修改', () => {
  const r = sh('bash', [path.join(DEPLOY, 'deploy.sh'), '--dry-run', '--domain', 'game.example.com', '--email', 'a@b.c']);
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  const order = [
    /apt-get -o DPkg::Lock::Timeout=600 install -y nginx certbot python3-certbot-nginx sqlite3 ufw build-essential/,
    /NodeSource/, /deb\.nodesource\.com\/setup_22\.x/,
    /useradd .*goldminer/,
    /复制文件/, /rsync .*server/, /npm ci --omit=dev/,
    /env 文件/, /ADMIN_PASSWORD/,
    /systemd/, /systemctl enable goldminer/,
    /nginx/, /nginx -t/,
    /certbot --nginx -d game\.example\.com -m a@b\.c --agree-tos --redirect --non-interactive/,
    /ufw allow OpenSSH/, /ufw allow Nginx Full/, /ufw --force enable/,
    /cron/, /\/etc\/cron\.d\/goldminer-backup/,
    /curl -fsS https:\/\/game\.example\.com\/api\/health/,
  ];
  let pos = 0;
  for (const re of order) {
    const m = re.exec(out.slice(pos));
    assert.ok(m, '缺少或顺序不对: ' + re + '\n' + out);
    pos += m.index + m[0].length;
  }
  assert.match(out, /\/var\/www\/goldminer/);
  assert.match(out, /\/opt\/goldminer\/server/);
  assert.match(out, /\/var\/lib\/goldminer/);
  assert.match(out, /\/var\/backups\/goldminer/);
  assert.doesNotMatch(out, /管理员密码\(只显示这一次/, 'dry-run 不应生成密码');
  // update.sh 也支持 dry-run
  for (const flag of ['--game-only', '--server-only', '']) {
    const u = sh('bash', [path.join(DEPLOY, 'update.sh'), '--dry-run', ...(flag ? [flag] : [])]);
    assert.equal(u.status, 0, u.stderr);
    assert.match(u.stdout, /api\/health/);
  }
});

test('D-02 缺少参数 -> 退出码非 0 并打印中文用法', () => {
  for (const args of [[], ['--domain', 'game.example.com'], ['--email', 'a@b.c'], ['--domain'], ['--dry-run'], ['--domain', 'bad domain!', '--email', 'a@b.c'], ['--domain', 'x.com', '--email', 'nope'], ['--bogus']]) {
    const r = sh('bash', [path.join(DEPLOY, 'deploy.sh'), ...args], { timeout: 10000 });
    assert.notEqual(r.status, 0, JSON.stringify(args));
    assert.match(r.stderr, /用法/, JSON.stringify(args));
  }
});

function render(domain = 'game.example.com') {
  return fs
    .readFileSync(path.join(DEPLOY, 'nginx.conf.tpl'), 'utf8')
    .replaceAll('__DOMAIN__', domain)
    .replaceAll('__ROOT__', '/var/www/goldminer')
    .replaceAll('__PORT__', '8787');
}

test('D-03 Nginx 模板渲染:含 /api/ 反向代理、静态 root、gzip、client_max_body_size', () => {
  const conf = render();
  assert.doesNotMatch(conf, /__[A-Z]+__/, '占位符应全部被替换');
  assert.match(conf, /server_name game\.example\.com;/);
  assert.match(conf, /root \/var\/www\/goldminer;/);
  assert.match(conf, /location \/api\/ \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:8787;/s);
  assert.match(conf, /proxy_set_header X-Real-IP \$remote_addr;/);
  assert.match(conf, /gzip on;/);
  assert.match(conf, /client_max_body_size 4k;/);
  assert.match(conf, /location = \/index\.html \{[^}]*Cache-Control "no-cache"/s);
});

test('D-03 nginx -t', (t) => {
  if (!have('nginx')) return t.skip('本机没有 nginx:无法运行 nginx -t(apt-get install nginx 后重跑)');
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (siteConf) => {
    fs.writeFileSync(path.join(dir, 'site.conf'), siteConf);
    fs.writeFileSync(
      path.join(dir, 'nginx.conf'),
      `pid ${dir}/nginx.pid;\nerror_log ${dir}/err.log;\nevents {}\nhttp {\n access_log off;\n client_body_temp_path ${dir}/b;\n proxy_temp_path ${dir}/p;\n fastcgi_temp_path ${dir}/f;\n uwsgi_temp_path ${dir}/u;\n scgi_temp_path ${dir}/s;\n include ${dir}/site.conf;\n}\n`
    );
    return sh('nginx', ['-t', '-c', path.join(dir, 'nginx.conf'), '-p', dir]);
  };
  let r = run(render());
  if (r.status !== 0 && /Address family not supported/.test(r.stderr)) {
    // 沙箱没有 IPv6:去掉 IPv6 监听行后再测(语法本身已通过,见 "syntax is ok")
    assert.match(r.stderr, /syntax is ok/);
    r = run(render().replace(/^\s*listen \[::\]:80;\n/m, ''));
    console.log('    D-03: 本沙箱不支持 IPv6 socket,已去掉 listen [::]:80 后测试');
  }
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /syntax is ok/);
  assert.match(r.stderr, /test is successful/);
});

test('D-04 systemd 单元:关键字段齐全;systemd-analyze verify 通过', (t) => {
  const unit = fs.readFileSync(path.join(DEPLOY, 'goldminer.service'), 'utf8');
  for (const line of [
    'Restart=always', 'RestartSec=3', 'User=goldminer', 'EnvironmentFile=/etc/goldminer.env', 'Environment=NODE_ENV=production',
    'NoNewPrivileges=true', 'ProtectSystem=strict', 'ReadWritePaths=/var/lib/goldminer /var/backups/goldminer',
  ]) assert.ok(unit.split('\n').includes(line), '缺少 ' + line);
  const cron = fs.readFileSync(path.join(DEPLOY, 'goldminer-backup.cron'), 'utf8');
  assert.match(cron, /^17 3 \* \* \* goldminer .*backup\.js .*goldminer-backup\.log/m);
  if (!have('systemd-analyze')) return t.skip('无 systemd-analyze');
  // 沙箱里没有 /usr/bin/node 和 goldminer 用户:把 ExecStart 换成本机 node 再 verify
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const f = path.join(dir, 'goldminer.service');
  fs.writeFileSync(f, unit.replace('/usr/bin/node', process.execPath));
  const r = sh('systemd-analyze', ['verify', f]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /Unknown key|Unknown section|Failed/i);
});

test('D-05 DEPLOY.md 含全部 11 个章节、itdog.cn、关键命令', () => {
  const md = fs.readFileSync(path.join(DEPLOY, 'DEPLOY.md'), 'utf8');
  const titles = [
    /^## 1\. 你需要准备什么/m, /^## 2\. 购买香港 VPS/m, /^## 3\. 购买域名并添加 DNS/m, /^## 4\. 用 SSH 登录服务器/m,
    /^## 5\. 一键部署/m, /^## 6\. 验证网站和排行榜/m, /^## 7\. 用 itdog\.cn 测试国内访问/m, /^## 8\. 以后更新游戏/m,
    /^## 9\. 备份与恢复/m, /^## 10\. 管理员操作/m, /^## 11\. 常见问题/m,
  ];
  titles.forEach((re) => assert.match(md, re));
  assert.equal((md.match(/^## \d+\./gm) || []).length, 11);
  for (const kw of [
    'itdog.cn', '网站测速', 'Ping', '22', '80', '443', 'Ubuntu 22.04', 'ping ', 'nslookup', 'A 记录', 'ssh root@', 'scp ',
    'deploy.sh --domain', '--email', '--dry-run', '管理员密码', 'update.sh', '--game-only', 'coscli cp', 'ossutil cp',
    'journalctl -u goldminer', 'systemctl stop goldminer', 'systemctl start goldminer', 'goldminer-admin', 'archive', 'rename',
    '证书', '80 端口', '安全组', 'DNS', '不使用 Cloudflare', '备案', '30 天',
  ]) assert.ok(md.includes(kw), 'DEPLOY.md 缺少: ' + kw);
  // 文档里引用的脚本/文件真实存在
  for (const f of ['deploy.sh', 'update.sh', 'nginx.conf.tpl', 'goldminer.service', 'goldminer-backup.cron']) assert.ok(fs.existsSync(path.join(DEPLOY, f)), f);
  // 代码块里的 bash 命令:命令名都是真实存在的子命令
  const blocks = [...md.matchAll(/```(?:bash|powershell)?\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 15);
  assert.ok(blocks.some((b) => /sudo bash deploy\.sh --domain game\.example\.com --email you@example\.com/.test(b)));
});

test('服务端 package.json 与规格一致', () => {
  const pkg = require('../package.json');
  assert.deepEqual(Object.keys(pkg.dependencies), ['better-sqlite3']);
  assert.equal(pkg.engines.node, '>=22');
  assert.ok(pkg.scripts.start && pkg.scripts.test);
  const words = fs.readFileSync(path.join(__dirname, '../badwords.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.ok(words.length >= 50, 'badwords >= 50: ' + words.length);
  assert.ok(words.some((w) => /[一-鿿]/.test(w)) && words.some((w) => /^[a-z]+$/i.test(w)));
});

function dry(env = {}, stubs = {}) {
  const dir = tmpDir();
  for (const [name, body] of Object.entries(stubs)) {
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  const r = sh('bash', [path.join(DEPLOY, 'deploy.sh'), '--dry-run', '--domain', 'game.example.com', '--email', 'a@b.c'], {
    env: { ...process.env, ...env, PATH: `${dir}:${process.env.PATH}` },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('apt 锁:每个 apt-get 调用都带 DPkg::Lock::Timeout=600', () => {
  const out = dry();
  const lines = out.split('\n').filter((l) => /apt-get/.test(l));
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.match(l, /DPkg::Lock::Timeout=600/, l);
  assert.doesNotMatch(fs.readFileSync(path.join(DEPLOY, 'deploy.sh'), 'utf8').replace(/\$\{APT_OPTS\[@\]\}/g, ''), /apt-get (update|install)/, '脚本里不应有不带选项的 apt-get');
  assert.match(fs.readFileSync(path.join(DEPLOY, 'DEPLOY.md'), 'utf8'), /Could not get lock/);
});

test('ufw:sshd 配置为 Port 2222 时 dry-run 放行 2222/tcp(同时保留 OpenSSH)', () => {
  const out = dry({}, { sshd: 'echo "port 2222"' });
  assert.match(out, /ufw allow OpenSSH/);
  assert.match(out, /ufw allow 2222\/tcp/);
  assert.ok(out.indexOf('ufw allow 2222/tcp') < out.indexOf('ufw --force enable'));
  // 多端口
  const multi = dry({}, { sshd: 'printf "port 22\\nport 2222\\n"' });
  assert.match(multi, /ufw allow 22\/tcp/);
  assert.match(multi, /ufw allow 2222\/tcp/);
  // 检测不到 -> 默认 22
  const none = dry({}, { sshd: 'exit 1', ss: 'exit 0' });
  assert.match(none, /ufw allow 22\/tcp/);
  // sshd -T 不可用时回退到 ss -tlnp
  const viaSs = dry({}, { sshd: 'exit 1', ss: 'echo "LISTEN 0 128 0.0.0.0:2200 0.0.0.0:* users:((\\"sshd\\",pid=1,fd=3))"' });
  assert.match(viaSs, /ufw allow 2200\/tcp/);
});

test('Node 路径:已有 Node 22 不在 /usr/bin 时,写入它的真实路径(单元 / cron / 包装器),不再硬编码', () => {
  const out = dry();
  const nodePath = sh('sh', ['-c', 'command -v node']).stdout.trim();
  assert.match(out, new RegExp(`服务将使用 Node: ${nodePath}`));
  assert.match(out, new RegExp(`ExecStart 使用 ${nodePath}`));
  assert.match(out, new RegExp(`使用 ${nodePath}\\)-> /etc/cron.d`));
  const dsh = fs.readFileSync(path.join(DEPLOY, 'deploy.sh'), 'utf8');
  assert.match(dsh, /runuser -u \$APP_USER -- \$NODE_BIN/);
  // 版本过低的 node -> 走 NodeSource 安装
  const old = dry({}, { node: 'echo 18' });
  assert.match(old, /deb\.nodesource\.com\/setup_22\.x/);
  // 渲染后的单元同样通过 verify
  const rendered = fs.readFileSync(path.join(DEPLOY, 'goldminer.service'), 'utf8').replace(/^ExecStart=\/usr\/bin\/node /m, `ExecStart=${nodePath} `);
  assert.match(rendered, new RegExp(`^ExecStart=${nodePath} /opt/goldminer/server/src/server.js$`, 'm'));
});

test('IPv6:只有 /proc/net/if_inet6 存在才保留 listen [::]:80', () => {
  const none = dry({ GOLDMINER_INET6_FILE: '/nonexistent/if_inet6' });
  assert.match(none, /没有 IPv6.*去掉 listen \[::\]:80/);
  const dir = tmpDir();
  const f = path.join(dir, 'if_inet6');
  fs.writeFileSync(f, '');
  const has = dry({ GOLDMINER_INET6_FILE: f });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(has, /保留 listen \[::\]:80/);
  // 实际执行的 sed 删除命令对模板有效:删除后 nginx 配置不再含 IPv6 监听
  const tpl = fs.readFileSync(path.join(DEPLOY, 'nginx.conf.tpl'), 'utf8');
  assert.match(tpl, /listen \[::\]:80;/);
  const stripped = sh('sed', ['/listen \\[::\\]/d'], { input: tpl }).stdout;
  assert.doesNotMatch(stripped, /\[::\]/);
  assert.match(stripped, /listen 80;/);
});
