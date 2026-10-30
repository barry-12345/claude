'use strict';
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** 读取环境变量,返回配置对象。参数 env 可注入(测试用)。 */
function loadConfig(env = process.env) {
  const rel = (p, d) => path.resolve(ROOT, p && p.length ? p : d);
  const port = env.PORT === undefined || env.PORT === '' ? 8787 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 无效: ' + env.PORT);
  return {
    port,
    host: '127.0.0.1',
    dbPath: rel(env.DB_PATH, './data/scores.db'),
    adminPassword: env.ADMIN_PASSWORD || '',
    backupDir: rel(env.BACKUP_DIR, './backups'),
    trustProxy: env.TRUST_PROXY === '1',
    corsOrigins: (env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
    serveStatic: env.SERVE_STATIC ? path.resolve(env.SERVE_STATIC) : '',
    offsiteCmd: env.OFFSITE_CMD || '',
    badwordsPath: env.BADWORDS_PATH ? path.resolve(env.BADWORDS_PATH) : path.join(ROOT, 'badwords.txt'),
    migrationsDir: path.join(ROOT, 'migrations'),
  };
}

module.exports = { loadConfig, ROOT };
