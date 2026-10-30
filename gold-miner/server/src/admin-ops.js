'use strict';
// 管理操作:接口和命令行工具共用,效果完全相同。
const fs = require('node:fs');
const path = require('node:path');
const { COLS, ORDER } = require('./db');
const { normalizeName, hasBadWord, MODES } = require('./validate');

class OpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}
function stamp(d = new Date()) {
  return (
    d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + '-' +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds())
  );
}

function makeAdminOps(db, { backupDir, badwords }) {
  const list = (mode, limit = 100) => {
    if (mode && !MODES.includes(mode)) throw new OpError(400, 'bad_mode');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new OpError(400, 'bad_limit');
    const rows = mode
      ? db.prepare(`SELECT ${COLS} FROM scores WHERE mode = ? ORDER BY ${ORDER} LIMIT ?`).all(mode, limit)
      : db.prepare(`SELECT ${COLS} FROM scores ORDER BY mode, ${ORDER} LIMIT ?`).all(limit);
    return rows;
  };

  const del = (id) => {
    if (!Number.isInteger(id) || id < 1) throw new OpError(400, 'bad_id');
    const r = db.prepare('DELETE FROM scores WHERE id = ?').run(id);
    if (!r.changes) throw new OpError(404, 'not_found');
    return { deleted: 1 };
  };

  const rename = (id, rawName) => {
    if (!Number.isInteger(id) || id < 1) throw new OpError(400, 'bad_id');
    const n = normalizeName(rawName);
    if (!n.ok) throw new OpError(400, n.error);
    if (hasBadWord(n.name, badwords)) throw new OpError(400, 'bad_word');
    const r = db.prepare('UPDATE scores SET name = ? WHERE id = ?').run(n.name, id);
    if (!r.changes) throw new OpError(404, 'not_found');
    return { id, name: n.name };
  };

  const checkVersion = (v) => {
    if (!Number.isInteger(v) || v < 1 || v > 1000) throw new OpError(400, 'bad_version');
  };

  const archive = (version, mode) => {
    checkVersion(version);
    if (mode !== undefined && mode !== null && !MODES.includes(mode)) throw new OpError(400, 'bad_mode');
    fs.mkdirSync(backupDir, { recursive: true });
    const tag = mode || 'all';
    let file;
    // 导出和删除放在同一个事务里:写文件失败就不会删数据
    const run = db.transaction(() => {
      const rows = mode
        ? db.prepare(`SELECT ${COLS} FROM scores WHERE version = ? AND mode = ? ORDER BY ${ORDER}`).all(version, mode)
        : db.prepare(`SELECT ${COLS} FROM scores WHERE version = ? ORDER BY mode, ${ORDER}`).all(version);
      const base = `archive-${tag}-v${version}-${stamp()}`;
      for (let i = 0; ; i++) {
        file = path.join(backupDir, base + (i ? '-' + i : '') + '.json');
        try {
          fs.writeFileSync(file, JSON.stringify(rows, null, 2), { encoding: 'utf8', flag: 'wx' });
          break;
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
        }
      }
      const r = mode
        ? db.prepare('DELETE FROM scores WHERE version = ? AND mode = ?').run(version, mode)
        : db.prepare('DELETE FROM scores WHERE version = ?').run(version);
      return r.changes;
    });
    const n = run.immediate();
    return { archived: n, file };
  };

  const clear = ({ mode, version, confirm }) => {
    if (confirm !== true) throw new OpError(400, 'confirm_required');
    if (!MODES.includes(mode)) throw new OpError(400, 'bad_mode');
    if (version !== undefined && version !== null) checkVersion(version);
    const r =
      version === undefined || version === null
        ? db.prepare('DELETE FROM scores WHERE mode = ?').run(mode)
        : db.prepare('DELETE FROM scores WHERE mode = ? AND version = ?').run(mode, version);
    return { cleared: r.changes };
  };

  return { list, del, rename, archive, clear };
}

module.exports = { makeAdminOps, OpError };
