/* ==== LEADERBOARD CLIENT BEGIN (黄金矿工 在线排行榜客户端,无依赖) ====
 * 粘贴进 index.html 的 <script> 里即可;也可在 Node 里 require(用于测试)。
 * 约定:
 *  - 所有函数返回 Promise,且永远 resolve、不 reject、不抛出、不调用 console.error。
 *  - 网络不可用/超时/服务器 5xx/file:// 无 ?api= → 解析为 { ok:false, unavailable:true }。
 *  - API 地址:?api=... 优先,其次 window.GOLDMINER_API,默认同源('')。
 */
const LB_TIMEOUT_MS_DEFAULT = 4000;
const LB_TOP_N = 20;
const LB_ACCEPT_VERSION = 2; // 只有规则版本 2 的成绩才上榜(规则 1 的成绩不提交)
const LB_MESSAGES = {
  bad_word: '名字包含不合适的词',
  bad_name: '名字不合法(1–12 个字符,不能含特殊字符)',
  rate_limited: '提交太频繁,请稍后再试',
  not_qualified: '很遗憾,刚刚被别人超过了',
  unavailable: '暂时无法连接排行榜',
  too_large: '提交内容过大',
  bad_mode: '模式不正确',
  bad_score: '分数不正确',
  bad_rounds: '关数不正确',
  bad_character: '角色不正确',
  bad_version: '版本不正确',
};
// 状态:供界面读取(__game.lb.state)。status: idle | loading | ok | unavailable
const lbState = { solo: { status: 'idle', entries: [] }, versus: { status: 'idle', entries: [] } };
const lbCfg = { base: undefined, timeoutMs: LB_TIMEOUT_MS_DEFAULT }; // base 为 undefined 表示按页面地址推断

/** 测试/特殊场景用:覆盖 API 地址和超时 */
function lbConfigure(o) {
  if (o && 'base' in o) lbCfg.base = o.base;
  if (o && o.timeoutMs) lbCfg.timeoutMs = o.timeoutMs;
}

/** 当前 API 基地址;返回 null 表示"暂时无法连接"(例如 file:// 且没有 ?api=) */
function lbBase() {
  if (lbCfg.base !== undefined) return lbCfg.base;
  try {
    if (typeof location === 'undefined') return null;
    const q = new URLSearchParams(location.search).get('api');
    if (q !== null) return q.replace(/\/+$/, '');
    const g = typeof window !== 'undefined' && window.GOLDMINER_API;
    if (g) return String(g).replace(/\/+$/, '');
    if (location.protocol === 'file:') return null;
    return '';
  } catch (e) {
    return null;
  }
}

const LB_UNAVAILABLE = () => ({ ok: false, unavailable: true, error: 'unavailable', message: LB_MESSAGES.unavailable });

/** 带超时的 fetch,解析为 { status, json, headers } 或 null(网络错误/超时/解析失败) */
async function lbRequest(path, init) {
  try {
    const base = lbBase();
    if (base === null || typeof fetch !== 'function') return null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), lbCfg.timeoutMs);
    let hard;
    try {
      const res = await Promise.race([
        fetch(base + path, Object.assign({}, init, ctl ? { signal: ctl.signal } : {})),
        new Promise((_, rej) => { hard = setTimeout(() => rej(new Error('timeout')), lbCfg.timeoutMs + 50); }),
      ]);
      let json = null;
      try {
        json = await res.json();
      } catch (e) {
        json = null;
      }
      return { status: res.status, json, retryAfter: Number(res.headers.get('Retry-After')) || 0 };
    } finally {
      clearTimeout(timer);
      clearTimeout(hard);
    }
  } catch (e) {
    return null;
  }
}

/** 取某模式前 20。成功 { ok:true, mode, entries };失败 { ok:false, unavailable:true } */
async function lbFetchTop(mode) {
  const st = lbState[mode] || (lbState[mode] = { status: 'idle', entries: [] });
  st.status = 'loading';
  const r = await lbRequest('/api/leaderboard?mode=' + encodeURIComponent(mode), { method: 'GET' });
  if (!r || r.status !== 200 || !r.json || !Array.isArray(r.json.entries)) {
    st.status = 'unavailable';
    return LB_UNAVAILABLE();
  }
  st.status = 'ok';
  st.entries = r.json.entries;
  return { ok: true, mode, entries: r.json.entries };
}

/** 纯函数:给定榜单(前 20)和分数,返回 { qualifies, rank, cutoff }。同分时已有记录在前。 */
function lbRankIn(entries, score) {
  let ahead = 0;
  for (const e of entries) if (e.score >= score) ahead++;
  const rank = 1 + ahead;
  const cutoff = entries.length >= LB_TOP_N ? entries[LB_TOP_N - 1].score : 0;
  return { qualifies: rank <= LB_TOP_N, rank, cutoff };
}

/**
 * 用最近一次 lbFetchTop(mode) 的本地榜单判断是否上榜(同步)。
 * 没有成功取过榜单 → { known:false, qualifies:false }(此时不要弹名字窗口)。
 */
function lbQualifies(mode, score) {
  const st = lbState[mode];
  if (!st || st.status !== 'ok' || !Number.isFinite(score) || score < 0) {
    return { known: false, qualifies: false, rank: 0, cutoff: 0 };
  }
  return Object.assign({ known: true }, lbRankIn(st.entries, score));
}

/**
 * 集成方只需调用这一个:规则版本合格 且 本地榜单判断能进前 20。
 * 返回 { offer, known, qualifies, rank, cutoff };offer 为 true 才弹名字窗口。
 */
function lbShouldOffer(mode, version, score) {
  const q = lbQualifies(mode, score);
  return Object.assign({ offer: version === LB_ACCEPT_VERSION && q.known && q.qualifies }, q);
}

/** 名字截断到 12 个码点(按 Unicode 码点,不是 UTF-16 单元) */
function lbClampName(s) {
  const a = Array.from(String(s == null ? '' : s));
  return { name: a.slice(0, 12).join(''), truncated: a.length > 12 };
}

/**
 * 提交成绩。resolve:
 *  { ok:true, id, rank }
 *  { ok:false, reason:'not_qualified', cutoff, message }
 *  { ok:false, error:'bad_word'|'bad_name'|'rate_limited'|..., status, message, retryAfter? }
 *  { ok:false, unavailable:true, message }   // 网络错误/超时/5xx
 */
async function lbSubmit(p) {
  if (!p || p.version !== LB_ACCEPT_VERSION) {
    return { ok: false, error: 'bad_version', status: 0, message: LB_MESSAGES.bad_version }; // 不发请求
  }
  const body = {
    mode: p && p.mode,
    name: p && p.name,
    score: p && p.score,
    rounds: p && p.rounds,
    character: p && p.character,
    version: p && p.version,
  };
  let payload;
  try {
    payload = JSON.stringify(body);
  } catch (e) {
    return { ok: false, error: 'bad_json', status: 400, message: '提交内容不正确' };
  }
  const r = await lbRequest('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  });
  if (!r || !r.json || typeof r.json !== 'object' || r.status >= 500) return LB_UNAVAILABLE();
  const j = r.json;
  if (r.status === 201 && j.ok) {
    if (lbState[body.mode]) lbState[body.mode].status = 'idle'; // 本地榜单已过期,需要重新拉取
    return { ok: true, id: j.id, rank: j.rank };
  }
  if (r.status === 200 && j.ok === false && j.reason === 'not_qualified') {
    return { ok: false, reason: 'not_qualified', cutoff: j.cutoff, message: LB_MESSAGES.not_qualified };
  }
  const code = j.error || 'unknown';
  const out = { ok: false, error: code, status: r.status, message: LB_MESSAGES[code] || '提交失败,请稍后再试' };
  if (r.retryAfter) out.retryAfter = r.retryAfter;
  return out;
}

/** 日期 YYYY-MM-DD(本地时区) */
function lbDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
/* ==== LEADERBOARD CLIENT END ==== */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    lbConfigure, lbBase, lbFetchTop, lbQualifies, lbShouldOffer, LB_ACCEPT_VERSION, lbRankIn, lbSubmit, lbClampName, lbDate, lbState, LB_MESSAGES, LB_TOP_N,
  };
}
