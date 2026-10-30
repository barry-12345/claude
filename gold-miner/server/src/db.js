'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const TOP_N = 20;
const KEEP_N = 100;
const COLS = 'id, mode, name, score, rounds, character, created_at, version';
const ORDER = 'score DESC, created_at ASC, id ASC';

/** 打开数据库:自动建目录、开 WAL、执行迁移(PRAGMA user_version 记录版本) */
function openDb(dbPath, migrationsDir) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  migrate(db, migrationsDir);
  return db;
}

function migrate(db, dir) {
  const files = fs
    .readdirSync(dir)
    .map((f) => /^(\d+)_.*\.sql$/.exec(f))
    .filter(Boolean)
    .map((m) => ({ v: Number(m[1]), f: m[0] }))
    .sort((a, b) => a.v - b.v);
  let cur = db.pragma('user_version', { simple: true });
  for (const { v, f } of files) {
    if (v <= cur) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma('user_version = ' + v);
    }).immediate();
    cur = v;
  }
}

function makeQueries(db) {
  const top = db.prepare(`SELECT ${COLS} FROM scores WHERE mode = ? ORDER BY ${ORDER} LIMIT ?`);
  const countGE = db.prepare('SELECT COUNT(*) AS c FROM scores WHERE mode = ? AND score >= ?');
  const cutoffQ = db.prepare(`SELECT score FROM scores WHERE mode = ? ORDER BY ${ORDER} LIMIT 1 OFFSET ${TOP_N - 1}`);
  const ins = db.prepare(
    'INSERT INTO scores (mode, name, score, rounds, character, created_at, version) VALUES (@mode,@name,@score,@rounds,@character,@created_at,@version)'
  );
  const prune = db.prepare(
    `DELETE FROM scores WHERE mode = ? AND id NOT IN (SELECT id FROM scores WHERE mode = ? ORDER BY ${ORDER} LIMIT ${KEEP_N})`
  );

  function leaderboard(mode, limit = TOP_N) {
    return top.all(mode, limit).map((r, i) => ({ rank: i + 1, ...r }));
  }

  // BEGIN IMMEDIATE:先拿写锁再数名次,多进程(如命令行工具)并发时也安全
  const submit = db.transaction((v, nowMs) => {
    const rank = 1 + countGE.get(v.mode, v.score).c;
    if (rank > TOP_N) {
      const c = cutoffQ.get(v.mode);
      return { ok: false, reason: 'not_qualified', cutoff: c ? c.score : 0 };
    }
    const info = ins.run({ ...v, created_at: nowMs });
    prune.run(v.mode, v.mode);
    return { ok: true, id: Number(info.lastInsertRowid), rank };
  });

  return { leaderboard, submit: (v, nowMs) => submit.immediate(v, nowMs) };
}

module.exports = { openDb, makeQueries, TOP_N, KEEP_N, COLS, ORDER };
