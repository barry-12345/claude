'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/server');

const ROOT = path.resolve(__dirname, '..');
let ipSeq = 0;
const nextIp = () => `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;

function tmpDir(prefix = 'gm-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 启动真实服务(随机端口、临时数据库)。env 可覆盖;opts.clock 注入时钟 */
async function startServer({ env = {}, clock, dir } = {}) {
  dir = dir || tmpDir();
  const cfg = loadConfig({
    PORT: '0',
    DB_PATH: path.join(dir, 'scores.db'),
    BACKUP_DIR: path.join(dir, 'backups'),
    TRUST_PROXY: '1',
    ...env,
  });
  const app = createApp(cfg, { clock });
  const port = await app.listen();
  const url = `http://127.0.0.1:${port}`;
  const seen = []; // 记录所有响应的 content-type 与状态(S-11)
  async function req(method, p, { body, raw, headers = {}, ip } = {}) {
    const h = { 'X-Real-IP': ip || nextIp(), ...headers };
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      if (!h['Content-Type']) h['Content-Type'] = 'application/json';
    }
    const res = await fetch(url + p, { method, headers: h, body: payload });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    seen.push({ path: p, status: res.status, type: res.headers.get('content-type'), text });
    return { status: res.status, json, text, headers: res.headers };
  }
  return {
    url, dir, app, cfg, seen, req,
    get: (p, o) => req('GET', p, o),
    post: (body, o) => req('POST', '/api/scores', { body, ...o }),
    top: async (mode) => (await req('GET', '/api/leaderboard?mode=' + mode)).json.entries,
    count: (mode) => app.db.prepare('SELECT COUNT(*) c FROM scores' + (mode ? ' WHERE mode = ?' : '')).get(...(mode ? [mode] : [])).c,
    close: () => app.close(),
    cleanup: async () => {
      await app.close().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const valid = (o = {}) => ({ mode: 'solo', name: '矿工', score: 100, rounds: 3, character: 'laojin', version: 2, ...o });

function insertRows(db, rows) {
  const st = db.prepare(
    'INSERT INTO scores (mode,name,score,rounds,character,created_at,version) VALUES (@mode,@name,@score,@rounds,@character,@created_at,@version)'
  );
  db.transaction((rs) => rs.forEach((r, i) => st.run({ mode: 'solo', name: 'P' + i, rounds: 2, character: 'laojin', created_at: 1_700_000_000_000 + i, version: 2, ...r })))(rows);
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

// 可复现伪随机
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { ROOT, tmpDir, startServer, valid, insertRows, freePort, mulberry, nextIp };
