#!/usr/bin/env node
'use strict';
// 管理命令行工具:直接操作 DB_PATH,效果与 /api/admin/* 相同。
//   node admin.js list [--mode solo|versus] [--limit 100]
//   node admin.js delete <id>
//   node admin.js rename <id> <新名字>
//   node admin.js archive --version 2 [--mode solo]
//   node admin.js clear --mode versus [--version 2] --yes
const { loadConfig } = require('./src/config');
const { openDb } = require('./src/db');
const { loadBadWords } = require('./src/validate');
const { makeAdminOps, OpError } = require('./src/admin-ops');

const USAGE = `用法:
  node admin.js list [--mode solo|versus] [--limit 100]
  node admin.js delete <id>
  node admin.js rename <id> <新名字>
  node admin.js archive --version <规则版本> [--mode solo|versus]
  node admin.js clear --mode solo|versus [--version <规则版本>] --yes
数据库位置由环境变量 DB_PATH 指定,归档文件写入 BACKUP_DIR。`;

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') opt.yes = true;
    else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
    else pos.push(a);
  }
  return { pos, opt };
}

function toInt(v) {
  if (v === undefined) return undefined;
  return /^\d+$/.test(String(v)) ? Number(v) : NaN;
}

function main(argv, env = process.env, out = console.log) {
  const { pos, opt } = parseArgs(argv);
  const cmd = pos[0];
  if (!['list', 'delete', 'rename', 'archive', 'clear'].includes(cmd)) {
    console.error(USAGE);
    return 2;
  }
  const cfg = loadConfig(env);
  const db = openDb(cfg.dbPath, cfg.migrationsDir);
  const ops = makeAdminOps(db, { backupDir: cfg.backupDir, badwords: loadBadWords(cfg.badwordsPath) });
  try {
    let res;
    if (cmd === 'list') {
      const rows = ops.list(opt.mode, opt.limit === undefined ? 100 : toInt(opt.limit));
      for (const r of rows) {
        out(`${r.id}\t${r.mode}\t${r.score}\t${r.name}\t第${r.rounds}关\t${r.character}\tv${r.version}\t${new Date(r.created_at).toISOString()}`);
      }
      return 0;
    } else if (cmd === 'delete') res = ops.del(toInt(pos[1]));
    else if (cmd === 'rename') res = ops.rename(toInt(pos[1]), pos.slice(2).join(' '));
    else if (cmd === 'archive') res = ops.archive(toInt(opt.version), opt.mode);
    else res = ops.clear({ mode: opt.mode, version: toInt(opt.version), confirm: opt.yes === true });
    out(JSON.stringify(res));
    return 0;
  } catch (e) {
    if (e instanceof OpError) {
      console.error('失败: ' + e.code + (e.code === 'confirm_required' ? '(请加 --yes 确认)' : ''));
      return 1;
    }
    throw e;
  } finally {
    db.close();
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main };
