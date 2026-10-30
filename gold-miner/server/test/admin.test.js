'use strict';
// S-08 管理接口与命令行
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const Database = require('better-sqlite3');
const { startServer, valid, insertRows, ROOT } = require('./helpers');

const PW = 'test-admin-pw-123';
const auth = (pw = PW) => ({ Authorization: 'Bearer ' + pw });

describe('S-08 管理接口', () => {
  test('ADMIN_PASSWORD 为空 -> 全部 404(接口关闭)', async (t) => {
    const s = await startServer();
    t.after(s.cleanup);
    for (const [m, p] of [['GET', '/api/admin/scores'], ['DELETE', '/api/admin/scores/1'], ['POST', '/api/admin/clear'], ['POST', '/api/admin/archive']]) {
      const r = await s.req(m, p, { headers: auth('anything') });
      assert.equal(r.status, 404, m + ' ' + p);
    }
  });

  test('没有或错误的密码 -> 401;连续失败 10 次后 429', async (t) => {
    const clock = { t: 1_800_000_000_000, now() { return this.t; } };
    const s = await startServer({ env: { ADMIN_PASSWORD: PW }, clock });
    t.after(s.cleanup);
    const ip = '198.51.100.5';
    assert.equal((await s.req('GET', '/api/admin/scores', { ip })).status, 401);
    assert.equal((await s.req('GET', '/api/admin/scores', { ip, headers: auth('wrong') })).status, 401);
    assert.equal((await s.req('GET', '/api/admin/scores', { ip, headers: { Authorization: PW } })).status, 401, '没有 Bearer 前缀');
    assert.equal((await s.req('GET', '/api/admin/scores', { ip, headers: auth(PW + 'x') })).status, 401);
    assert.equal((await s.req('GET', '/api/admin/scores', { ip, headers: auth('') })).status, 401);
    for (let i = 0; i < 5; i++) assert.equal((await s.req('GET', '/api/admin/scores', { ip, headers: auth('bad' + i) })).status, 401);
    const r = await s.req('GET', '/api/admin/scores', { ip, headers: auth('bad') });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1);
    clock.t += 61_000;
    assert.equal((await s.req('GET', '/api/admin/scores', { ip, headers: auth() })).status, 200);
    // 密码正确的请求不被失败计数限制
    for (let i = 0; i < 15; i++) assert.equal((await s.req('GET', '/api/admin/scores?limit=1', { ip, headers: auth() })).status, 200);
  });

  test('锁定期间正确密码也返回 429(不再比较密码);61 秒后恢复;成功访问不计数', async (t) => {
    const clock = { t: 1_800_000_000_000, now() { return this.t; } };
    const s = await startServer({ env: { ADMIN_PASSWORD: PW }, clock });
    t.after(s.cleanup);
    const ip = '198.51.100.77';
    const codes = [];
    for (let i = 0; i < 14; i++) codes.push((await s.req('GET', '/api/admin/scores', { ip, headers: auth('wrong' + i) })).status);
    assert.deepEqual(codes, [...Array(10).fill(401), ...Array(4).fill(429)]);
    const good = await s.req('GET', '/api/admin/scores', { ip, headers: auth() });
    assert.equal(good.status, 429, '正确密码在锁定期间也必须是 429');
    assert.ok(Number(good.headers.get('retry-after')) >= 1);
    assert.equal((await s.req('DELETE', '/api/admin/scores/1', { ip, headers: auth() })).status, 429);
    assert.equal((await s.req('GET', '/api/admin/scores', { ip: '198.51.100.78', headers: auth() })).status, 200, '其它 IP 不受影响');
    clock.t += 30_000;
    assert.equal((await s.req('GET', '/api/admin/scores', { ip, headers: auth() })).status, 429, '30 秒后仍锁定');
    clock.t += 31_000;
    assert.equal((await s.req('GET', '/api/admin/scores', { ip, headers: auth() })).status, 200, '61 秒后恢复');
  });

  test('查看 / 删除 / 改名(新名字照样校验)', async (t) => {
    const s = await startServer({ env: { ADMIN_PASSWORD: PW } });
    t.after(s.cleanup);
    insertRows(s.app.db, [{ score: 300, name: 'A' }, { score: 200, name: 'B' }, { score: 100, name: 'C', mode: 'versus' }]);
    const h = { headers: auth() };
    const l = await s.req('GET', '/api/admin/scores?mode=solo&limit=1', h);
    assert.equal(l.json.entries.length, 1);
    assert.equal(l.json.entries[0].name, 'A');
    assert.equal((await s.req('GET', '/api/admin/scores', h)).json.entries.length, 3);
    assert.equal((await s.req('GET', '/api/admin/scores?mode=bad', h)).status, 400);
    assert.equal((await s.req('GET', '/api/admin/scores?limit=abc', h)).status, 400);

    const id = l.json.entries[0].id;
    const ok = await s.req('PATCH', '/api/admin/scores/' + id, { ...h, body: { name: '新名字' } });
    assert.equal(ok.status, 200);
    assert.equal(s.app.db.prepare('SELECT name FROM scores WHERE id=?').get(id).name, '新名字');
    assert.equal((await s.req('PATCH', '/api/admin/scores/' + id, { ...h, body: { name: 'f u c k' } })).json.error, 'bad_word');
    assert.equal((await s.req('PATCH', '/api/admin/scores/' + id, { ...h, body: { name: 'x'.repeat(13) } })).json.error, 'bad_name');
    assert.equal((await s.req('PATCH', '/api/admin/scores/' + id, { ...h, body: { name: '' } })).json.error, 'bad_name');
    assert.equal((await s.req('PATCH', '/api/admin/scores/' + id, { ...h, body: {} })).json.error, 'bad_name');
    assert.equal(s.app.db.prepare('SELECT name FROM scores WHERE id=?').get(id).name, '新名字');
    assert.equal((await s.req('PATCH', '/api/admin/scores/99999', { ...h, body: { name: 'ok' } })).status, 404);

    const d = await s.req('DELETE', '/api/admin/scores/' + id, h);
    assert.equal(d.status, 200);
    assert.equal(s.count(), 2);
    assert.equal((await s.req('DELETE', '/api/admin/scores/' + id, h)).status, 404);
  });

  test('归档:JSON 文件行数 = 删除行数,内容可解析;按模式 / 全部', async (t) => {
    const s = await startServer({ env: { ADMIN_PASSWORD: PW } });
    t.after(s.cleanup);
    insertRows(s.app.db, [
      ...Array.from({ length: 5 }, (_, i) => ({ score: 100 + i, version: 2 })),
      ...Array.from({ length: 3 }, (_, i) => ({ score: 50 + i, version: 1 })),
      ...Array.from({ length: 4 }, (_, i) => ({ score: 10 + i, version: 2, mode: 'versus', name: '对战' + i })),
    ]);
    const h = { headers: auth() };
    const a = await s.req('POST', '/api/admin/archive', { ...h, body: { version: 2, mode: 'solo' } });
    assert.equal(a.status, 200);
    assert.equal(a.json.archived, 5);
    assert.match(path.basename(a.json.file), /^archive-solo-v2-\d{8}-\d{6}.*\.json$/);
    const rows = JSON.parse(fs.readFileSync(a.json.file, 'utf8'));
    assert.equal(rows.length, 5);
    assert.ok(rows.every((r) => r.version === 2 && r.mode === 'solo'));
    assert.equal(s.count('solo'), 3, '只删除归档的行');
    assert.equal(s.count('versus'), 4);
    const b = await s.req('POST', '/api/admin/archive', { ...h, body: { version: 2 } });
    assert.equal(b.json.archived, 4);
    assert.match(path.basename(b.json.file), /^archive-all-v2-/);
    const rows2 = JSON.parse(fs.readFileSync(b.json.file, 'utf8'));
    assert.equal(rows2.length, 4);
    assert.deepEqual(rows2.map((r) => r.name).sort(), ['对战0', '对战1', '对战2', '对战3']);
    assert.equal(s.count(), 3);
    const c = await s.req('POST', '/api/admin/archive', { ...h, body: { version: 7 } });
    assert.equal(c.json.archived, 0);
    assert.equal(JSON.parse(fs.readFileSync(c.json.file, 'utf8')).length, 0);
    assert.equal((await s.req('POST', '/api/admin/archive', { ...h, body: { version: 'x' } })).json.error, 'bad_version');
    assert.equal((await s.req('POST', '/api/admin/archive', { ...h, body: { version: 2, mode: 'coop' } })).json.error, 'bad_mode');
  });

  test('清空:不带 confirm 返回 400;带 confirm 清空;可按版本', async (t) => {
    const s = await startServer({ env: { ADMIN_PASSWORD: PW } });
    t.after(s.cleanup);
    insertRows(s.app.db, [
      { score: 1, version: 1 }, { score: 2, version: 2 }, { score: 3, version: 2 },
      { score: 4, mode: 'versus' }, { score: 5, mode: 'versus' },
    ]);
    const h = { headers: auth() };
    for (const body of [{ mode: 'solo' }, { mode: 'solo', confirm: false }, { mode: 'solo', confirm: 'true' }, {}]) {
      const r = await s.req('POST', '/api/admin/clear', { ...h, body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error, 'confirm_required');
    }
    assert.equal(s.count(), 5);
    assert.equal((await s.req('POST', '/api/admin/clear', { ...h, body: { confirm: true } })).json.error, 'bad_mode');
    const v = await s.req('POST', '/api/admin/clear', { ...h, body: { mode: 'solo', version: 1, confirm: true } });
    assert.equal(v.json.cleared, 1);
    assert.equal(s.count('solo'), 2);
    const all = await s.req('POST', '/api/admin/clear', { ...h, body: { mode: 'solo', confirm: true } });
    assert.equal(all.json.cleared, 2);
    assert.equal(s.count('solo'), 0);
    assert.equal(s.count('versus'), 2);
  });
});

describe('S-08 命令行 admin.js(与接口效果相同)', () => {
  const run = (args, env) =>
    cp.spawnSync(process.execPath, [path.join(ROOT, 'admin.js'), ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });

  test('list / rename / delete / archive / clear', async (t) => {
    const s = await startServer({ env: { ADMIN_PASSWORD: PW } });
    t.after(s.cleanup);
    const env = { DB_PATH: s.cfg.dbPath, BACKUP_DIR: s.cfg.backupDir };
    insertRows(s.app.db, [
      ...Array.from({ length: 4 }, (_, i) => ({ score: 100 + i, version: 2 })),
      { score: 5, version: 1 },
      ...Array.from({ length: 3 }, (_, i) => ({ score: 10 + i, mode: 'versus', version: 2 })),
    ]);
    // list(服务正在运行,WAL 允许并发读写)
    const l = run(['list', '--mode', 'solo'], env);
    assert.equal(l.status, 0, l.stderr);
    assert.equal(l.stdout.trim().split('\n').length, 5);
    const firstId = Number(l.stdout.trim().split('\n')[0].split('\t')[0]);
    // rename(中文名,参数里带空格会合并)
    const rn = run(['rename', String(firstId), '新名字'], env);
    assert.equal(rn.status, 0, rn.stderr);
    assert.equal(s.app.db.prepare('SELECT name FROM scores WHERE id=?').get(firstId).name, '新名字');
    const bad = run(['rename', String(firstId), '傻逼'], env);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /bad_word/);
    assert.equal(s.app.db.prepare('SELECT name FROM scores WHERE id=?').get(firstId).name, '新名字');
    assert.equal(run(['rename', String(firstId), 'x'.repeat(13)], env).status, 1);
    // 排行榜接口立刻反映命令行的修改
    assert.equal((await s.top('solo'))[0].name, '新名字');
    // delete
    assert.equal(run(['delete', String(firstId)], env).status, 0);
    assert.equal(s.count('solo'), 4);
    assert.equal(run(['delete', String(firstId)], env).status, 1);
    // archive
    const ar = run(['archive', '--version', '2', '--mode', 'solo'], env);
    assert.equal(ar.status, 0, ar.stderr);
    const out = JSON.parse(ar.stdout);
    assert.equal(out.archived, 3);
    assert.equal(JSON.parse(fs.readFileSync(out.file, 'utf8')).length, 3);
    assert.equal(s.count('solo'), 1);
    // clear:不带 --yes 失败
    const c0 = run(['clear', '--mode', 'versus'], env);
    assert.equal(c0.status, 1);
    assert.match(c0.stderr, /confirm_required/);
    assert.equal(s.count('versus'), 3);
    const c1 = run(['clear', '--mode', 'versus', '--yes'], env);
    assert.equal(c1.status, 0, c1.stderr);
    assert.equal(JSON.parse(c1.stdout).cleared, 3);
    assert.equal(s.count('versus'), 0);
    // 用法
    const u = run([], env);
    assert.equal(u.status, 2);
    assert.match(u.stderr, /用法/);
    assert.ok(new Database(s.cfg.dbPath, { readonly: true }).prepare('SELECT 1').get());
  });
});
