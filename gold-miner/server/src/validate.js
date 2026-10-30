'use strict';
const fs = require('node:fs');

const MODES = ['solo', 'versus'];
const CHARACTERS = ['laojin', 'xiaozuan', 'dalixiong', 'shiguang', 'xunbao', 'baopo'];
const MAX_SCORE = 10_000_000;

// 控制字符与零宽/方向控制字符
const FORBIDDEN = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\uFEFF]',
  'u'
);

/** 规范化名字:NFC、去首尾空白、连续空白合并。返回 { ok, name } 或 { ok:false, error } */
function normalizeName(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'bad_name' };
  let s = raw.normalize('NFC');
  if (FORBIDDEN.test(s)) return { ok: false, error: 'bad_name' };
  s = s.replace(/\s+/gu, ' ').trim();
  const len = [...s].length;
  if (len < 1 || len > 12) return { ok: false, error: 'bad_name' };
  return { ok: true, name: s };
}

/** 去掉空白和标点(含符号)、转小写,用于敏感词匹配 */
function squash(s) {
  return s.normalize('NFKC').replace(/[\s\p{P}\p{S}\p{Z}\p{C}_]+/gu, '').toLowerCase();
}

function loadBadWords(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const w = squash(line);
    if (w) out.add(w);
  }
  return [...out];
}

function hasBadWord(name, badwords) {
  const s = squash(name);
  return badwords.some((w) => s.includes(w));
}

const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);

/** 校验整个提交。返回 { ok:true, value } 或 { ok:false, error } */
function validateSubmission(body, badwords) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'bad_json' };
  if (!MODES.includes(body.mode)) return { ok: false, error: 'bad_mode' };
  const n = normalizeName(body.name);
  if (!n.ok) return n;
  if (hasBadWord(n.name, badwords)) return { ok: false, error: 'bad_word' };
  if (!isInt(body.score) || body.score < 0 || body.score > MAX_SCORE) return { ok: false, error: 'bad_score' };
  if (!isInt(body.rounds) || body.rounds < 1 || body.rounds > 8) return { ok: false, error: 'bad_rounds' };
  if (!CHARACTERS.includes(body.character)) return { ok: false, error: 'bad_character' };
  if (!isInt(body.version) || body.version < 1 || body.version > 1000) return { ok: false, error: 'bad_version' };
  return {
    ok: true,
    value: {
      mode: body.mode,
      name: n.name,
      score: body.score,
      rounds: body.rounds,
      character: body.character,
      version: body.version,
    },
  };
}

module.exports = { MODES, CHARACTERS, MAX_SCORE, normalizeName, hasBadWord, loadBadWords, validateSubmission, squash };
