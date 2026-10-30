'use strict';
// 前端客户端模块 server/client/leaderboard-client.js:Node 下对真实服务测试 + 服务器不可用 + Playwright 浏览器测试
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const { startServer, insertRows, ROOT } = require('./helpers');
const C = require('../client/leaderboard-client.js');

const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(e));

function spyConsole() {
  const calls = [];
  const orig = console.error;
  console.error = (...a) => calls.push(a);
  return { calls, restore: () => (console.error = orig) };
}

describe('leaderboard-client(Node,对真实服务)', () => {
  test('lbFetchTop / lbQualifies / lbSubmit 完整流程', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    C.lbConfigure({ base: s.url, timeoutMs: 4000 });
    // 空榜
    const r0 = await C.lbFetchTop('solo');
    assert.deepEqual(r0, { ok: true, mode: 'solo', entries: [] });
    assert.equal(C.lbState.solo.status, 'ok');
    assert.deepEqual(C.lbQualifies('solo', 0), { known: true, qualifies: true, rank: 1, cutoff: 0 });
    // 未取过的模式 -> known:false(不要弹窗)
    assert.equal(C.lbQualifies('versus', 100).known, false);
    assert.equal(C.lbQualifies('versus', 100).qualifies, false);

    // 填满 20 条
    insertRows(s.app.db, Array.from({ length: 20 }, (_, i) => ({ score: 1000 + i * 100, name: 'P' + i })));
    const r1 = await C.lbFetchTop('solo');
    assert.equal(r1.entries.length, 20);
    assert.equal(r1.entries[0].rank, 1);
    assert.equal(r1.entries[0].score, 2900);
    assert.deepEqual(C.lbQualifies('solo', 1000), { known: true, qualifies: false, rank: 21, cutoff: 1000 });
    assert.deepEqual(C.lbQualifies('solo', 1001), { known: true, qualifies: true, rank: 20, cutoff: 1000 });
    assert.equal(C.lbQualifies('solo', 5000).rank, 1);
    assert.equal(C.lbQualifies('solo', -1).known, false);

    const ok = await C.lbSubmit({ mode: 'solo', name: '矿工小王sw', score: 5000, rounds: 3, character: 'laojin', version: 2 });
    assert.equal(ok.ok, true);
    assert.equal(ok.rank, 1);
    assert.ok(Number.isInteger(ok.id));
    assert.equal(C.lbState.solo.status, 'idle', '提交成功后本地榜单标记为过期');
    const again = await C.lbFetchTop('solo');
    assert.equal(again.entries[0].name, '矿工小王sw');
    assert.equal(again.entries[0].id, ok.id, '条目带 id,可用于高亮自己的那一行');

    const nq = await C.lbSubmit({ mode: 'solo', name: 'low', score: 1, rounds: 1, character: 'laojin', version: 2 });
    assert.equal(nq.ok, false);
    assert.equal(nq.reason, 'not_qualified');
    assert.equal(nq.cutoff, 1100); // 现在第 20 名
    assert.equal(nq.message, '很遗憾,刚刚被别人超过了');

    const bw = await C.lbSubmit({ mode: 'solo', name: '傻逼', score: 9000, rounds: 3, character: 'laojin', version: 2 });
    assert.deepEqual([bw.ok, bw.error, bw.status, bw.message], [false, 'bad_word', 400, '名字包含不合适的词']);
    const bn = await C.lbSubmit({ mode: 'solo', name: '', score: 9000, rounds: 3, character: 'laojin', version: 2 });
    assert.equal(bn.error, 'bad_name');
    const garbage = await C.lbSubmit(undefined);
    assert.equal(garbage.ok, false);
    assert.equal(garbage.unavailable, undefined, '服务器可达时,参数错误不算 unavailable');
    // 改动:原先期望服务端 400;现在缺少 version(≠2)在本地就被拒绝(bad_version,不发请求)
    assert.equal(garbage.error, 'bad_version');
  });

  test('version 不是 2 -> 不发请求,resolve bad_version;lbShouldOffer 合并版本与上榜判断', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    C.lbConfigure({ base: s.url });
    await C.lbFetchTop('solo');
    for (const version of [1, 3, undefined, '2']) {
      const r = await C.lbSubmit({ mode: 'solo', name: 'A', score: 10, rounds: 1, character: 'laojin', version });
      assert.deepEqual([r.ok, r.error], [false, 'bad_version']);
    }
    assert.equal(s.count(), 0);
    assert.equal(s.seen.filter((x) => x.path === '/api/scores').length, 0, 'version 1 不发任何 POST 请求');
    assert.equal(C.LB_ACCEPT_VERSION, 2);
    assert.equal(C.lbShouldOffer('solo', 2, 10).offer, true);
    assert.equal(C.lbShouldOffer('solo', 1, 10).offer, false);
    assert.equal(C.lbShouldOffer('versus', 2, 10).offer, false, '没取过榜单 -> 不弹');
    assert.equal(C.lbShouldOffer('versus', 2, 10).known, false);
  });

  test('429 -> 提交太频繁 + retryAfter', async (t) => {
    const s = await startServer({ env: { TRUST_PROXY: '0' } }); // 同一 IP
    t.after(s.cleanup);
    C.lbConfigure({ base: s.url });
    let last;
    for (let i = 0; i < 6; i++) last = await C.lbSubmit({ mode: 'solo', name: 'A', score: i + 1, rounds: 1, character: 'laojin', version: 2 });
    assert.equal(last.ok, false);
    assert.equal(last.error, 'rate_limited');
    assert.equal(last.status, 429);
    assert.equal(last.message, '提交太频繁,请稍后再试');
    assert.ok(last.retryAfter >= 1);
  });

  test('辅助函数:lbClampName 按码点;lbRankIn;lbDate', () => {
    assert.deepEqual(C.lbClampName('一二三四五六七八九十一二三'), { name: '一二三四五六七八九十一二', truncated: true });
    assert.deepEqual(C.lbClampName('😀'.repeat(13)), { name: '😀'.repeat(12), truncated: true });
    assert.deepEqual(C.lbClampName('abc'), { name: 'abc', truncated: false });
    assert.deepEqual(C.lbRankIn([], 0), { qualifies: true, rank: 1, cutoff: 0 });
    assert.match(C.lbDate(Date.now()), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(C.lbDate(new Date(2026, 0, 5, 12).getTime()), '2026-01-05');
  });
});

describe('leaderboard-client:服务器不可用时不抛出、不 reject、不 console.error', () => {
  const body = { mode: 'solo', name: 'A', score: 10, rounds: 1, character: 'laojin', version: 2 };
  const expectUnavailable = (r) => {
    assert.equal(r.ok, false);
    assert.equal(r.unavailable, true);
    assert.equal(r.message, '暂时无法连接排行榜');
  };

  test('连接被拒绝(端口 1)', async () => {
    const spy = spyConsole();
    try {
      C.lbConfigure({ base: 'http://127.0.0.1:1', timeoutMs: 1000 });
      expectUnavailable(await C.lbFetchTop('solo'));
      assert.equal(C.lbState.solo.status, 'unavailable');
      assert.equal(C.lbQualifies('solo', 100).known, false, '榜单获取失败后不应判断为上榜');
      expectUnavailable(await C.lbSubmit(body));
    } finally {
      spy.restore();
    }
    assert.equal(spy.calls.length, 0);
  });

  test('服务器关闭后(曾经可用)', async () => {
    const s = await startServer();
    C.lbConfigure({ base: s.url, timeoutMs: 1000 });
    assert.equal((await C.lbFetchTop('solo')).ok, true);
    await s.cleanup();
    expectUnavailable(await C.lbFetchTop('solo'));
    expectUnavailable(await C.lbSubmit(body));
  });

  test('服务器接受连接但永不响应 -> 超时(4 秒默认;此处 300ms)', async () => {
    const sockets = [];
    const hang = net.createServer((s) => sockets.push(s));
    await new Promise((r) => hang.listen(0, '127.0.0.1', r));
    C.lbConfigure({ base: `http://127.0.0.1:${hang.address().port}`, timeoutMs: 300 });
    const t0 = Date.now();
    expectUnavailable(await C.lbFetchTop('versus'));
    expectUnavailable(await C.lbSubmit(body));
    const dt = Date.now() - t0;
    assert.ok(dt >= 500 && dt < 2000, 'dt=' + dt);
    sockets.forEach((s) => s.destroy());
    await new Promise((r) => hang.close(r));
  });

  test('服务器返回 500 / 非 JSON / 200 但结构不对 -> unavailable', async () => {
    let mode = '500';
    const srv = http.createServer((req, res) => {
      if (mode === '500') { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"internal"}'); }
      else if (mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>Bad gateway</html>'); }
      else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"hello":1}'); }
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    C.lbConfigure({ base: `http://127.0.0.1:${srv.address().port}`, timeoutMs: 1000 });
    for (const m of ['500', 'html', 'weird']) {
      mode = m;
      expectUnavailable(await C.lbFetchTop('solo'));
    }
    mode = '500';
    expectUnavailable(await C.lbSubmit(body));
    mode = 'html';
    expectUnavailable(await C.lbSubmit(body));
    await new Promise((r) => srv.close(r));
  });

  test('base 为 null(file:// 且无 ?api=)-> unavailable,且不发请求', async () => {
    C.lbConfigure({ base: null });
    expectUnavailable(await C.lbFetchTop('solo'));
    expectUnavailable(await C.lbSubmit(body));
    C.lbConfigure({ base: undefined });
    assert.equal(C.lbBase(), null, 'Node 下没有 location -> null');
  });

  test('整个文件没有产生未处理的 rejection', async () => {
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(unhandled, []);
  });
});

describe('leaderboard-client(Chromium 浏览器,Playwright)', () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    try { ({ chromium } = require(require.resolve('playwright', { paths: ['/opt/node22/lib/node_modules'] }))); } catch {}
  }
  const skip = !chromium && 'playwright 不可用';

  async function launch() {
    process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
    return chromium.launch();
  }

  test('同源默认、?api= 覆盖、跨源 CORS、服务器不可用、file:// 无 ?api=', { skip }, async (t) => {
    const s = await startServer({ env: { SERVE_STATIC: ROOT } });
    t.after(s.cleanup);
    insertRows(s.app.db, [{ score: 321, name: '浏览器' }]);
    // 跨源:服务 B 只开 CORS 给 A
    const origin = `http://127.0.0.1:${s.url.split(':').pop()}`; // A = s(静态+API 同源)
    const b = await startServer({ env: { CORS_ORIGIN: origin } });
    t.after(b.cleanup);
    insertRows(b.app.db, [{ score: 999, name: '跨源' }]);

    const browser = await launch();
    t.after(() => browser.close());
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    const pageUrl = `${s.url}/test/page/lb-test.html`;

    // 1. 同源默认
    await page.goto(pageUrl);
    assert.equal(await page.evaluate(() => lbBase()), '');
    let r = await page.evaluate(() => lbFetchTop('solo'));
    assert.equal(r.ok, true);
    assert.equal(r.entries[0].name, '浏览器');
    assert.deepEqual(await page.evaluate(() => lbQualifies('solo', 322)), { known: true, qualifies: true, rank: 1, cutoff: 0 });
    const sub = await page.evaluate(() => lbSubmit({ mode: 'solo', name: '矿工小王', score: 500, rounds: 2, character: 'xunbao', version: 2 }));
    assert.equal(sub.ok, true);
    assert.equal(sub.rank, 1);

    // 2. ?api= 跨源(B 允许 A 的 Origin)-> 读取和提交都成功
    await page.goto(`${pageUrl}?api=${encodeURIComponent(b.url)}`);
    assert.equal(await page.evaluate(() => lbBase()), b.url);
    r = await page.evaluate(() => lbFetchTop('solo'));
    assert.equal(r.ok, true);
    assert.equal(r.entries[0].name, '跨源');
    const sub2 = await page.evaluate(() => lbSubmit({ mode: 'versus', name: '跨源提交', score: 77, rounds: 1, character: 'laojin', version: 2 }));
    assert.equal(sub2.ok, true);
    assert.equal(b.count('versus'), 1);

    // 3. ?api= 指向 B 但 B 不允许这个来源(用第三个 origin)-> unavailable,不抛出
    const c = await startServer({ env: { CORS_ORIGIN: 'http://example.invalid' } });
    t.after(c.cleanup);
    await page.goto(`${pageUrl}?api=${encodeURIComponent(c.url)}`);
    r = await page.evaluate(() => lbFetchTop('solo'));
    assert.equal(r.unavailable, true);

    // 4. 服务器不可用
    await page.goto(`${pageUrl}?api=http://127.0.0.1:1`);
    const t0 = Date.now();
    r = await page.evaluate(() => lbFetchTop('solo'));
    assert.deepEqual([r.ok, r.unavailable, r.message], [false, true, '暂时无法连接排行榜']);
    const sub3 = await page.evaluate(() => lbSubmit({ mode: 'solo', name: 'x', score: 1, rounds: 1, character: 'laojin', version: 2 }));
    assert.equal(sub3.unavailable, true);
    assert.ok(Date.now() - t0 < 5000);

    // 5. file:// 且没有 ?api= -> 视为暂时无法连接
    await page.goto('file://' + path.join(ROOT, 'test/page/lb-test.html'));
    assert.equal(await page.evaluate(() => lbBase()), null);
    r = await page.evaluate(() => lbFetchTop('solo'));
    assert.equal(r.unavailable, true);
    // file:// + ?api= 仍可用(服务端需 CORS;此处 file 的 Origin 是 null,B 不允许 -> unavailable,但不抛出)
    await page.goto('file://' + path.join(ROOT, 'test/page/lb-test.html') + '?api=' + encodeURIComponent(s.url));
    assert.equal(await page.evaluate(() => lbBase()), s.url);

    // window.GOLDMINER_API
    await page.goto(pageUrl);
    assert.equal(await page.evaluate(() => { window.GOLDMINER_API = 'https://x.example/'; return lbBase(); }), 'https://x.example');

    assert.deepEqual(pageErrors, [], 'pageerror 为 0');
    const bad = consoleErrors.filter((m) => !/Failed to load resource|net::ERR_|CORS|Access-Control/i.test(m));
    assert.deepEqual(bad, [], '除浏览器自身的网络失败日志外没有 console.error');
  });
});
