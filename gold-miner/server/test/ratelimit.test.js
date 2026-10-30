'use strict';
// S-07 限流 + 多进程竞争(BEGIN IMMEDIATE)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cp = require('node:child_process');
const { startServer, valid, insertRows, ROOT } = require('./helpers');
const { RateLimiter } = require('../src/ratelimit');

test('S-07 同一 IP 60 秒内第 6 次 POST -> 429 + Retry-After;注入时钟 +61s 后恢复;GET 不受影响', async (t) => {
  const clock = { t: 1_800_000_000_000, now() { return this.t; } };
  const s = await startServer({ clock });
  t.after(s.cleanup);
  const ip = '203.0.113.7';
  for (let i = 1; i <= 5; i++) {
    const r = await s.post(valid({ score: i }), { ip });
    assert.equal(r.status, 201, 'post #' + i);
  }
  const r6 = await s.post(valid({ score: 6 }), { ip });
  assert.equal(r6.status, 429);
  assert.deepEqual(r6.json, { ok: false, error: 'rate_limited' });
  assert.ok(Number(r6.headers.get('retry-after')) >= 1);
  console.log(`    S-07: 第 6 次 -> 429, Retry-After=${r6.headers.get('retry-after')}`);
  // 非法请求也计数(同一 IP 的垃圾请求同样被限)
  assert.equal((await s.post({}, { ip })).status, 429);
  // 其它 IP 不受影响
  assert.equal((await s.post(valid({ score: 7 }), { ip: '203.0.113.8' })).status, 201);
  // GET 不受 POST 限流影响
  for (let i = 0; i < 10; i++) assert.equal((await s.get('/api/leaderboard?mode=solo', { ip })).status, 200);
  clock.t += 61_000;
  assert.equal((await s.post(valid({ score: 8 }), { ip })).status, 201, '61 秒后恢复');
});

test('S-07 每小时 30 次上限', async (t) => {
  const clock = { t: 1_800_000_000_000, now() { return this.t; } };
  const s = await startServer({ clock });
  t.after(s.cleanup);
  const ip = '203.0.113.9';
  for (let i = 0; i < 30; i++) {
    if (i && i % 5 === 0) clock.t += 61_000;
    assert.equal((await s.post(valid({ score: i + 1 }), { ip })).status, 201, '#' + i);
  }
  clock.t += 61_000;
  const r = await s.post(valid({ score: 99 }), { ip });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 60, '小时限额的 Retry-After 应远大于 60: ' + r.headers.get('retry-after'));
  clock.t += 3_600_000;
  assert.equal((await s.post(valid({ score: 100 }), { ip })).status, 201);
});

test('S-07 GET 每 60 秒 120 次', async (t) => {
  const clock = { t: 1_800_000_000_000, now() { return this.t; } };
  const s = await startServer({ clock });
  t.after(s.cleanup);
  const ip = '203.0.113.10';
  for (let i = 0; i < 120; i++) assert.equal((await s.get('/api/leaderboard?mode=solo', { ip })).status, 200);
  const r = await s.get('/api/leaderboard?mode=solo', { ip });
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  clock.t += 61_000;
  assert.equal((await s.get('/api/leaderboard?mode=solo', { ip })).status, 200);
});

test('RateLimiter 单元:注入时钟,被拒绝的请求不计数', () => {
  let now = 0;
  const rl = new RateLimiter([{ windowMs: 1000, max: 2 }], () => now);
  assert.ok(rl.take('a').ok);
  assert.ok(rl.take('a').ok);
  const x = rl.take('a');
  assert.equal(x.ok, false);
  assert.equal(x.retryAfter, 1);
  now = 1001;
  assert.ok(rl.take('a').ok);
});

test('竞争:多个独立进程(含管理 CLI 同类写入路径)与 HTTP 同时写同一数据库,BEGIN IMMEDIATE 保证结果一致', async (t) => {
  const s = await startServer();
  t.after(s.cleanup);
  insertRows(s.app.db, Array.from({ length: 20 }, (_, i) => ({ score: 1000 + i * 50 })));
  const dbPath = s.cfg.dbPath;
  // 4 个子进程各提交 25 个分数(直接走 db.js 的入榜事务)
  const code = `
    const {openDb,makeQueries}=require(${JSON.stringify(path.join(ROOT, 'src/db.js'))});
    const db=openDb(process.argv[1],${JSON.stringify(path.join(ROOT, 'migrations'))});
    const q=makeQueries(db); const base=Number(process.argv[2]); let ok=0;
    for(let i=0;i<25;i++){const r=q.submit({mode:'solo',name:'W'+base+'_'+i,score:base+i*7,rounds:1,character:'laojin',version:2},Date.now()); if(r.ok) ok++;}
    console.log(ok);`;
  const kids = [0, 1, 2, 3].map(
    (k) =>
      new Promise((res, rej) => {
        const c = cp.spawn(process.execPath, ['-e', code, dbPath, String(900 + k * 3)], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        c.stdout.on('data', (d) => (out += d));
        c.on('exit', (cd) => (cd === 0 ? res(Number(out.trim())) : rej(new Error('child exit ' + cd))));
      })
  );
  const http = Promise.all(Array.from({ length: 25 }, (_, i) => s.post(valid({ score: 905 + i * 11, name: 'H' + i }))));
  const [okCounts, httpRes] = [await Promise.all(kids), await http];
  const httpOk = httpRes.filter((r) => r.status === 201).length;
  const total = okCounts.reduce((a, b) => a + b, 0) + httpOk;
  assert.equal(s.count('solo'), 20 + total, '成功数 = 写入行数');
  const all = s.app.db.prepare('SELECT score FROM scores').all().map((r) => r.score);
  const top = (await s.top('solo')).map((e) => e.score);
  assert.deepEqual(top, [...all].sort((a, b) => b - a).slice(0, 20));
  const ids = s.app.db.prepare('SELECT id FROM scores').all();
  assert.equal(new Set(ids.map((r) => r.id)).size, ids.length);
  console.log(`    多进程竞争: 4 子进程 + HTTP, 共 ${total} 次成功写入,前 20 一致`);
});

test('RateLimiter 扩展性:20 万个键时单次检查 < 0.1ms,键数有界;peek 不计数', () => {
  let now = 1_000_000;
  const rl = new RateLimiter([{ windowMs: 60_000, max: 5 }], () => now);
  const N = 200_000;
  const mem0 = process.memoryUsage().heapUsed;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    if (i % 1000 === 0) now += 1000; // 时间缓慢前进,触发有界的清扫
    rl.take('ip' + i);
  }
  const perMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  const memMb = (process.memoryUsage().heapUsed - mem0) / 1048576;
  console.log(`    限流器: ${N} 个键, 每次 ${(perMs * 1000).toFixed(2)} us, 键数=${rl.hits.size}, 堆增长约 ${memMb.toFixed(1)} MB`);
  assert.ok(perMs < 0.1, 'per call ms=' + perMs);
  assert.ok(rl.hits.size <= 50000);
  assert.ok(memMb < 60);
  // peek 不计数
  const r2 = new RateLimiter([{ windowMs: 1000, max: 1 }], () => now);
  for (let i = 0; i < 5; i++) assert.ok(r2.peek('x').ok);
  assert.ok(r2.take('x').ok);
  assert.equal(r2.peek('x').ok, false);
});
