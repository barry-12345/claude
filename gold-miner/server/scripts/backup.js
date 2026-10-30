#!/usr/bin/env node
'use strict';
// 在线备份:SQLite backup API(不是直接复制正在使用的文件)+ integrity_check + 保留期清理 + 可选异地上传。
//   node scripts/backup.js [--db 路径] [--out 目录] [--keep-days 30] [--now ISO时间或毫秒]
// 默认值来自环境变量 DB_PATH / BACKUP_DIR / OFFSITE_CMD。
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const Database = require('better-sqlite3');
const { loadConfig } = require('../src/config');

const pad = (n) => String(n).padStart(2, '0');
function stampUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

async function runBackup({ db: dbPath, out, keepDays = 30, now = Date.now(), offsiteCmd = '', log = console.log }) {
  if (!fs.existsSync(dbPath)) throw new Error('数据库不存在: ' + dbPath);
  fs.mkdirSync(out, { recursive: true });
  let dest;
  const base = path.join(out, 'scores-' + stampUtc(now));
  for (let i = 0; ; i++) {
    dest = base + (i ? '-' + i : '') + '.db';
    if (!fs.existsSync(dest)) break;
  }
  const src = new Database(dbPath, { fileMustExist: true });
  src.pragma('busy_timeout = 5000');
  try {
    await src.backup(dest); // 在线备份:写入可以继续
  } finally {
    src.close();
  }
  const copy = new Database(dest, { readonly: true });
  let check;
  let rows;
  try {
    check = copy.pragma('integrity_check', { simple: true });
    rows = copy.prepare('SELECT COUNT(*) c FROM scores').get().c;
  } finally {
    copy.close();
  }
  if (check !== 'ok') {
    throw new Error('备份校验失败(integrity_check=' + check + '): ' + dest);
  }
  log(`备份完成: ${dest} (${rows} 行, integrity_check=ok)`);

  // 保留期清理(不会删除刚做的这个)
  const cutoff = now - keepDays * 86400_000;
  const removed = [];
  for (const f of fs.readdirSync(out)) {
    if (!/^scores-.*\.db$/.test(f)) continue;
    const p = path.join(out, f);
    if (p === dest) continue;
    if (fs.statSync(p).mtimeMs < cutoff) {
      fs.unlinkSync(p);
      removed.push(f);
    }
  }
  if (removed.length) log('已删除过期备份: ' + removed.join(', '));

  if (offsiteCmd) {
    try {
      cp.execSync(offsiteCmd.split('{file}').join(shq(dest)), { stdio: 'inherit', timeout: 10 * 60_000 });
      log('异地上传完成');
    } catch (e) {
      log('警告: 异地上传失败(本地备份不受影响): ' + e.message);
    }
  }
  return { file: dest, rows, removed };
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error('未知参数: ' + argv[i]);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

async function main(argv) {
  const a = parseArgs(argv);
  const cfg = loadConfig();
  let now = Date.now();
  if (a.now !== undefined) {
    now = /^\d+$/.test(a.now) ? Number(a.now) : Date.parse(a.now);
    if (!Number.isFinite(now)) throw new Error('--now 无效: ' + a.now);
  }
  const keepDays = a['keep-days'] === undefined ? 30 : Number(a['keep-days']);
  if (!(keepDays > 0)) throw new Error('--keep-days 无效');
  return runBackup({
    db: a.db ? path.resolve(a.db) : cfg.dbPath,
    out: a.out ? path.resolve(a.out) : cfg.backupDir,
    keepDays,
    now,
    offsiteCmd: cfg.offsiteCmd,
  });
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error('备份失败: ' + e.message);
    process.exit(1);
  });
}
module.exports = { runBackup };
