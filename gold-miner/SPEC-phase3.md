# 黄金矿工 · 第三阶段:在线排行榜 — 实现规格 (SPEC-phase3) · 已获用户批准

> 状态:**已获用户批准**(用户原话:"ok, sounds good. implement all these")。
> 前提:第二阶段已完成并验收,`G.final.scores` 已存在(每项含 `score / rounds / char`,`G.final.version` 为规则版本)。本规格把分数当作**通用非负整数**处理,不依赖具体计分细节。
> 读者:Builder(实现)、Evaluator(验收)。本文件是唯一依据。

---

## 0. 已确定的决策

| 决策 | 结论 |
|---|---|
| 榜单 | 两个全球榜:**单人 (solo)**、**对战 (versus)**。合作不上榜。没有难度分级 |
| 上榜条件 | 终局得分能进入该模式当前全球**前 20** 时,才弹出输入名字的窗口并记录。对战中两名玩家**分别判断**,可能两人都上榜,各自输入名字 |
| 分数 | 终局金币(`G.final.scores[i].score`)。同分时 `created_at` 早的排前面(再同则 `id` 小的排前面) |
| 同时存储 | 到达关数 `rounds`、角色 `character`,在榜单上显示 |
| 反作弊 | 只做基本合法性检查:名字 ≤ 12 个字符(允许中文)、简单敏感词过滤、限流、分数为非负整数 |
| 托管 | 中国大陆能访问,**不用 Cloudflare**。目标是通用 Linux VPS(Ubuntu 22.04/24.04,通常是香港区、免备案),代码里不写任何地区相关内容 |
| 架构 | Nginx 反向代理,同一域名下提供静态游戏和 `/api`;HTTPS 用 Let's Encrypt certbot |
| 后端 | Node.js LTS(22.x)+ SQLite(`better-sqlite3`),systemd 服务 |
| 数据 | 单表 `scores`,每个模式只保留前 100 |
| 备份 | 每天 cron 用 SQLite 在线备份,保留 30 天;另附异地上传(COS/OSS)的可选说明,不要求凭据 |
| 管理 | 密码保护(环境变量)的管理接口和命令行工具:删除、改名、按版本归档或清空 |

---

## 1. 目录与交付物

```
/home/user/gold-miner/
  index.html                 ← 前端改动(§4)
  server/
    package.json             ← 唯一运行时依赖 better-sqlite3;"engines": { "node": ">=22" };脚本 start / test
    src/server.js            ← 只用 node:http,手写小路由(不引入 Web 框架)
    src/db.js                ← 打开数据库、迁移、查询
    src/validate.js          ← 参数校验、名字规范化、敏感词过滤
    src/ratelimit.js         ← 内存令牌桶
    src/config.js            ← 读取环境变量
    admin.js                 ← 管理命令行工具
    scripts/backup.js        ← 在线备份 + 保留期清理(+ 可选异地上传)
    migrations/001_init.sql  ← 建表、建索引
    badwords.txt             ← 敏感词表(UTF-8,一行一个,中英都有,至少 50 条)
    deploy/deploy.sh         ← 一键部署
    deploy/update.sh         ← 更新游戏或服务端
    deploy/nginx.conf.tpl    ← Nginx 站点模板(占位符 __DOMAIN__ 等)
    deploy/goldminer.service ← systemd 单元模板
    deploy/goldminer-backup.cron
    test/                    ← node:test 服务端测试 + Playwright 端到端测试
    DEPLOY.md                ← 简体中文部署指南(面向非专业用户)
```

---

## 2. 后端

### 2.1 配置(环境变量,生产环境放在 `/etc/goldminer.env`)

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | 8787 | 只监听 `127.0.0.1` |
| `DB_PATH` | `./data/scores.db` | 自动创建目录 |
| `ADMIN_PASSWORD` | (空) | 为空时管理接口返回 404,即关闭 |
| `BACKUP_DIR` | `./backups` | |
| `TRUST_PROXY` | 0 | 为 1 时,只在请求来自 127.0.0.1 时才信任 `X-Real-IP` |
| `CORS_ORIGIN` | (空) | 为空时不发 CORS 头(只允许同源);本地测试可设成 `http://127.0.0.1:5173` 之类 |
| `SERVE_STATIC` | (空) | 开发和测试用:设成游戏目录时,由 Node 直接提供静态文件,方便同源测试。生产环境由 Nginx 提供 |
| `OFFSITE_CMD` | (空) | 可选:备份完成后执行的上传命令,`{file}` 替换为备份文件路径 |

### 2.2 数据模型(`migrations/001_init.sql`,用 `PRAGMA user_version` 记录迁移版本;启动时开启 WAL)

```sql
CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mode        TEXT    NOT NULL CHECK (mode IN ('solo','versus')),
  name        TEXT    NOT NULL,
  score       INTEGER NOT NULL CHECK (score >= 0),
  rounds      INTEGER NOT NULL CHECK (rounds BETWEEN 1 AND 8),
  character   TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,          -- 服务器时间,Unix 毫秒
  version     INTEGER NOT NULL           -- 规则版本(第二阶段为 2)
);
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (mode, score DESC, created_at);
```

排名顺序固定为 `ORDER BY score DESC, created_at ASC, id ASC`。

### 2.3 接口(所有响应都是 `application/json; charset=utf-8`,出错时不返回堆栈)

| 方法与路径 | 说明 |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/leaderboard?mode=solo\|versus` | `{ mode, entries: [{ rank, name, score, rounds, character, created_at, version }] }`,最多 20 条 |
| `POST /api/scores` | 请求体 `{ mode, name, score, rounds, character, version }`。成功返回 `201 { ok: true, id, rank }`;分数不够返回 `200 { ok: false, reason: 'not_qualified', cutoff }`,`cutoff` 是当前第 20 名的分数 |
| `/api/admin/*` | 见 §2.6 |

**入榜事务**(`better-sqlite3` 的 `db.transaction`,用 `BEGIN IMMEDIATE` 保证并发安全):
1. `rank = 1 + COUNT(*) WHERE mode = ? AND score >= ?`(同分时已有记录排在前面,新记录排后面)。
2. `rank > 20` → 返回 not_qualified,不写入。
3. 写入,`created_at = Date.now()`。
4. 删除该模式下排名第 100 名之后的记录。
5. 返回 `rank`。

### 2.4 校验(不通过返回 400 `{ ok: false, error: <code> }`)

| 字段 | 规则 | 错误码 |
|---|---|---|
| 请求体 | 必须是 JSON(`Content-Type: application/json`),≤ 2 KB | `bad_json` / 413 `too_large` / 415 `bad_type` |
| `mode` | `solo` 或 `versus` | `bad_mode` |
| `name` | 先 NFC 规范化,去掉首尾空白,连续空白合并成一个;长度按 Unicode 码点算 1–12;不允许控制字符和零宽字符(U+0000–001F、U+007F–009F、U+200B–200F、U+2028–202E、U+2060–206F、U+FEFF) | `bad_name` |
| 敏感词 | 去掉空白和标点、转小写后,若包含 `badwords.txt` 里的任何一条子串 | `bad_word` |
| `score` | 整数(`Number.isSafeInteger`),0 ≤ score ≤ 10,000,000 | `bad_score` |
| `rounds` | 整数 1–8 | `bad_rounds` |
| `character` | 属于 `laojin, xiaozuan, dalixiong, shiguang, xunbao, baopo` 之一 | `bad_character` |
| `version` | 整数 1–1000 | `bad_version` |

名字按原样参数化存储(防 SQL 注入),前端只按纯文本渲染。

### 2.5 限流(内存令牌桶,按客户端 IP)

- `POST /api/scores`:每 60 秒 5 次,每小时 30 次。超出返回 `429 { ok: false, error: 'rate_limited' }`,带 `Retry-After` 头(秒)。
- `GET`:每 60 秒 120 次。
- 管理接口认证失败:每 60 秒 10 次,超出返回 429。

### 2.6 管理

- 认证:请求头 `Authorization: Bearer <ADMIN_PASSWORD>`,用 `crypto.timingSafeEqual` 比较。缺少或错误返回 401。
- 接口:

| 操作 | 接口 |
|---|---|
| 查看 | `GET /api/admin/scores?mode=&limit=100` |
| 删除 | `DELETE /api/admin/scores/:id` |
| 改名 | `PATCH /api/admin/scores/:id`,请求体 `{ name }`,按 §2.4 校验 |
| 归档 | `POST /api/admin/archive`,请求体 `{ version, mode? }`:把匹配的行导出为 `BACKUP_DIR/archive-<mode\|all>-v<version>-<时间戳>.json`(UTF-8 JSON 数组),再从表里删除,返回 `{ archived: n, file }` |
| 清空 | `POST /api/admin/clear`,请求体 `{ mode, version?, confirm: true }`:不带 `confirm: true` 返回 400 |

- 命令行:`node admin.js <list|delete|rename|archive|clear> …` 直接操作 `DB_PATH`,效果与接口相同。例如 `node admin.js rename 12 新名字`、`node admin.js archive --version 2 --mode solo`、`node admin.js clear --mode versus --yes`。

### 2.7 备份

- `scripts/backup.js`:
  1. 用 `better-sqlite3` 的 `db.backup(dest)`(SQLite 在线备份 API,**不是**直接复制正在使用的文件)备份到 `BACKUP_DIR/scores-YYYYMMDD-HHMMSS.db`;
  2. 打开副本执行 `PRAGMA integrity_check`,结果必须是 `ok`,否则退出码非 0;
  3. 删除 `BACKUP_DIR` 里修改时间超过 30 天的 `scores-*.db`;
  4. 如果设置了 `OFFSITE_CMD`,执行它(失败只记日志,不影响本地备份)。
- cron:`/etc/cron.d/goldminer-backup`,每天 03:17 以 `goldminer` 用户运行,日志写到 `/var/log/goldminer-backup.log`。
- `DEPLOY.md` 写明恢复步骤:停服务 → 用备份覆盖 → 启服务;以及异地上传示例(腾讯云 COS 用 `coscli cp`,阿里云 OSS 用 `ossutil cp`),不附任何凭据。

---

## 3. 部署

### 3.1 `deploy/deploy.sh --domain <域名> --email <邮箱> [--dry-run]`

- 缺少参数时打印中文用法并以非 0 退出。脚本**可重复执行**(幂等)。`--dry-run` 只打印将要执行的每一步,不做修改。
- 步骤:
  1. 检查是 Ubuntu 22.04/24.04 和 root 权限;
  2. `apt` 安装 nginx、certbot、python3-certbot-nginx、sqlite3、ufw、build-essential;用 NodeSource 安装 Node 22 LTS;
  3. 创建系统用户 `goldminer`;
  4. 游戏复制到 `/var/www/goldminer/`,服务端复制到 `/opt/goldminer/server/`,执行 `npm ci --omit=dev`,数据放在 `/var/lib/goldminer/`,备份放在 `/var/backups/goldminer/`;
  5. 如果 `/etc/goldminer.env` 不存在,就生成它,`ADMIN_PASSWORD` 随机生成 24 位,**只打印这一次**,文件权限 600;
  6. 安装 systemd 单元(`User=goldminer`、`EnvironmentFile=/etc/goldminer.env`、`Environment=NODE_ENV=production`、`Restart=always`、`RestartSec=3`、`NoNewPrivileges=true`、`ProtectSystem=strict`、`ReadWritePaths=/var/lib/goldminer /var/backups/goldminer`),然后 enable 并 start;
  7. Nginx 站点:`root /var/www/goldminer`;`location /api/ { proxy_pass http://127.0.0.1:8787; proxy_set_header X-Real-IP $remote_addr; }`;开启 gzip;`index.html` 设置 `Cache-Control: no-cache`;加 `client_max_body_size 4k`;通过 `nginx -t` 后 reload;
  8. `certbot --nginx -d <域名> -m <邮箱> --agree-tos --redirect --non-interactive`(自动续期用 certbot 自带的 timer);
  9. ufw 放行 OpenSSH 和 "Nginx Full",然后启用;
  10. 安装备份 cron;
  11. 最后自检:`curl -fsS https://<域名>/api/health`,打印成功提示和后续步骤。
- `deploy/update.sh [--game-only|--server-only]`:同步文件;服务端更新时执行 `npm ci` 并重启服务;最后自检 health。

### 3.2 `DEPLOY.md`(简体中文,面向非专业用户)

必须包含以下章节:
1. 你需要准备什么(费用估算);
2. 购买香港 VPS(以腾讯云或阿里云国际站轻量服务器为例:选 Ubuntu 22.04/24.04,在安全组开放 22/80/443);
3. 购买域名并添加 DNS A 记录(说明生效时间,用 `ping` 和 `nslookup` 验证);
4. 用 SSH 登录服务器(Windows / macOS);
5. 一键部署(复制粘贴的命令,参数说明,怎么保存管理员密码);
6. 验证网站和排行榜;
7. 用 itdog.cn 测试国内访问(网站测速 / ping,怎么看结果,不通时怎么办);
8. 以后更新游戏;
9. 备份与恢复,可选的异地备份;
10. 管理员操作(删除、改名、归档的示例命令);
11. 常见问题(证书申请失败、80 端口被占、安全组没开、DNS 没生效、服务起不来时查看 `journalctl -u goldminer`)。

---

## 4. 前端(`index.html`)

1. **API 地址**:`LB_BASE = new URLSearchParams(location.search).get('api') ?? (window.GOLDMINER_API ?? '')`,默认同源。`file://` 打开且没有 `?api=` 时视为"暂时无法连接"。所有请求 4 秒超时(AbortController),所有 Promise 都 catch,**不得**出现未处理的 rejection,不得调用 `console.error`。
2. **终局判断**(只在单人和对战):
   - 进入 final 屏后先 `GET` 该模式前 20;
   - 对每名玩家(对战先 P1 后 P2)用本地数据判断:`rank = 1 + 本地榜单中 score >= 我的分数 的条数`,`rank ≤ 20` 就弹出名字输入窗口;
   - 如果榜单获取失败,在终局页显示"暂时无法连接排行榜",不弹窗口;
   - 合作模式不发任何排行榜请求。
3. **名字输入窗口**(DOM 层,盖在 canvas 上面):
   - 标题"玩家1 · 最终得分 $X · 可以进入前 20!"(单人不写"玩家1");
   - 一个真实的 `<input type="text">`,字号 ≥ 20px,预填 `localStorage['goldminer.lastName']`,自动聚焦;
   - 两个按钮"提交""跳过";
   - 长度按码点算,超过 12 个就截断并提示;
   - 输入法:`compositionstart` 到 `compositionend` 之间,以及 `e.isComposing` 或 `keyCode === 229` 时,回车不提交;
   - 窗口打开期间(`G.nameEntry` 不为空),全局 keydown **对发生在 input 上的事件直接 return**:不调用 `preventDefault`,也不进入 `handleKey`,所以 S/W/方向键/空格/P/M/Esc 都能正常输入,也不会触发游戏;窗口外的按键也一律被游戏忽略,只有 Esc 等于"跳过";
   - 提交后调用 POST:
     - 成功:显示"上榜成功!第 N 名",2 秒后关闭;
     - `not_qualified`:显示"很遗憾,刚刚被别人超过了";
     - 400:显示对应中文原因,`bad_word` 显示"名字包含不合适的词";
     - 429:显示"提交太频繁,请稍后再试";
     - 网络错误:显示"暂时无法连接排行榜",并提供"重试"按钮;
   - 对战两人都上榜时,依次弹出两个窗口;
   - 所有窗口关闭后,终局页的空格/Esc 才恢复作用。
4. **排行榜界面**:
   - 主菜单按 **L** 进入新屏幕 `G.screen = 'leaderboard'`,主菜单底部提示加上"L 排行榜";
   - 两个标签"单人 / 对战",用 A/D 或 ←/→ 切换;Esc 或空格返回主菜单;
   - 每行显示:名次、名字、得分 `$X`、关数("通关" 或 "第 N 关")、角色中文名、日期(YYYY-MM-DD,本地时区);
   - 状态提示:"加载中…" / "暂时无法连接排行榜" / "还没有人上榜,快来争第一!";
   - 名字用 canvas 纯文本绘制(不使用 innerHTML),长名字用省略号截断,不能和其它列重叠;
   - 自己刚提交的那一行高亮。
5. **提交内容**:`{ mode, name, score, rounds, character: CHARS[char].id, version: G.final.version }`。

---

## 5. 可测试性要求

1. 服务端:`cd server && npm test`(node:test)。测试在随机端口启动服务、使用临时数据库,测试结束后清理。
2. 端到端:`npm run e2e` 用 Playwright 启动服务(`SERVE_STATIC=..`,同源),浏览器在 `/opt/pw-browsers`。
3. 前端钩子:
   - `__game.lb = { base(), state }`;
   - `__game.forceGameEnd({ mode: 'solo'|'versus', scores: [{score, rounds, char}], })`:直接构造 `G.final` 并走正常的终局和排行榜流程,只用于测试;
   - `G.nameEntry`(当前窗口状态,或 null);
   - `G.lbView = { tab, status, entries }`。
4. 测试可以在服务启动前直接用 `better-sqlite3` 往测试数据库写入夹具数据(比如带指定 `created_at` 的记录)。
5. `ratelimit.js` 支持注入时钟(`now()` 函数),测试不需要真的等待。
6. `backup.js` 支持参数 `--db --out --keep-days --now`,方便测试保留期。

---

## 6. 量化验收标准

### A. 服务端(node:test)

| # | 验收项 | 通过标准 |
|---|---|---|
| S-01 | 读取榜单 | 写入 100 条后 GET 返回 20 条,顺序严格是 `score DESC, created_at ASC, id ASC`;本地 100 次请求的 p95 < 50 ms |
| S-02 | 校验 | 下列每种情况都返回对应的 400/413/415 错误码,且表里行数不变:mode 非法;名字为空、13 个字符、含控制字符、含零宽字符、含敏感词(含"中 间 加 空 格"的变体);score 为 −1、1.5、"100"、10,000,001;rounds 为 0 或 9;未知角色;version 为 0;请求体 3 KB;非 JSON |
| S-03 | 前 20 边界 | 榜上 20 条且最低 1000:提交 1000 → `not_qualified`,`cutoff = 1000`;提交 1001 → `rank = 20`,原来的第 20 名被挤出前 20(但仍在表里);不足 20 条时提交 0 分也能上榜 |
| S-04 | 名次正确 | 随机插入 300 个分数(含重复),每次返回的 rank 都等于参考实现(JS 排序)算出的名次 |
| S-05 | 并发安全 | 榜上已有 20 条,同时发 50 个不同分数的 POST:结束后前 20 = 所有分数里按规则排出的前 20;返回 ok 的请求数 = 实际写入的行数;没有重复 id;不报错 |
| S-06 | 只留前 100 | 某模式连续插入 150 个递增分数后,该模式恰好 100 行,而且是最高的 100 个;另一个模式的行数不变 |
| S-07 | 限流 | 同一 IP 在 60 秒内第 6 次 POST 返回 429,`Retry-After` ≥ 1;注入时钟前进 61 秒后恢复;GET 不受影响 |
| S-08 | 管理接口 | 没有或错误的密码 → 401;`ADMIN_PASSWORD` 为空 → 404;删除、改名(新名字照样校验)、归档(JSON 文件行数 = 删除行数,内容可以解析)、清空(不带 confirm 返回 400)都正确;命令行的同名操作效果相同 |
| S-09 | 备份 | 一边用循环不停写入,一边运行 backup.js:产生的备份能打开,`integrity_check = ok`,行数 ≥ 开始时的行数;用 `--now` 模拟,31 天前的备份被删除,29 天前的保留 |
| S-10 | 持久化 | 重启服务后数据完整;`PRAGMA journal_mode` 为 `wal` |
| S-11 | 安全 | 名字 `<script>alert(1)</script>`(12 个字符以内的变体)和 `'; DROP TABLE scores;--` 都按原样存储,表依然存在;任何 500 响应里都不含堆栈;所有响应 Content-Type 正确 |

### B. 部署

| # | 验收项 | 通过标准 |
|---|---|---|
| D-01 | 脚本语法 | `bash -n` 对所有 `.sh` 通过;容器里能装 `shellcheck` 时,不得有 error 级别问题 |
| D-02 | 试运行 | `deploy.sh --dry-run --domain game.example.com --email a@b.c` 退出码 0,输出依次包含:apt 安装、NodeSource、创建用户、复制文件、env 文件、systemd、nginx、certbot、ufw、cron、health 检查;缺少参数时退出码非 0,并打印中文用法 |
| D-03 | Nginx 配置 | 用模板渲染出的配置包含 `/api/` 反向代理、静态 root、gzip、`client_max_body_size`;容器里能装 nginx 时 `nginx -t` 通过 |
| D-04 | systemd 单元 | 含 `Restart=always`、`User=goldminer`、`EnvironmentFile=/etc/goldminer.env`;能用 `systemd-analyze verify` 时通过 |
| D-05 | 部署指南 | `DEPLOY.md` 有 §3.2 列出的全部 11 个章节,命令可以直接复制,出现 itdog.cn 的使用说明 |

### C. 前端端到端(Playwright;"真实按键"表示只用 `page.keyboard.*` 输入)

| # | 验收项 | 通过标准 |
|---|---|---|
| F-01 | 完整上榜流程(真实按键) | 空榜。`?fast=1&seed=3`:用键盘进入单人模式,一直玩到 final(第 1 关失败也可以)→ 弹出名字窗口,input 获得焦点 → 先 `keyboard.press('Control+A')` 和 `Backspace` 清空,再 `keyboard.insertText('矿工小王')`(模拟输入法上屏)和 `keyboard.type('sw ')` → input 值为 `矿工小王sw `,在此期间 `G.screen` 一直是 final,没有重开游戏 → 按 `Enter` → 窗口显示"第 1 名" → 刷新页面,按 `KeyL` → 单人标签第一行显示 `矿工小王sw` 和正确的分数与关数 |
| F-02 | 输入法回车 | 窗口打开时派发 `compositionstart`,再派发 `isComposing: true` 的 Enter keydown → 没有发出 POST;`compositionend` 之后按 Enter → 发出 POST |
| F-03 | 对战两人上榜 | `forceGameEnd({mode:'versus', scores:[{score:5000,…},{score:3000,…}]})`,空榜 → 依次弹出 P1、P2 两个窗口,分别用真实按键输入名字并提交 → 对战榜上 P1 第 1 名、P2 第 2 名 |
| F-04 | 没进前 20 | 对战榜已有 20 条且最低 50,000,终局得分 1,000 → 不弹窗口,终局页显示"未进入前 20(第 20 名 $50,000)" |
| F-05 | 服务器不可用 | `?api=http://127.0.0.1:1`:游戏能正常玩到 final;5 秒内终局页和排行榜界面都显示"暂时无法连接排行榜";`pageerror` 为 0;除浏览器自己产生的网络失败日志(`Failed to load resource` / `net::ERR_`)外,没有任何 console.error |
| F-06 | 竞争 | 榜上 19 条。窗口打开后,测试脚本通过 API 再插入 2 条更高的分数 → 提交返回 `not_qualified`,窗口显示"很遗憾,刚刚被别人超过了",关闭后终局页还能用空格重开 |
| F-07 | 排行榜界面(真实按键) | 有 20 条(其中有 12 个汉字的长名字)时,`KeyD`、`ArrowRight`、`KeyA`、`ArrowLeft` 都能切换标签;每页恰好 20 行;截图里各列不重叠;日期格式为 YYYY-MM-DD;`Escape` 回到主菜单 |
| F-08 | 合作不上榜 | 合作模式打完一局:网络日志里没有任何 `/api/` 请求,也没有弹窗口 |
| F-09 | 错误提示 | 服务端返回 429 → 显示"提交太频繁,请稍后再试";返回 `bad_word` → 显示"名字包含不合适的词",窗口不关,可以改名再提交 |
| F-10 | 跨源覆盖 | 游戏用静态服务器 A 提供,服务端在 B(设置 `CORS_ORIGIN=A`),`?api=B` → 读取和提交都成功 |
| F-11 | 回归 | 第二阶段的 AC-P2-01(零报错)和 AC-P2-21(三模式真实按键整局)在本阶段代码上仍然通过,不受排行榜是否可用影响 |
