# 排行榜前端集成说明(给之后改 index.html 的 Builder)

服务端和 `leaderboard-client.js` 已经完成并测试。`index.html` 里的界面(名字输入窗口、排行榜屏幕、终局流程)**还没有做**,按 SPEC-phase3 §4 实现。本文说明怎么把客户端模块贴进去,以及还剩哪些界面工作。

## 1. 怎么粘贴

1. 打开 `server/client/leaderboard-client.js`,复制 `/* ==== LEADERBOARD CLIENT BEGIN` 到 `/* ==== LEADERBOARD CLIENT END ==== */` 之间(含这两行注释)的全部内容。**不要复制**文件最后的 `if (typeof module ...) module.exports` 那段(粘贴了也无害,浏览器里 `module` 未定义会被 `typeof` 守卫跳过)。
2. 粘贴到 `index.html` 现有 `<script>` 的**顶层**(游戏逻辑之前或之后均可,但要在使用它的代码执行之前),不要放进 IIFE 里,否则其它代码访问不到。
3. 命名空间:全部以 `lb` / `LB_` 开头,已确认与当前 `index.html` 没有冲突(`grep -n "\blb[A-Z_]\|LB_" index.html` 无结果)。贴之前再 grep 一次。
4. 暴露测试钩子(SPEC §5.3):
   ```js
   // 在已有的 window.__game 对象上
   __game.lb = { base: lbBase, state: lbState };
   ```
5. 模块没有任何外部依赖,不会修改 DOM、不监听键盘、不调用 `console.error`,所有 Promise 都只会 resolve。

## 2. API 摘要

| 函数 | 说明 |
|---|---|
| `lbBase()` | 当前 API 基地址。`?api=` 优先,其次 `window.GOLDMINER_API`,默认 `''`(同源)。`file://` 且没有 `?api=` 时返回 `null`(= 暂时无法连接) |
| `lbFetchTop(mode)` | `GET /api/leaderboard`。成功 `{ ok:true, mode, entries }`;失败 `{ ok:false, unavailable:true, message:'暂时无法连接排行榜' }`。同时更新 `lbState[mode] = { status:'loading'→'ok'|'unavailable', entries }` |
| `lbQualifies(mode, score)` | **同步**,用最近一次成功的 `lbFetchTop(mode)` 结果判断:`{ known, qualifies, rank, cutoff }`。`known:false`(从未取到榜单)时 `qualifies` 恒为 `false`,此时显示"暂时无法连接排行榜"而不是弹窗 |
| `lbSubmit({mode,name,score,rounds,character,version})` | `POST /api/scores`。见下表 |
| `lbShouldOffer(mode, version, score)` | **同步**,版本检查 + `lbQualifies`:`{ offer, known, qualifies, rank, cutoff }`,`offer` 为真才弹名字窗口 |
| `lbClampName(s)` | 按码点截断到 12,返回 `{ name, truncated }`,输入框 `input` 事件里用,`truncated` 为真时提示"最多 12 个字符" |
| `lbDate(ms)` | 本地时区 `YYYY-MM-DD` |
| `LB_MESSAGES` | 错误码 -> 中文提示 |
| `lbConfigure({base, timeoutMs})` | 测试用,通常不调用 |

`lbSubmit` 的结果(永远 resolve):

| 结果 | 界面应显示 |
|---|---|
| `{ ok:true, id, rank }` | "上榜成功!第 N 名",2 秒后关闭;记住 `id` 用来高亮 |
| `{ ok:false, reason:'not_qualified', cutoff }` | "很遗憾,刚刚被别人超过了"(`message` 已是该文案),然后关闭 |
| `{ ok:false, error:'bad_word' }` | "名字包含不合适的词"(窗口不关,可改名重交) |
| `{ ok:false, error:'bad_name' }` | `message`(名字不合法) |
| `{ ok:false, error:'rate_limited', retryAfter }` | "提交太频繁,请稍后再试" |
| `{ ok:false, unavailable:true }` | "暂时无法连接排行榜" + "重试"按钮 |
| 其它 `{ ok:false, error, status, message }` | 直接显示 `message` |

榜单条目:`{ rank, id, name, score, rounds, character, created_at, version }`(`id` 是在规格之外多返回的,用来高亮"自己刚提交的那一行")。`character` 是 id(`laojin`…),显示时映射到中文名;`rounds === 8` 且是通关时显示"通关",否则"第 N 关"(与终局页一致,由前端判断)。

## 3. 需要在 index.html 里新做的界面

以下都是 **SPEC-phase3 §4** 的内容,这里只列要点和容易踩的坑。

### 3.1 终局判断(`G.screen` 进入 `'final'` 时)

- 只在 `solo` 和 `versus`;合作模式**不发任何 `/api/` 请求**。
- 只处理 `G.final.version === 2`(规则 1 的成绩不提交;模块里 `LB_ACCEPT_VERSION = 2`,`lbSubmit` 对其它版本不发请求)。
- 流程:`await lbFetchTop(mode)` → 失败则终局页显示"暂时无法连接排行榜",不弹窗 → 成功则依次(对战先 P1 后 P2)用 `lbQualifies(mode, 分数)`;`qualifies` 的才弹名字窗口;没进的在终局页显示"未进入前 20(第 20 名 $50,000)"(`cutoff` 就是第 20 名分数)。
- 提交体:`{ mode, name, score: G.final.scores[i].score, rounds: G.final.scores[i].rounds, character: CHARS[G.final.scores[i].char].id, version: G.final.version }`。
- 对战中前一个窗口关闭后,**重新** `lbFetchTop` 再判断下一位也行(P1 提交成功后榜单变了),但规格允许直接用同一份本地榜;推荐重新取,避免 P2 误判。
- 所有窗口关闭前,终局页的空格 / Esc 不起作用;全部关闭后恢复(F-06 要求被挤掉后仍可用空格重开)。

### 3.2 名字输入窗口(DOM 层,盖在 canvas 上)

- 真实的 `<input type="text">`(不要用 canvas 假输入),`font-size ≥ 20px`,`maxlength` **不要**设(会和输入法冲突),长度用 `lbClampName` 在 `input` 事件里按码点截断;预填 `localStorage['goldminer.lastName']`(try/catch 包起来),`focus()`;提交成功后写回。
- 两个按钮"提交"/"跳过";Esc = 跳过。
- **输入法安全**:
  ```js
  let composing = false;
  input.addEventListener('compositionstart', () => (composing = true));
  input.addEventListener('compositionend', () => (composing = false));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !composing && !e.isComposing && e.keyCode !== 229) submit();
    else if (e.key === 'Escape') skip();
  });
  ```
  F-02 会派发 `compositionstart` 再派发 `isComposing:true` 的 Enter,要求**不发 POST**;`compositionend` 之后的 Enter 才提交。
- **屏蔽游戏按键**:全局 `keydown` 处理器的**第一行**:
  ```js
  if (G.nameEntry && e.target && e.target.tagName === 'INPUT') return; // 不 preventDefault,不进 handleKey
  if (G.nameEntry) return;                                              // 窗口外的按键一律忽略(Esc 由 input 自己的处理器负责)
  ```
  这样 S / W / 方向键 / 空格 / P / M 在 input 里都能正常输入(F-01 会输入 `sw `)。注意 `keyup` 处理器也要做同样的判断。同时检查有没有 `window.addEventListener('blur'...)` 暂停逻辑、触摸层(`touchstart` 的 `preventDefault`)会不会吞掉对 input 的点击——触摸 Builder 加的手柄/按钮层在 `G.nameEntry` 期间也必须让路。
- `G.nameEntry`:窗口状态对象(含 `player`、`score`、`mode`、`status`),关闭后设为 `null`。
- 渲染用 `textContent`,**不要**用 `innerHTML` 拼名字。

#### 手机 / mobile

- **iOS 不会在非用户手势里弹出键盘**:终局页是 `await lbFetchTop()` 之后才弹窗口,此时对 `input.focus()` 的调用不算用户手势,iOS Safari 不会弹键盘(桌面和多数安卓可以)。做法:窗口里显示提示"点输入框输入",并仍然调用 `focus()`(桌面自动聚焦);触屏设备上不要依赖自动弹出键盘。另一种做法是先让玩家点一个"上榜了!点击输入名字"按钮(这次点击里再 `focus()`)。
- **键盘遮挡**:键盘弹出后用 `visualViewport` 保持窗口可见:`visualViewport.addEventListener('resize', fit)`,在 `fit` 里按 `visualViewport.height` 调整窗口位置/高度,并在 `focus` 时 `input.scrollIntoView({block:'center'})`。
- **input 属性**:`enterkeyhint="done"`、`autocomplete="off"`、`autocapitalize="off"`,另加 `autocorrect="off"`、`spellcheck="false"`、`inputmode="text"`。
- **触摸控制层让路**:`G.nameEntry` 不为空时,触摸 Builder 加的虚拟按键/手势层必须不处理(也不 `preventDefault`)任何触摸事件,否则点不进输入框;窗口关闭后恢复。
- 版本检查:用 `lbShouldOffer(mode, G.final.version, score)` 一次判断"版本为 2 且能进前 20";`lbSubmit` 对 `version !== 2`(`LB_ACCEPT_VERSION`)直接返回 `{ok:false,error:'bad_version'}` 且不发请求。

### 3.3 排行榜屏幕(`G.screen = 'leaderboard'`)

- 主菜单按 **L** 进入,主菜单底部提示加"L 排行榜"。
- "单人 / 对战"两个标签,A/D 或 ←/→ 切换,Esc 或空格返回主菜单。切换时 `lbFetchTop(tab)`;进入时先显示"加载中…",失败显示"暂时无法连接排行榜",空榜显示"还没有人上榜,快来争第一!"。
- 状态存 `G.lbView = { tab, status, entries }`。
- 每行:名次、名字、`$分数`、关数、角色中文名、`lbDate(created_at)`。名字用 canvas `fillText` 画,超宽用省略号截断(先 `ctx.measureText` 再裁),不得与其它列重叠(F-07 会截图检查 12 个汉字的长名字)。
- 每页恰好 20 行(服务端最多返回 20 条)。刚提交的那一行(`id === 最近一次提交返回的 id`)高亮。

### 3.4 其它

- `__game.forceGameEnd({ mode, scores:[{score, rounds, char}] })`:构造 `G.final`(`version: RULE_VERSION`)并走正常终局流程,只用于测试。
- 页面里**不得**出现未处理的 rejection;除浏览器自己的网络失败日志外不能有 `console.error`(F-05)。`leaderboard-client.js` 已保证这一点,新代码里的 `await` 也要 try/catch 或只 await 本模块的函数。
- 手动试服务:`cd server && SERVE_STATIC=.. PORT=8787 node src/server.js`,然后浏览器打开 `http://127.0.0.1:8787/`(同源,排行榜可用);或 `index.html?api=http://127.0.0.1:8787` 配合 `CORS_ORIGIN`。测试用 `TRUST_PROXY=0`(默认)时每个 IP 每分钟最多 5 次提交。

## 4. 前端验收(F-xx)与本阶段的关系

F-01 … F-11 都依赖 `index.html` 里的界面,留待集成后用 Playwright 跑(见 `SPEC-phase3.md` §6-C)。本目录的 `server/test/client.test.js` 已经在 Node 和 Chromium 里验证了**客户端模块本身**(同源、`?api=`、跨源 CORS、服务器不可用、`file://`、超时),集成时可以直接复用 `server/test/helpers.js` 的 `startServer()` 启动带夹具的测试服务。
