'use strict';
// S-09 备份
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const Database = require('better-sqlite3');
const { startServer, insertRows, ROOT, tmpDir } = require('./helpers');

const DAY = 86400_000;
const backupJs = path.join(ROOT, 'scripts/backup.js');
const runBackup = (args, env = {}) =>
  new Promise((res) => {
    const c = cp.spawn(process.execPath, [backupJs, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('exit', (code) => res({ code, out, err }));
  });

test('S-09 一边持续写入一边备份:备份可打开、integrity_check=ok、行数 >= 开始时', async (t) => {
  const s = await startServer();
  t.after(s.cleanup);
  insertRows(s.app.db, Array.from({ length: 5000 }, (_, i) => ({ score: i, name: '矿工' + i })));
  await s.close(); // 释放服务;写入由独立进程完成,模拟线上"服务一直在写"
  const out = path.join(s.dir, 'bk');

  // 独立写入进程:不停写入直到被告知停止
  const writer = cp.spawn(process.execPath, ['-e', `
    const D=require(${JSON.stringify(require.resolve('better-sqlite3'))});
    const db=new D(process.argv[1]); db.pragma('journal_mode=WAL'); db.pragma('busy_timeout=5000');
    const ins=db.prepare("INSERT INTO scores(mode,name,score,rounds,character,created_at,version) VALUES('versus','写入线程',?,1,'laojin',?,2)");
    let n=0; process.stdout.write('ready\\n');
    const tick=()=>{ for(let i=0;i<20;i++){ins.run(n++,Date.now());} process.stdout.write('w '+n+'\\n'); setImmediate(tick); };
    tick();
  `, s.cfg.dbPath], { stdio: ['ignore', 'pipe', 'inherit'] });
  let written = 0;
  writer.stdout.on('data', (d) => { const m = String(d).match(/w (\d+)/g); if (m) written = Number(m[m.length - 1].slice(2)); });
  t.after(() => writer.kill('SIGKILL'));
  await new Promise((r) => setTimeout(r, 300));
  const before = new Database(s.cfg.dbPath, { readonly: true }).prepare('SELECT COUNT(*) c FROM scores').get().c;
  assert.ok(before >= 5000);

  const results = [];
  for (let i = 0; i < 3; i++) {
    const now = Date.now() + i * 2000; // 文件名按 --now 的秒数区分
    const r = await runBackup(['--db', s.cfg.dbPath, '--out', out, '--now', String(now)]);
    assert.equal(r.code, 0, r.err + r.out);
    results.push(r);
  }
  const writtenAfter = written;
  writer.kill('SIGKILL');
  assert.ok(writtenAfter > 0, '备份期间写入持续进行');

  const files = fs.readdirSync(out).filter((f) => /^scores-\d{8}-\d{6}.*\.db$/.test(f));
  assert.equal(files.length, 3);
  for (const f of files) {
    const b = new Database(path.join(out, f), { readonly: true });
    assert.equal(b.pragma('integrity_check', { simple: true }), 'ok');
    const n = b.prepare('SELECT COUNT(*) c FROM scores').get().c;
    assert.ok(n >= before, `${f}: ${n} >= ${before}`);
    b.close();
  }
  const rows = results.map((r) => Number(/\((\d+) 行/.exec(r.out)[1]));
  console.log(`    S-09: 开始时 ${before} 行,备份期间写入线程累计 ${writtenAfter} 行,3 个备份的行数 = ${rows.join(', ')},integrity_check 全部 ok`);
});

test('S-09 保留期:--now 模拟,31 天前的备份被删除,29 天前的保留;其它文件不动', async (t) => {
  const s = await startServer();
  t.after(s.cleanup);
  await s.close();
  const out = path.join(s.dir, 'bk');
  fs.mkdirSync(out);
  const now = Date.parse('2026-06-15T03:17:00Z');
  const mk = (name, ageDays) => {
    const p = path.join(out, name);
    fs.writeFileSync(p, 'x');
    fs.utimesSync(p, new Date(now - ageDays * DAY), new Date(now - ageDays * DAY));
  };
  mk('scores-20260514-031700.db', 31);
  mk('scores-20260516-031700.db', 29);
  mk('scores-20260101-000000.db', 165);
  mk('archive-solo-v1-20260101-000000.json', 165); // 归档文件不是备份,不受保留期影响
  mk('notes.txt', 400);
  const r = await runBackup(['--db', s.cfg.dbPath, '--out', out, '--keep-days', '30', '--now', new Date(now).toISOString()]);
  assert.equal(r.code, 0, r.err);
  const left = fs.readdirSync(out).sort();
  assert.ok(!left.includes('scores-20260514-031700.db'), '31 天前应删除');
  assert.ok(!left.includes('scores-20260101-000000.db'));
  assert.ok(left.includes('scores-20260516-031700.db'), '29 天前应保留');
  assert.ok(left.includes('scores-20260615-031700.db'), '新备份文件名来自 --now (UTC)');
  assert.ok(left.includes('notes.txt'));
  assert.ok(left.includes('archive-solo-v1-20260101-000000.json'));
  // 再前进 3 天:29 天前的那个变成 32 天
  const r2 = await runBackup(['--db', s.cfg.dbPath, '--out', out, '--keep-days', '30', '--now', String(now + 3 * DAY)]);
  assert.equal(r2.code, 0, r2.err);
  assert.ok(!fs.readdirSync(out).includes('scores-20260516-031700.db'));
});

test('备份失败(数据库不存在)-> 退出码非 0;OFFSITE_CMD 成功/失败都不影响本地备份', async (t) => {
  const s = await startServer();
  t.after(s.cleanup);
  await s.close();
  const out = path.join(s.dir, 'bk');
  const bad = await runBackup(['--db', path.join(s.dir, 'nope.db'), '--out', out]);
  assert.notEqual(bad.code, 0);
  const side = path.join(s.dir, 'offsite');
  fs.mkdirSync(side);
  const ok = await runBackup(['--db', s.cfg.dbPath, '--out', out], { OFFSITE_CMD: `cp {file} ${side}/` });
  assert.equal(ok.code, 0, ok.err);
  assert.equal(fs.readdirSync(side).length, 1, '异地命令被执行,{file} 被替换');
  const failing = await runBackup(['--db', s.cfg.dbPath, '--out', out, '--now', String(Date.now() + 5000)], { OFFSITE_CMD: 'false {file}' });
  assert.equal(failing.code, 0, '异地上传失败只记日志');
  assert.match(failing.out, /异地上传失败/);
  assert.equal(fs.readdirSync(out).filter((f) => f.endsWith('.db')).length, 2);
});

test('备份可恢复:覆盖后能用 server 启动并读到数据', async (t) => {
  const s = await startServer();
  t.after(s.cleanup);
  insertRows(s.app.db, [{ score: 777, name: '恢复测试' }]);
  const out = path.join(s.dir, 'bk');
  assert.equal((await runBackup(['--db', s.cfg.dbPath, '--out', out])).code, 0);
  const bk = fs.readdirSync(out)[0];
  await s.close();
  const dir2 = tmpDir();
  t.after(() => fs.rmSync(dir2, { recursive: true, force: true }));
  fs.copyFileSync(path.join(out, bk), path.join(dir2, 'scores.db'));
  const s2 = await startServer({ dir: dir2 });
  t.after(() => s2.app.close());
  assert.equal((await s2.top('solo'))[0].name, '恢复测试');
});
