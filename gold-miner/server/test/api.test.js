'use strict';
// S-01 .. S-06, S-10, S-11 以及 CORS / 路由
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cp = require('node:child_process');
const { startServer, valid, insertRows, freePort, mulberry, ROOT } = require('./helpers');

describe('S-01 读取榜单', () => {
  test('100 条 -> 返回 20 条,顺序 score DESC, created_at ASC, id ASC;p95 < 50ms', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    const rows = [];
    for (let i = 0; i < 100; i++) rows.push({ score: (i * 37) % 23 * 100, created_at: 1_700_000_000_000 + ((i * 7) % 13) });
    insertRows(s.app.db, rows);
    const r = await s.get('/api/leaderboard?mode=solo');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^application\/json; charset=utf-8$/);
    assert.equal(r.json.mode, 'solo');
    assert.equal(r.json.entries.length, 20);
    const expected = s.app.db.prepare('SELECT * FROM scores WHERE mode=? ORDER BY score DESC, created_at ASC, id ASC LIMIT 20').all('solo');
    assert.deepEqual(r.json.entries.map((e) => e.id), expected.map((e) => e.id));
    r.json.entries.forEach((e, i) => assert.equal(e.rank, i + 1));
    for (const k of ['rank', 'name', 'score', 'rounds', 'character', 'created_at', 'version']) assert.ok(k in r.json.entries[0], k);
    // 手工校验顺序
    for (let i = 1; i < 20; i++) {
      const a = r.json.entries[i - 1], b = r.json.entries[i];
      assert.ok(a.score > b.score || (a.score === b.score && (a.created_at < b.created_at || (a.created_at === b.created_at && a.id < b.id))));
    }
    const times = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      const x = await s.get('/api/leaderboard?mode=solo');
      times.push(performance.now() - t0);
      assert.equal(x.status, 200);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95) - 1];
    console.log(`    S-01 p95 = ${p95.toFixed(2)} ms (max ${times[99].toFixed(2)} ms)`);
    assert.ok(p95 < 50, 'p95=' + p95);
  });

  test('mode 非法 -> 400 bad_mode;health', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    assert.equal((await s.get('/api/leaderboard?mode=coop')).json.error, 'bad_mode');
    assert.equal((await s.get('/api/leaderboard')).status, 400);
    const h = await s.get('/api/health');
    assert.deepEqual(h.json, { ok: true });
  });
});

describe('S-02 校验', () => {
  test('每种非法输入返回对应错误码,且表行数不变', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    const cases = [
      ['mode 非法', valid({ mode: 'coop' }), 400, 'bad_mode'],
      ['mode 缺失', valid({ mode: undefined }), 400, 'bad_mode'],
      ['名字为空', valid({ name: '' }), 400, 'bad_name'],
      ['名字全空白', valid({ name: '   ' }), 400, 'bad_name'],
      ['名字 13 个字符', valid({ name: 'abcdefghijklm' }), 400, 'bad_name'],
      ['名字 13 个汉字', valid({ name: '一二三四五六七八九十一二三' }), 400, 'bad_name'],
      ['名字含控制字符', valid({ name: 'ab\u0007cd' }), 400, 'bad_name'],
      ['名字含制表符', valid({ name: 'ab\tcd' }), 400, 'bad_name'],
      ['名字含零宽字符', valid({ name: 'ab​cd' }), 400, 'bad_name'],
      ['名字含 BOM', valid({ name: 'ab﻿cd' }), 400, 'bad_name'],
      ['名字含方向控制', valid({ name: 'ab‮cd' }), 400, 'bad_name'],
      ['名字不是字符串', valid({ name: 123 }), 400, 'bad_name'],
      ['敏感词(英文)', valid({ name: 'fuck' }), 400, 'bad_word'],
      ['敏感词(中文)', valid({ name: '傻逼' }), 400, 'bad_word'],
      ['敏感词(中间加空格)', valid({ name: '傻 逼' }), 400, 'bad_word'],
      ['敏感词(夹标点)', valid({ name: 'f.u-c_k' }), 400, 'bad_word'],
      ['敏感词(大小写+前后缀)', valid({ name: 'xxShItyy' }), 400, 'bad_word'],
      ['score -1', valid({ score: -1 }), 400, 'bad_score'],
      ['score 1.5', valid({ score: 1.5 }), 400, 'bad_score'],
      ['score "100"', valid({ score: '100' }), 400, 'bad_score'],
      ['score 10,000,001', valid({ score: 10_000_001 }), 400, 'bad_score'],
      ['score null', valid({ score: null }), 400, 'bad_score'],
      ['rounds 0', valid({ rounds: 0 }), 400, 'bad_rounds'],
      ['rounds 9', valid({ rounds: 9 }), 400, 'bad_rounds'],
      ['未知角色', valid({ character: 'nobody' }), 400, 'bad_character'],
      ['version 0', valid({ version: 0 }), 400, 'bad_version'],
      ['version 1001', valid({ version: 1001 }), 400, 'bad_version'],
    ];
    for (const [label, body, st, code] of cases) {
      const r = await s.post(body);
      assert.equal(r.status, st, label);
      assert.deepEqual(r.json, { ok: false, error: code }, label);
    }
    const big = await s.post(valid({ name: 'x'.repeat(3000) }));
    assert.equal(big.status, 413);
    assert.equal(big.json.error, 'too_large');
    const nj = await s.req('POST', '/api/scores', { raw: 'this is not json', headers: { 'Content-Type': 'application/json' } });
    assert.equal(nj.status, 400);
    assert.equal(nj.json.error, 'bad_json');
    const arr = await s.req('POST', '/api/scores', { raw: '[1,2]', headers: { 'Content-Type': 'application/json' } });
    assert.equal(arr.json.error, 'bad_json');
    const nul = await s.req('POST', '/api/scores', { raw: 'null', headers: { 'Content-Type': 'application/json' } });
    assert.equal(nul.json.error, 'bad_json');
    const ty = await s.req('POST', '/api/scores', { raw: JSON.stringify(valid()), headers: { 'Content-Type': 'text/plain' } });
    assert.equal(ty.status, 415);
    assert.equal(ty.json.error, 'bad_type');
    assert.equal(s.count(), 0, '所有非法请求都不应写入');
    // 对照:合法请求成功
    assert.equal((await s.post(valid())).status, 201);
    assert.equal(s.count(), 1);
  });

  test('接受边界值与中文;名字被规范化;不误杀正常词', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    for (const [name, want] of [
      ['一二三四五六七八九十一二', '一二三四五六七八九十一二'], // 恰好 12 个汉字
      ['  矿工   小王  ', '矿工 小王'],
      ['Classic', 'Classic'], // 含 "ass" 不应误杀
      ['😀😀😀😀😀😀😀😀😀😀😀😀', '😀😀😀😀😀😀😀😀😀😀😀😀'], // 12 个码点
    ]) {
      const r = await s.post(valid({ name, score: 5 }));
      assert.equal(r.status, 201, name);
      const row = s.app.db.prepare('SELECT name FROM scores WHERE id=?').get(r.json.id);
      assert.equal(row.name, want);
    }
    assert.equal((await s.post(valid({ name: 'A', score: 0, rounds: 1, version: 1 }))).status, 201);
    assert.equal((await s.post(valid({ name: 'B', score: 10_000_000, rounds: 8, version: 1000, mode: 'versus' }))).status, 201);
    // NFC: e + 组合重音 -> é (一个码点)
    const r = await s.post(valid({ name: 'éééééééééééé', score: 6 }));
    assert.equal(r.status, 201);
    assert.equal(s.app.db.prepare('SELECT name FROM scores WHERE id=?').get(r.json.id).name, 'é'.repeat(12));
  });

  test('S-xx 中文名字往返 GET 完整保留', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    await s.post(valid({ name: '矿工小王sw ', score: 777 }));
    const e = await s.top('solo');
    assert.equal(e[0].name, '矿工小王sw');
  });
});

describe('S-03 前 20 边界', () => {
  test('20 条且最低 1000:1000 -> not_qualified(cutoff 1000);1001 -> rank 20 且旧第 20 名仍在表里', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    insertRows(s.app.db, Array.from({ length: 20 }, (_, i) => ({ score: 1000 + (19 - i) * 100 })));
    assert.equal(s.count('solo'), 20);
    const a = await s.post(valid({ score: 1000 }));
    assert.equal(a.status, 200);
    assert.deepEqual(a.json, { ok: false, reason: 'not_qualified', cutoff: 1000 });
    assert.equal(s.count('solo'), 20);
    const b = await s.post(valid({ score: 1001, name: 'Win' }));
    assert.equal(b.status, 201);
    assert.equal(b.json.ok, true);
    assert.equal(b.json.rank, 20);
    const top = await s.top('solo');
    assert.equal(top.length, 20);
    assert.equal(top[19].score, 1001);
    assert.equal(s.count('solo'), 21, '被挤出前 20 的记录仍在表里');
    assert.equal(s.app.db.prepare('SELECT COUNT(*) c FROM scores WHERE score=1000').get().c, 1);
  });

  test('同分:新记录排在已有同分记录后面', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    insertRows(s.app.db, Array.from({ length: 5 }, () => ({ score: 500 })));
    const r = await s.post(valid({ score: 500 }));
    assert.equal(r.json.rank, 6);
    const top = await s.top('solo');
    assert.equal(top[5].id, r.json.id);
  });

  test('不足 20 条时 0 分也能上榜;模式互不影响', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    insertRows(s.app.db, Array.from({ length: 19 }, (_, i) => ({ score: 100 + i })));
    const r = await s.post(valid({ score: 0 }));
    assert.equal(r.status, 201);
    assert.equal(r.json.rank, 20);
    const v = await s.post(valid({ score: 0, mode: 'versus' }));
    assert.equal(v.json.rank, 1);
    const full = await s.post(valid({ score: 0 }));
    assert.equal(full.json.reason, 'not_qualified');
    assert.equal(full.json.cutoff, 0);
  });
});

describe('S-04 名次正确', () => {
  test('随机 300 个分数(含重复),rank 等于参考实现', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    const rnd = mulberry(12345);
    const all = [];
    let qualified = 0;
    for (let i = 0; i < 300; i++) {
      const score = Math.floor(rnd() * 120) * 10; // 只有 120 个取值 -> 大量重复
      const ahead = all.filter((x) => x >= score).length;
      const refRank = 1 + ahead;
      all.push(score);
      const r = await s.post(valid({ score, name: 'N' + i }));
      if (refRank <= 20) {
        qualified++;
        assert.equal(r.status, 201, `#${i} score=${score}`);
        assert.equal(r.json.rank, refRank, `#${i} score=${score}`);
      } else {
        assert.equal(r.json.reason, 'not_qualified', `#${i}`);
        const sorted = [...all.slice(0, -1)].sort((a, b) => b - a);
        assert.equal(r.json.cutoff, sorted[19]);
      }
    }
    const top = await s.top('solo');
    assert.deepEqual(top.map((e) => e.score), [...all].sort((a, b) => b - a).slice(0, 20));
    console.log(`    S-04: 300 次提交,其中 ${qualified} 次上榜,rank 全部与参考实现一致`);
  });
});

describe('S-05 并发安全', () => {
  test('已有 20 条,同时 50 个不同分数 POST', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    const existing = Array.from({ length: 20 }, (_, i) => 1000 + i * 50); // 1000..1950
    insertRows(s.app.db, existing.map((score) => ({ score })));
    const rnd = mulberry(99);
    const pool = new Set();
    while (pool.size < 50) pool.add(500 + Math.floor(rnd() * 2000)); // 500..2499,与已有分数有重叠
    const incoming = [...pool];
    const res = await Promise.all(incoming.map((score, i) => s.post(valid({ score, name: 'C' + i }))));
    for (const r of res) assert.ok(r.status === 201 || r.status === 200, 'status ' + r.status);
    const okCount = res.filter((r) => r.status === 201).length;
    const ids = res.filter((r) => r.status === 201).map((r) => r.json.id);
    assert.equal(new Set(ids).size, ids.length, 'id 不重复');
    assert.equal(s.count('solo'), 20 + okCount, '返回 ok 的请求数 = 实际写入的行数');
    const expected = [...existing, ...incoming].sort((a, b) => b - a).slice(0, 20);
    const top = await s.top('solo');
    assert.deepEqual(top.map((e) => e.score), expected);
    const dbIds = s.app.db.prepare('SELECT id FROM scores').all().map((r) => r.id);
    assert.equal(new Set(dbIds).size, dbIds.length);
    console.log(`    S-05: 50 并发,${okCount} 个上榜写入,${50 - okCount} 个 not_qualified,前 20 与参考完全一致`);
  });
});

describe('S-06 只留前 100', () => {
  test('连续插入 150 个递增分数 -> 恰好 100 行且是最高的 100 个;另一模式不变', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    insertRows(s.app.db, Array.from({ length: 7 }, (_, i) => ({ mode: 'versus', score: i })));
    for (let i = 1; i <= 150; i++) {
      const r = await s.post(valid({ score: i * 10, name: 'U' + i }));
      assert.equal(r.status, 201, 'i=' + i);
    }
    assert.equal(s.count('solo'), 100);
    const scores = s.app.db.prepare('SELECT score FROM scores WHERE mode=? ORDER BY score DESC').all('solo').map((r) => r.score);
    assert.deepEqual(scores, Array.from({ length: 100 }, (_, i) => (150 - i) * 10));
    assert.equal(s.count('versus'), 7);
  });
});

describe('S-10 持久化', () => {
  test('重启后数据完整,journal_mode = wal;迁移版本 1', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    await s.post(valid({ name: '持久', score: 4242 }));
    assert.equal(s.app.db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(s.app.db.pragma('user_version', { simple: true }), 1);
    await s.close();
    const s2 = await startServer({ dir: s.dir });
    t.after(async () => s2.close());
    const top = await s2.top('solo');
    assert.equal(top.length, 1);
    assert.equal(top[0].name, '持久');
    assert.equal(top[0].score, 4242);
    assert.equal(s2.app.db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(s2.app.db.pragma('user_version', { simple: true }), 1, '迁移幂等');
    assert.ok(s2.app.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_scores_rank'").get());
  });

  test('真实进程 node src/server.js:启动、响应、SIGTERM 退出;重启后数据仍在', async (t) => {
    const s = await startServer(); // 只借用临时目录
    await s.close();
    t.after(() => require('node:fs').rmSync(s.dir, { recursive: true, force: true }));
    const port = await freePort();
    const env = { ...process.env, PORT: String(port), DB_PATH: path.join(s.dir, 'p.db'), BACKUP_DIR: path.join(s.dir, 'b') };
    const spawnSrv = async () => {
      const child = cp.spawn(process.execPath, [path.join(ROOT, 'src/server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      await new Promise((res, rej) => {
        child.stdout.on('data', (d) => /监听/.test(String(d)) && res());
        child.on('exit', (c) => rej(new Error('exit ' + c)));
        setTimeout(() => rej(new Error('timeout')), 5000);
      });
      return child;
    };
    let child = await spawnSrv();
    const base = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true });
    const r = await fetch(base + '/api/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid({ name: '进程', score: 9 })) });
    assert.equal(r.status, 201);
    const exited = new Promise((res) => child.on('exit', (code, sig) => res({ code, sig })));
    child.kill('SIGTERM');
    const ex = await exited;
    assert.equal(ex.code, 0);
    child = await spawnSrv();
    const j = await (await fetch(base + '/api/leaderboard?mode=solo')).json();
    assert.equal(j.entries[0].name, '进程');
    child.kill('SIGTERM');
    // 只监听 127.0.0.1:从非回环地址连不上(此处仅检查绑定地址)
    // (绑定地址在 config.host 固定为 127.0.0.1)
  });
});

describe('S-11 安全', () => {
  test('XSS/SQL 注入字符串按原样存储,表依然存在;超长的被拒绝', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    const names = ['<script>', '<b>x</b>', '<img src=x>', "';DROP TABLE", "x');DROP--", '" OR 1=1 --', '\\u0000x'];
    for (const [i, name] of names.entries()) {
      const r = await s.post(valid({ name, score: 100 + i }));
      assert.equal(r.status, 201, name);
      assert.equal(s.app.db.prepare('SELECT name FROM scores WHERE id=?').get(r.json.id).name, name);
    }
    for (const name of ['<script>alert(1)</script>', "'; DROP TABLE scores;--"]) {
      const r = await s.post(valid({ name }));
      assert.equal(r.json.error, 'bad_name'); // 超过 12 个字符,被拒绝而不是被执行
    }
    assert.ok(s.app.db.prepare("SELECT name FROM sqlite_master WHERE name='scores'").get());
    const top = await s.top('solo');
    assert.ok(top.some((e) => e.name === '<script>'), 'GET 原样返回(前端按纯文本渲染)');
    assert.equal(s.count('solo'), names.length);
    // mode 参数里的注入
    assert.equal((await s.get("/api/leaderboard?mode=solo'%20OR%201=1")).status, 400);
  });

  test('500 响应不含堆栈;所有响应 Content-Type 正确', async (t) => {
    const s = await startServer();
    t.after(() => require('node:fs').rmSync(s.dir, { recursive: true, force: true }));
    await s.post(valid());
    await s.get('/api/nope');
    await s.req('PUT', '/api/scores');
    await s.req('DELETE', '/api/health');
    const orig = process.stderr.write;
    let logged = '';
    process.stderr.write = (c) => { logged += c; return true; };
    s.app.db.close(); // 制造内部错误
    let r500, r500b;
    try {
      r500 = await s.get('/api/leaderboard?mode=solo');
      r500b = await s.post(valid());
    } finally {
      process.stderr.write = orig;
    }
    assert.equal(r500.status, 500);
    assert.deepEqual(r500.json, { ok: false, error: 'internal' });
    assert.equal(r500b.status, 500);
    assert.ok(/内部错误/.test(logged), '堆栈只写日志');
    for (const x of s.seen) {
      assert.match(x.type || '', /^application\/json; charset=utf-8$/, x.path);
      assert.doesNotMatch(x.text, /\bat .*\(.*:\d+:\d+\)|node_modules|\.js:\d+/, '响应里不应有堆栈: ' + x.path);
    }
    await s.app.close();
  });
});

describe('路由与 CORS', () => {
  test('404 / 405 / OPTIONS;默认不发 CORS 头', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    assert.equal((await s.get('/api/nope')).status, 404);
    const m = await s.req('GET', '/api/scores');
    assert.equal(m.status, 405);
    assert.equal(m.json.error, 'method_not_allowed');
    const o = await s.req('OPTIONS', '/api/scores', { headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(o.status, 204);
    assert.equal(o.headers.get('access-control-allow-origin'), null);
    const g = await s.req('GET', '/api/health', { headers: { Origin: 'http://evil.example' } });
    assert.equal(g.headers.get('access-control-allow-origin'), null);
    assert.equal((await s.get('/')).status, 404, '未设置 SERVE_STATIC 时不提供静态文件');
  });

  test('CORS_ORIGIN 白名单:只回显允许的来源', async (t) => {
    const s = await startServer({ env: { CORS_ORIGIN: 'http://127.0.0.1:5173, http://localhost:5173' } });
    t.after(s.cleanup);
    const ok = await s.req('GET', '/api/health', { headers: { Origin: 'http://127.0.0.1:5173' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
    assert.match(ok.headers.get('vary'), /Origin/);
    const bad = await s.req('GET', '/api/health', { headers: { Origin: 'http://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    const pre = await s.req('OPTIONS', '/api/scores', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.match(pre.headers.get('access-control-allow-headers'), /Content-Type/i);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
    const post = await s.req('POST', '/api/scores', { body: valid(), headers: { Origin: 'http://localhost:5173' } });
    assert.equal(post.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });

  test('TRUST_PROXY=0 时忽略 X-Real-IP(无法伪造绕过限流)', async (t) => {
    const s = await startServer({ env: { TRUST_PROXY: '0' } });
    t.after(s.cleanup);
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await s.post(valid({ score: i + 1 }))).status); // 每次不同 X-Real-IP
    assert.deepEqual(codes.slice(5), [429, 429]);
  });

  test('SERVE_STATIC 提供静态文件,并拒绝路径穿越', async (t) => {
    const s = await startServer({ env: { SERVE_STATIC: path.join(ROOT, 'client') } });
    t.after(s.cleanup);
    const f = await s.get('/leaderboard-client.js');
    assert.equal(f.status, 200);
    assert.match(f.headers.get('content-type'), /javascript/);
    const r = await fetch(s.url + '/..%2f..%2fpackage.json');
    assert.ok([403, 404].includes(r.status));
    const raw = await new Promise((res) => {
      const sock = require('node:net').connect(new URL(s.url).port, '127.0.0.1', () => sock.write('GET /../package.json HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      let d = '';
      sock.on('data', (c) => (d += c));
      sock.on('close', () => res(d));
    });
    assert.doesNotMatch(raw, /goldminer-leaderboard/);
  });
});

describe('慢请求', () => {
  test('header 或 body 停住 -> 约 12 秒内收到 408(connectionsCheckingInterval=2000)', { timeout: 30000 }, async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    const port = new URL(s.url).port;
    const probe = (payload) =>
      new Promise((resolve) => {
        const t0 = Date.now();
        const sock = require('node:net').connect(port, '127.0.0.1', () => sock.write(payload));
        let d = '';
        sock.on('data', (c) => (d += c));
        sock.on('close', () => resolve({ ms: Date.now() - t0, head: d.split('\r\n')[0] }));
      });
    const [a, b] = await Promise.all([
      probe('POST /api/scores HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"mode":'),
      probe('POST /api/scores HTTP/1.1\r\nHost: x\r\nContent-Ty'),
    ]);
    console.log(`    慢请求: body 停住 ${a.ms} ms -> ${a.head}; header 停住 ${b.ms} ms -> ${b.head}`);
    assert.ok(a.ms < 13000, 'body ms=' + a.ms);
    assert.ok(b.ms < 13000, 'header ms=' + b.ms);
    assert.match(a.head, /408/);
  });
});
