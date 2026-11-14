# 黄金矿工 · 第四阶段:远程联机对战 + 共存部署 — 实现规格 (SPEC-phase4-online) · 已获用户批准

> 状态:**已获用户批准**。由 `PLAN-phase4-online.md` 定稿而来,用户在审批时做了三个决定(见 §0.1)。
> 读者:Builder(实现)、Evaluator(验收)。**本文件是唯一依据**;与 PLAN 不一致时以本文件为准。
> 用户需求:把双人黄金矿工放到自己的香港服务器上,和女朋友**在不同地方、各用各的电脑**联机对战;以与服务器上现有软件**共存**的方式部署。
> 已知服务器现状(用户实测):Ubuntu 24.04.4,腾讯云轻量,公网 IP `43.161.221.249`;**Caddy** 占用 80/443(管理 API 127.0.0.1:2019),现有站点 `43.161.221.249.sslip.io` 反代到 `127.0.0.1:8787`;**8787 是用户的另一个程序**(系统用户 `compani…`,命令 `/usr/bin/node dist/index.js`),**与本项目无关,绝不能碰**;Node v22.23.4(不能升级或改动);没有 nginx;ufw 未启用;没有 Docker / 宝塔;**没有自己的域名**。
> 文中行号指当前 `index.html`(4216 行)的大致位置,仅作定位参考。

---

## 0. 一页速览

| 项 | 方案 |
|---|---|
| 玩法 | 电脑主菜单新增"**联机**"入口。一人创建房间,得到 6 位房间码和分享链接;另一人点链接或输码加入。之后选角色、开局、8 关、商店、结算、"再来一局",规则和本地双人对战**完全相同** |
| 模式 | **只有联机对战**(本期不做联机合作) |
| 设备 | **只支持电脑(键盘)**。触屏设备(手机/平板)上的联机入口只显示友好提示"联机对战需在电脑上进行";触屏单人模式完全不变 |
| 技术 | **权威服务器**:Node 服务端在 `node:vm` 沙箱里**直接运行同一个 `index.html` 的游戏脚本**(不抽出、不重写规则),60 Hz 推进;客户端只发输入,接收 30 Hz 状态快照并插值显示 |
| 手感 | **"所见即所得"出钩**:客户端报告按键时自己看到的钩子摆动时刻,服务器按那一刻的角度出钩并补齐延迟;自己的钩子本地立即伸出(预测),不用等网络 |
| 断线 | 任一方掉线 → 游戏自动冻结;10 分钟内刷新页面或网络恢复即自动回到原座位,3 秒倒计时后继续 |
| 暂停 | 任一方按 P(或点 ⏸)→ 双方一起暂停;任一方都能继续,继续前 3 秒倒计时 |
| 排行榜 | 本期**不接**(排行榜服务本身还没上线;联机分数也不上榜) |
| 部署 | 新脚本 `deploy/deploy-online.sh`:**不装 nginx/certbot、不开 ufw、不动系统 Node、不碰 8787**;只新增一个 Caddy 站点文件,并在主 Caddyfile 末尾加 1 行 `import`;改前备份、`caddy validate` 通过才 `reload`,失败自动还原 |
| 网址 | **`https://goldminer.43.161.221.249.sslip.io/`**(免买域名、免 DNS,Caddy 自动签证书);自定义域名只作为文档里的备选 |
| 端口 | 游戏服务默认 `127.0.0.1:8790`(可配置,部署前检测占用,拒绝 8787/80/443/2019/22) |
| 单文件 | `index.html` 仍是单个文件,本地三种模式和触屏单人照旧可离线玩;只有联机需要服务器 |

### 0.1 用户的决定(审批时由用户本人选定)

| 问题 | 决定 | 对本规格的影响 |
|---|---|---|
| 联机是否支持手机/平板 | **只支持电脑(键盘)** | 不做触屏联机 HUD 和点按操作;触屏界面(`G.touchUI === true`)上联机入口只给提示,不建立任何 WebSocket 连接(§2.1 第 9 条) |
| 是否提供联机合作 | **只做对战** | 房间模式固定为 `versus`;协议里没有模式字段和 `lobby` 消息;不做合作相关验收 |
| 网址 | **`goldminer.43.161.221.249.sslip.io`** | 部署脚本和文档以它为默认示例;自定义域名作为备选写进文档 |

---

## 1. 定位与技术方案

### 1.1 方案比较(结论:权威服务器 + 复用同一份脚本)

| 方案 | 做法 | 优点 | 致命问题 |
|---|---|---|---|
| A. 锁步(lockstep) | 两端用同一种子各自模拟,服务器只转发带 tick 号的输入 | 带宽极小;代码完全复用 | ① 必须等对方输入才能推进,香港↔大陆偶发 150 ms+ 抖动时画面会**卡顿**;要顺滑就得做回滚(rollback),而现有 `G` 里有闭包(`G.sched` 的 `fn`)和对象互引用,无法便宜地存档/回档。② 两台电脑可能用不同浏览器(Chrome/Edge 是 V8,Safari 是 JavaScriptCore,Firefox 是 SpiderMonkey),`Math.sin/exp/pow` 不保证逐位一致;并且现有代码里 `reduceFx`(`bigWin` 第 1027 行提前 return)、`touchUI`(粒子上限)会让两端走不同分支 —— 一旦分叉无法纠正 |
| B. 权威服务器,**另写一套服务端规则** | 把规则移植成服务端模块 | 结构清晰 | 4200 行里逻辑与绘制交织,移植必然出现**两套规则分叉**,回归测试无法覆盖 |
| **C. 权威服务器,服务端运行同一个 `index.html` 脚本(推荐)** | 服务端读取部署目录里的 `index.html`,取出游戏 `<script>`,放进 `node:vm` 沙箱,配一个"假 DOM"(画布方法全是空操作),通过 `window.__game.net` 驱动 | **规则只有一份**:服务器跑的就是浏览器里的那段代码;服务器设置固定(非触屏、特效开、规则 2),不存在两端分叉;客户端都看同一份状态,比分天然一致;断线重连只需重发一次完整快照 | 需要写"状态快照/应用"代码和客户端插值、预测;带宽比锁步大(约 10–25 KB/s/人,可接受) |

### 1.2 单文件与代码组织

- `index.html` **仍是单文件**,不拆分。改动:
  1. 给游戏脚本标签加 `id="gm-main"`,服务端按 id 取脚本文本。
  2. 脚本必须能在"假 DOM"里无报错地加载(不调用渲染、不建音频;`requestAnimationFrame` 被替换成空函数)。凡是加载时访问 DOM 的地方,Builder 用存在性判断保护,**不得改动任何游戏规则和 `Math.random()` 调用顺序**。
  3. 新增 `window.__game.net` 子对象(§6),包括:服务端用的 `step / input / fireBackdated / snapshot / fxDrain`,客户端用的 `apply / connect`。
  4. 新增联机界面(大厅、等待房间、断线/暂停遮罩)、插值与本地预测;触屏界面上的联机提示。
- 新目录 `online/`(独立于 `server/` 排行榜,互不依赖):
  ```
  online/
    package.json          ← 唯一运行时依赖 ws(锁定精确版本 8.x,附 package-lock.json);"engines": { "node": ">=22" }
    src/server.js         ← node:http + ws;/online/ws、/online/health;开发/测试时可用 SERVE_STATIC 提供静态文件
    src/sim-host.js       ← 读取 GAME_HTML,取出 #gm-main 脚本,为每个房间建一个 vm 上下文(假 DOM)
    src/room.js           ← 房间状态机:座位、准备、暂停、断线冻结、结算自动前进、再来一局
    src/protocol.js       ← 消息校验(类型、字段、长度)
    src/ratelimit.js      ← 令牌桶(可复用 server/src/ratelimit.js 的写法,但不 require 它)
    src/netsim.js         ← 测试用:注入延迟/抖动/卡顿(生产环境强制关闭)
    test/                 ← node:test 单元/集成测试
  ```
- 不选择"服务端 import 一个抽出来的 .js 模块"的原因:那样 `index.html` 要么不再是单文件,要么同一段代码存两份。现在的做法是**服务器读的就是 Caddy 发给浏览器的那个文件**(同一路径 `/var/www/goldminer/index.html`),天然同版本。

### 1.3 延迟处理(香港↔大陆 RTT 20–80 ms,偶发 150 ms+、丢包、切网)

钩子的摆动最大角速度约 `70° × 2π / 2.6 s ≈ 169°/s`。如果"按键到出钩"晚 100 ms,方向就偏 17°,完全不能接受。所以:

1. **所见即所得出钩(服务器端延迟补偿)**
   - 客户端按发射键时,把"自己钩子当前**显示的**服务器时刻" `at`(带小数的 tick 号)随输入发出。
   - 服务器为每个钩子保存最近 30 tick(0.5 s)的摆动相位历史。收到后:
     - 如果从 `at` 到现在钩子一直处于 `swing`、没被冻结、且允许出钩(未 `timeUp`、`noFireT ≤ 0`),就把相位设为历史里 `at` 时刻的值(相邻两 tick 线性插值),调用原有 `fireHook`;
     - 然后只对这个钩子补跑 `Δ = round(now − at)` 次 `updateHook(p, STEP)`。`Δ` 上限 18 tick(300 ms),超出部分不补,但**角度仍按 `at` 锁定**(`at` 超出 30 tick 的历史时,改用当前相位,即退化为普通出钩)。
   - 效果:钩子一定朝玩家按键那一瞬间看到的方向飞;伸出的长度也和"零延迟"时一样。
   - 公平规则:补跑只针对出钩者自己的钩子,用的是**当前**世界状态;**已经被对方抓住的物品不会因补跑被抢走**,最多触发现有的拔河。
2. **自己的钩子本地预测**:按下发射后,客户端立刻(下一帧)把自己的钩子锁定在当前角度并按伸出速度(含加速齿轮、角色系数)画出伸长;碰到屏幕边缘或任一显示中的物品就停住等待。当插值画面到达服务器给出的出钩时刻 `fireAt` 后,改为显示服务器状态(因为服务器按 `at` 补跑,两条时间线在交接处长度一致)。500 ms 内没收到确认(例如被拒绝)就放弃预测。**不预测抓取结果和金币**,金币只以服务器为准。
3. **其他一切画面插值**:客户端缓存快照,画面时间 = 估算的服务器时刻 − 插值延迟 `D`。`D = clamp(2 × 快照间隔 + 2 × 到达抖动(p95), 66 ms, 250 ms)`,每秒重算,平滑变化(每秒变化不超过 20 ms)。
4. **数据断流时**:最多外推 150 ms(摆动相位、伸出长度、倒计时按规则外推),之后定格;连续 1 s 没有快照显示右上角"网络不稳…"小标识;5 s 没有任何消息就断开重连。
5. **对手钩子的跳变**:对手出钩时,服务器补跑会让对手的钩子在我这边"突然伸出一截"。客户端检测到对手钩子从 `swing` 直接变成已伸出 > 20 px 时,用 80 ms 缓动过渡,不追求精确。
6. **为什么用 WebSocket(TCP)而不是 WebRTC/UDP**:两个人用、要穿过 Caddy、所有浏览器都支持;TCP 丢包时会有短暂停顿,由上面的插值缓冲和外推吸收。WebRTC 需要 STUN/TURN,复杂度不值得。

---

## 2. 功能与范围

### 2.1 做什么(IN)

1. **入口**
   - 电脑(`G.touchUI === false`):主菜单在三张模式卡下方新增按钮"🌐 联机(O)",按 `O` 或点击进入联机大厅。**不加第 4 张卡**,保证 `MENU_ORDER`、`G.menuMode` 和已有回归测试不变。
   - 打开带 `#room=K7M2QX` 的链接,直接进入"加入房间"界面,房间码已填好。
   - 触屏设备见第 9 条。
   - 用 `file://` 打开且没有 `?server=` 参数时,联机按钮可见但点击后提示"联机需要通过网址打开游戏"。
2. **大厅(DOM 浮层,用真实 `<input>`,支持中文输入法)**:昵称输入框(1–8 个字符,存 `goldminer.online.name`,默认空 → 显示"玩家1/玩家2");按钮"创建房间""加入房间"(6 位房间码输入框,自动转大写、去掉空格和易混字符)"返回"。
3. **等待房间**:大字显示房间码;按钮"复制邀请链接"(`navigator.clipboard`,失败时选中文本并提示"请按 Ctrl+C 复制");显示"联机对战"和"请让对方**在电脑上**打开链接";两个座位的状态(在线/离线、昵称、你是谁)。对方加入后自动进入**角色选择**。
4. **角色选择**:各自在自己的设备上选自己的角色(复用现有选择页布局,只有自己那一侧能操作,对方的选择实时显示);双方都确认 → 0.8 秒后开局(与本地一致)。
5. **对局**:intro → play → results → shop → … → final,全部由服务器推进。规则、数值、事件、商店、拔河、免死金牌与本地双人对战**一模一样**(`G.mode === 'versus'`,规则 2,`versusEndOnElim` 等照旧)。
   - 布局:房主固定是玩家1(左、蓝),加入者是玩家2(右、红);两边画面布局相同,自己的面板加"你"标签和描边。
   - **intro 不能跳过**(避免一方跳过时另一方还没看清)。
   - **结算页**:任一方按"继续"会在自己面板显示 ✓;双方都按,或 6 秒后自动进入商店/终局。
   - **商店**:各自操作自己那一栏;对方栏只显示"选购中… / 已准备"。双方都准备好才开下一关(与本地一致)。
6. **终局**:显示双方比分和胜负;按钮"再来一局"(双方都按才开始,对方已按时显示"对方想再来一局!"),回到角色选择;"离开房间"回到主菜单。
7. **电脑操作**:`S`/`↓` 发射(拔河时连按),`W`/`↑` 炸药,`A D ← →` 选择,空格/回车 确认,`P`/`Esc` 暂停,`M` 静音,`V` 减特效(只影响本机画面)。两套键等价,不分 P1/P2。
8. **暂停**:只在 intro / play 中有效。任一方暂停 → 双方看到"〈昵称〉暂停了游戏";暂停菜单两项:"继续"(任一方都能按)和"离开房间"(需二次确认)。继续后双方看到 3-2-1 倒计时再恢复。不限次数(只有两个人,不需要防滥用)。
9. **触屏设备上的联机入口(只给提示)**:
   - 触屏界面(`G.touchUI === true`,判定规则沿用 `SPEC-touch`,接了键盘的平板也算触屏)的主菜单增加一个**灰色**按钮"联机对战"(≥ `MIN_HIT`,在安全区内);点按后弹出 2.5 秒提示:"联机对战需在电脑上进行"。
   - 触屏设备打开带 `#room=` 的邀请链接:显示一个提示层(DOM):标题"联机对战需在电脑上进行",正文"请在电脑浏览器打开这个链接:〈完整链接〉",按钮"复制链接"和"玩单人模式"(关闭提示层回到主菜单)。
   - 触屏界面**不创建任何 WebSocket 连接**,不发送任何联机消息;触屏单人模式的行为、布局、`SPEC-touch` 的全部验收不变。对战/合作卡片的置灰提示文字不变。
10. **离开窗口**:浏览器标签页被隐藏(`visibilitychange`)时,客户端发送 `away`,服务器立即暂停双方(原因"〈昵称〉切换到了其他窗口"),回来后任一方按"继续"。
11. **断线重连**:见 §3.8。
12. **版本不一致**:见 §3.9。

### 2.2 明确不做(OUT)

- 公开匹配大厅、房间列表、随机匹配;观战;文字/语音聊天、表情;账号、好友、战绩统计;
- **手机/平板联机**(触屏联机 HUD、点按操作);**联机合作**;
- 超过 2 人;联机单人;电脑 AI 补位;
- 联机分数上排行榜(排行榜服务本期不部署、不接入,`server/` 不改);
- 回放、录像;房间密码(房间码本身就是秘密);
- 多服务器/横向扩展;WebRTC/P2P;
- 新物品、新规则、新数值;任何本地模式的行为变化(除电脑主菜单多一个联机按钮、触屏主菜单多一个灰色"联机对战"提示按钮)。

### 2.3 防陌生人闯入/滥用(只有两个人用,但入口在公网)

| 措施 | 数值 |
|---|---|
| 房间码 | 6 位,字母表 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`(31 个,去掉 0/O/1/I/L),`crypto.randomInt` 生成 → 31⁶ ≈ 8.9 亿(≈ 29.7 bit) |
| 座位凭证 | 每个座位一个 32 字节随机令牌(base64url),只在 WebSocket **第一条消息正文**里发送,**不放进 URL 查询串**(Caddy 若开了访问日志也不会记录);客户端存 `localStorage['goldminer.online.<房间码>']` |
| 满员 | 两个座位被占后,第三个人加入返回"房间已满";已占座位只能凭令牌回来 |
| Origin 校验 | WebSocket 升级请求的 `Origin` 必须在 `ALLOWED_ORIGINS` 里(生产是 `https://<游戏域名>`),否则 403 |
| 速率限制(按客户端 IP;只信任来自 127.0.0.1 的 `X-Forwarded-For` 第一段) | 新连接 30 次/分钟;同时连接 ≤ 8;创建房间 10 次/小时;**加入失败**(房间不存在)10 次/分钟、50 次/小时,超出返回 `rate_limited` 并带重试秒数 |
| 消息 | 客户端→服务器单条 ≤ 1024 字节(`ws` 的 `maxPayload`),超出断开(1009);每连接令牌桶 40 条/秒、突发 80,超出丢弃,10 秒内丢弃 > 200 条断开(1008);非 JSON / 未知类型 → `bad_message`,累计 20 次断开 |
| 握手 | 连接后 5 秒内必须发出 `create` / `join` / `resume`,否则断开 |
| 全局上限 | 房间 ≤ 20 个,连接 ≤ 100 个(每个房间一个 vm 上下文,约 10–20 MB) |
| 空闲回收 | 等待房间只有房主、无人加入:30 分钟删除;房间里没有任何在线玩家:10 分钟删除;终局后无人操作:30 分钟删除;任何房间最长存活 6 小时 |

---

## 3. 关键机制与参数

### 3.1 时间与频率

| 参数 | 值 |
|---|---|
| 服务器逻辑 tick | 60 Hz,`dt = STEP = 1/60`(与本地完全相同)。用单调时钟累加器,每轮最多补 10 tick,防止雪崩 |
| 快照广播 | 30 Hz(每 2 tick);以下事件立即补发一次:屏幕切换、暂停/继续、座位上下线 |
| 输入处理 | 在下一个 tick 开始时,按到达顺序依次处理 |
| 客户端心跳 | 每 2 s 发 `ping`;服务器回 `pong`(含服务器 tick) |
| 服务器判定掉线 | 连接关闭,或 8 s 没收到任何消息 |
| 服务器协议级 ping | 每 15 s(保持 Caddy/NAT 连接) |
| 客户端重连 | 5 s 没有任何消息 → 主动断开重连;退避 0.5、1、2、4、4… s,直到座位保留期结束 |
| 座位保留 | 10 分钟(`SEAT_TIMEOUT`,测试可调小) |
| 继续前倒计时 | 3 s |
| 结算页自动前进 | 6 s |
| 插值延迟 D | 66–250 ms,自适应(§1.3) |
| 预测上限 | 500 ms |
| 延迟补偿 | 角度锁定最多回看 30 tick(500 ms);补跑最多 18 tick(300 ms) |

### 3.2 时钟同步

- `pong` 带服务器发送时的 tick(小数)。客户端取最近 10 次中 RTT 最小的样本:`服务器tick ≈ s + (RTT/2)·60`,得到本地时钟到服务器 tick 的偏移;偏移每秒最多调整 10%,避免画面跳动。
- 倒计时、暂停倒计时都来自服务器状态,双方看到的时间差 ≤ 半个 RTT + D。

### 3.3 协议(JSON 文本帧;路径 `wss://<域名>/online/ws`)

客户端 → 服务器:

| 消息 | 说明 |
|---|---|
| `{t:'create', proto:1, build, name}` | 创建房间(模式固定为对战),创建者是座位 0 |
| `{t:'join', proto:1, build, name, room:'K7M2QX'}` | 加入,成为座位 1 |
| `{t:'resume', proto:1, build, room, seat:'<令牌>'}` | 重连/刷新后回到原座位 |
| `{t:'in', s:<序号>, a:<动作>, at?:<tick>, i?:<序号>}` | 输入。`a ∈ fire, dyn, left, right, ok, back, pick, ready, next, pause, resume, away, again, leave`;`at` 只用于 `fire`;`i` 用于 `pick`(鼠标直接点角色卡/商品卡;键盘操作不需要) |
| `{t:'ping', c:<客户端毫秒>}` | 心跳 |

服务器 → 客户端:

| 消息 | 说明 |
|---|---|
| `{t:'welcome', you:0\|1, room, seat, build, fast, rate:{tick:60, snap:30}}` | 加入/重连成功 |
| `{t:'room', phase:'waiting'\|'game', seats:[{name, online, again}], pause:{by, reason:'player'\|'away'\|'offline', resumeAt}?}` | 房间状态变化时发送 |
| `{t:'snap', k:<tick>, full?:1, d:<状态或增量>, fx:[…], ack:<已处理的最后输入序号>, fire?:[{p, fireAt, seq}]}` | 状态快照 |
| `{t:'pong', c, k}` | 心跳回复 |
| `{t:'error', code, retry?}` | `version / room_not_found / room_full / bad_seat / rate_limited / bad_message / server_full / origin`,对应的中文提示由客户端显示 |

- 服务器把动作映射成对应座位的现有按键码(座位 0 → `PLAYER_CFG[0].keys`,座位 1 → `PLAYER_CFG[1].keys`)再调用原有 `handleKey` / `selectKey` / `shopAction`,不另写规则。`pick` 先设置选中项再执行"确认/购买"(与现有 `shopTap` 相同的语义)。
- 只有房间控制器(`room.js`)处理的动作:`next`(结算继续)、`pause/resume/away`、`again`、`leave`。

### 3.4 状态快照

- **内容**(`__game.net.snapshot()` 生成,纯 JSON):屏幕与计时(`screen, round, time, timeUp, overtime, introT, resultsT, hitStop, shake, zoomT/zoomX, finaleOn`)、`mode`、双方玩家(金币、炸药、存活、加成、`pending`、免死金牌、冻结、角色、昵称、`roundGain`、`caught`、钩子 `state/phase/angle/len/offx/offy/blast/itemId/fireAt`)、物品(每个物品新增稳定 `id`;互相引用一律改为 id:`hook.item`、`it.stuck`、`tug.item`)、`tug`、`hazards`、`event`、`meteors`、`bolts`、`banner`、`sel`、`shop`、`results`、`final`、`stats`。
- **不包含**:`G.sched`(闭包,只在服务器存在)、粒子与飘字(走 fx 流)、所有客户端本地字段(`touchUI, dprLevel, particles, texts, toast, t, minFont, tapGuardUntil` 等)。
- **完整性标准**:同一状态,"本地直接渲染"与"快照 → 另一页面 `apply` 后渲染"的画面逐像素对比一致(验收 O-05)。Builder 据此找出渲染函数读取的所有字段。
- **增量**:每个连接记住"上次发出的状态";之后只发有变化的顶层字段,物品按 id 发"新增/变化/删除"。WebSocket 是可靠且有序的,不需要确认机制;新连接、重连或客户端请求时发 `full:1` 完整快照。目标大小:对局中增量平均 ≤ 1.5 KB,完整快照 ≤ 30 KB。
- **fx 流**:服务器上 `floatText / addP / Snd.play / banner` 写入一个收集器(粒子参数照样由服务器的 `Math.random()` 计算,不改变调用顺序),随下一个快照发出;客户端用原有函数重放(`reduceFx` 打开时粒子减半)。每个快照最多 150 条,超出时先丢环境粒子。

### 3.5 随机种子与地图生成

- 全部由**服务器**决定:每局开始时 `crypto.randomInt(2³¹)` 作为种子,调用现有 `__game.reseed(seed)` 后 `startGame()`。地图、事件、商店货架、炸药碎石、骰子等都来自服务器的随机序列。客户端从不调用游戏逻辑的随机数。
- 种子记录在房间里;测试模式(`ONLINE_TEST_HOOKS=1`)可以在建房时指定种子。

### 3.6 同时抓同一金块的裁决

完全沿用现有规则,只是现在由服务器一处执行:
1. 输入在 tick 边界按到达顺序处理;同一 tick 内两个钩子的更新顺序仍由现有的随机先后(`updatePlay` 第 1525 行)决定。
2. 先碰到**无主**物品的钩子得到它。
3. 另一个钩子碰到对方**正在拉回**的物品 → 拔河(5 s 连按,`TUG_K` 不变,按服务器收到的连按次数计算)。
4. 延迟补偿的补跑不会抢走已被抓住的物品,最多触发第 3 条。
5. 拔河结束时还在路上的连按不计(最多差约半个 RTT,约 1 次连按)。

### 3.7 暂停

- 房间控制器维护 `pause = { by, reason, resumeAt }`;暂停时服务器停止调用 `step()`(整个模拟冻结,包括倒计时)。
- `resume` → `resumeAt = now + 3 s`,倒计时期间继续冻结,到点调用原有 `resumeGame()`(含 0.2 s 防误发 `noFireT`)。
- 暂停期间任何一方掉线,原因改为 `offline`,"继续"按钮不可用,直到双方都在线。

### 3.8 断线重连

| 情况 | 处理 |
|---|---|
| 任一方在**任何游戏屏幕**掉线 | 服务器立即冻结模拟(`reason:'offline'`);在线一方看到"〈昵称〉连接中断,正在等待重连… 剩余 9:52";掉线一方看到"正在重新连接…" |
| 掉线方回来(自动重连,或刷新页面凭 `localStorage` 令牌 `resume`) | 收到 `welcome` + 完整快照;双方都在线后自动开始 3 s 倒计时继续(暂停原因是 `player` 的保持暂停) |
| 等了 60 s 还没回来 | 在线一方额外出现"结束对局"按钮 → 双方回到等待房间(本局作废,不算胜负) |
| 超过 10 分钟 | 座位释放,在线一方看到"对方已离开",只能"返回主菜单";房间删除 |
| 等待房间/角色选择时掉线 | 同样保留座位 10 分钟;角色选择的"已确认"状态清空 |
| 标签页被隐藏、电脑休眠 | 客户端先发 `away` → 服务器立即暂停(`reason:'away'`),不必等 8 s 超时;休眠导致连接断开时按掉线处理 |
| 同一座位在另一个标签页 `resume` | 新连接接管,旧连接收到 `error: bad_seat`(提示"已在其他页面打开")后关闭 |

### 3.9 版本不一致

- `build` = 游戏脚本(`#gm-main` 的文本)的 FNV-1a 64 位哈希(16 位十六进制)。客户端加载时同步计算(约 2 ms);服务器对它加载的同一段文本计算。**不需要人工改版本号**。
- 握手时 `build` 或 `proto` 不一致 → `error: version`,客户端显示"游戏已更新,请刷新页面"和"刷新"按钮(`location.reload()`)。
- Caddy 对页面发送 `Cache-Control: no-cache`,刷新一定拿到新版本。
- `update-online.sh` 更新后重启服务;如果有正在进行的对局(`/online/health` 的 `games > 0`),默认拒绝并提示,加 `--force` 才执行。

---

## 4. 部署(共存模式)

### 4.1 原则(脚本必须遵守,测试逐条检查)

1. **不安装** nginx、certbot、Node、Docker,不执行 `apt-get install`(连 rsync 也不装,缺了就提示)。
2. **不启用/不修改** ufw 和任何防火墙规则。
3. **不修改** Caddyfile 里已有的任何一行;只在末尾追加 3 行(1 行 `import` + 2 行注释标记)。不执行 `systemctl restart/stop caddy`,只 `reload`。
4. **不碰** 8787 端口和它的进程/用户:不 kill、不探测其内容,只在端口检查时把 8787 列为禁用端口。
5. **不改动** 系统 Node(只检查 `/usr/bin/node` 版本 ≥ 22 且不在 `/home`、`/root` 下)。
6. 所有新文件都带 `goldminer` 前缀,卸载时**只删除自己加的东西**。
7. 每一步都支持 `--dry-run`(只打印,不修改)。

### 4.2 新增文件

| 文件 | 说明 |
|---|---|
| `deploy/deploy-online.sh` | 共存模式一键部署(下面 §4.3) |
| `deploy/update-online.sh` | 更新游戏页面和联机服务(`[--force] [--dry-run]`) |
| `deploy/uninstall-online.sh` | 卸载(`[--purge] [--dry-run]`) |
| `deploy/goldminer-online.service` | systemd 单元模板 |
| `deploy/goldminer.caddy.tpl` | Caddy 站点模板 |
| `deploy/DEPLOY-online.md` | 中文部署说明(§4.7) |
| `deploy/deploy.sh`(小改) | 开头增加保护:检测到 80/443 已被 **nginx 以外**的程序(例如 Caddy)占用时,直接退出并提示"请使用 deploy-online.sh(共存模式)",`--dry-run` 下只打印这项检查。其余行为不变(已有 D-01~D-05 测试必须仍通过) |

### 4.3 `deploy/deploy-online.sh --domain <游戏域名> [--port 8790] [--dry-run]`

本次部署的命令:`sudo bash deploy/deploy-online.sh --domain goldminer.43.161.221.249.sslip.io`(先加 `--dry-run` 试运行)。

| 步 | 内容 |
|---|---|
| 1. 预检(只读,任一失败即退出,**不做任何修改**) | root 权限;Ubuntu 22.04/24.04;`caddy` 命令存在且 `systemctl is-active caddy`;`/etc/caddy/Caddyfile` 存在;**用原始文件** `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` 必须通过(如果原文件本身就有问题,脚本拒绝修改并说明);`/usr/bin/node` ≥ 22,`npm` 存在;端口:不能是 22/80/443/2019/8787,且 `ss -Hltn` 显示未被占用(已被本项目的 `goldminer-online` 服务占用除外);域名格式合法,且在 Caddyfile 及其已导入的文件里尚未出现;sslip.io 域名检查其中嵌入的 IP(仅提示,不阻止) |
| 2. 记录现有站点状态 | 解析 Caddyfile 顶层站点地址,逐个 `curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://<地址>/`,记录结果(只读,用于第 7 步对比) |
| 3. 用户与文件 | 如不存在则创建系统用户 `goldminer`(`--system --shell /usr/sbin/nologin`);游戏 → `/var/www/goldminer/index.html`(root 所有,目录 755、文件 644,Caddy 可读);服务端 → `/opt/goldminer-online/`(root 所有),在其中 `npm ci --omit=dev`;如不存在则生成 `/etc/goldminer-online.env`(600):`PORT`、`HOST=127.0.0.1`、`ALLOWED_ORIGINS=https://<域名>`、`GAME_HTML=/var/www/goldminer/index.html`、`TRUST_PROXY=1` |
| 4. systemd | 安装 `goldminer-online.service`:`User=goldminer`、`EnvironmentFile`、`ExecStart=/usr/bin/node /opt/goldminer-online/src/server.js`、`Restart=always`、`RestartSec=3`、`NoNewPrivileges`、`ProtectSystem=strict`、`ProtectHome`、`PrivateTmp`、`MemoryMax=256M`;enable + restart;等待 `curl http://127.0.0.1:<端口>/online/health` 成功(最多 20 s),失败则停止并退出(此时还没改 Caddy) |
| 5. 写 Caddy 站点文件 | 由模板生成 `/etc/caddy/goldminer.caddy`(该文件已存在但不含本项目标记 → 退出) |
| 6. 接入主 Caddyfile | 备份为 `/etc/caddy/Caddyfile.bak-goldminer-<时间>`;若尚无标记,在**文件末尾**追加(原文件最后没有换行时先补一个换行):<br>`# >>> goldminer (由 deploy-online.sh 添加;卸载请运行 uninstall-online.sh)`<br>`import /etc/caddy/goldminer.caddy`<br>`# <<< goldminer`<br>因为第 1 步已证明原文件所有括号都闭合,追加的 `import` 一定在顶层。然后 `caddy validate`;**失败 → 用备份还原(并 `cmp` 确认逐字节相同)、删除 goldminer.caddy、退出码非 0** |
| 7. 生效与自检 | `systemctl reload caddy`;失败 → 还原备份并再次 reload,退出。成功后:轮询 `https://<域名>/online/health`(首次签证书最多等 120 s);再次检查第 2 步记录的现有站点:之前能访问、现在连不上或变成 5xx → **自动还原并 reload**,报告失败 |
| 8. 完成 | 打印游戏网址、日志命令(`journalctl -u goldminer-online`)、更新/卸载命令 |

- 脚本可重复执行(幂等):第二次运行不会重复追加 `import`、不会覆盖已有 env 文件。
- 测试用的路径前缀:所有系统路径前加 `${GM_ROOT:-}`(默认空),测试时指向临时目录;系统命令通过 PATH 里的假命令替换并记录调用(§5 O-30)。

### 4.4 Caddy 站点模板(`goldminer.caddy.tpl`,需兼容 Caddy ≥ 2.6)

```caddyfile
# 黄金矿工联机版 —— 由 deploy-online.sh 生成。不要添加 log 指令。
__DOMAIN__ {
	handle /online/* {
		reverse_proxy 127.0.0.1:__PORT__
	}
	handle {
		encode zstd gzip
		root * /var/www/goldminer
		header Cache-Control "no-cache"
		file_server
	}
}
```

- `reverse_proxy` 原生支持 WebSocket 升级,并默认带上 `X-Forwarded-For`;`/online/ws` 和 `/online/health` 都走这里。
- 压缩只用于静态页面,不包在 WebSocket 外面。
- 与现有站点完全隔离:不同主机名、不同文件;`caddy adapt` 输出中现有站点的路由前后必须完全相同(验收 O-31)。

### 4.5 运行与文件位置

| 项 | 位置 |
|---|---|
| 游戏页面 | `/var/www/goldminer/index.html` |
| 联机服务 | `/opt/goldminer-online/`,systemd 单元 `goldminer-online`,用户 `goldminer`,只监听 `127.0.0.1:8790` |
| 配置 | `/etc/goldminer-online.env` |
| Caddy | `/etc/caddy/goldminer.caddy` + 主 Caddyfile 末尾 3 行;备份 `/etc/caddy/Caddyfile.bak-goldminer-*` |
| 日志 | journald(服务本身不写访问日志,不记录座位令牌) |
| 数据 | 无持久数据(房间只在内存里;重启服务会结束进行中的对局) |

### 4.6 回滚与卸载

- **自动回滚**:§4.3 第 6、7 步任何失败都还原 Caddyfile 并 reload。
- **`uninstall-online.sh`**:停止并禁用 `goldminer-online`,删除单元文件;备份 Caddyfile 后**只删除两行标记之间(含标记)的 3 行**,`caddy validate` 通过后 reload(不通过就还原并报错);删除 `/etc/caddy/goldminer.caddy`。加 `--purge` 再删除 `/opt/goldminer-online`、`/var/www/goldminer`、`/etc/goldminer-online.env`;用户 `goldminer` 只有在没有其他 `goldminer*` 服务时才删除。
- 安装再卸载后,Caddyfile 与安装前**逐字节相同**(安装期间用户没有手动改过的前提下)。

### 4.7 `deploy/DEPLOY-online.md`(写给零运维经验的用户)

必须包含:
1. 这次会对服务器做什么、**不会做什么**(列出 §4.1 的保证;说明 8787 是你另一个程序,本项目不会碰它;可用 `sudo ss -ltnp | grep 8787` 和 `ps -o user,cmd -p <PID>` 自己确认)。
2. 网址:使用用户选定的 `goldminer.43.161.221.249.sslip.io`,原理一句话(sslip.io 会把名字里的 IP 直接解析出来,不用买域名、不用配 DNS);用 `nslookup goldminer.43.161.221.249.sslip.io` 验证;备选:改用自己的域名(加一条 A 记录指向 `43.161.221.249`,部署时把 `--domain` 换掉)。
3. 腾讯云防火墙:80/443 已经为现有站点放行,**不需要新开任何端口**;**不要**放行 8790。
4. 把项目传到服务器(`git clone` 或 `scp`,沿用 `DEPLOY.md` 第 4 节),先 `--dry-run` 再正式运行,复制粘贴命令。
5. 验证:浏览器打开网址;`curl https://<域名>/online/health`;**确认原来的站点照常可用**;两台设备实际联一局。
6. 用 itdog.cn 测试国内访问(沿用 `DEPLOY.md` 第 7 节)。
7. 怎么和女朋友开局:两人都用**电脑**;创建房间 → 复制链接发微信 → 她在**电脑浏览器**里打开(在电脑版微信里点开后选"在默认浏览器打开")。在手机上打开只会看到"联机对战需在电脑上进行"的提示。
8. 更新、卸载、查看日志、重启服务的命令。
9. 常见问题:证书一直没签下来(sslip.io 是共享域名,Let's Encrypt 按注册域名限速,偶尔失败;Caddy 会自动重试,也可能改用 ZeroSSL;仍不行就改用自己的域名)、提示"游戏已更新"、连不上/总掉线(检查网络、关掉代理/VPN)、`caddy validate` 失败时脚本做了什么、怎么手动还原备份。

---

## 5. 量化验收标准(Evaluator 逐条验证)

通用约定:
- Playwright(`/opt/node22/lib/node_modules/playwright`),桌面上下文 1280×720。联机测试在进程内启动 `online/src/server.js`(随机端口,`SERVE_STATIC` 指向游戏目录,`ONLINE_TEST_HOOKS=1`,`ALLOWED_ORIGINS=http://127.0.0.1:<端口>`),页面从 `http://127.0.0.1:<端口>/index.html` 打开,WebSocket 是真实连接。
- "真实输入"指只用 `page.keyboard.press` / `page.keyboard.type` / `page.mouse.click`,不调用 `__game` 的任何函数(允许读取 `G`、`__game.net.stats()` 来做判断和断言)。
- "零报错"指该页 `pageerror + console.error` 总数 = 0。
- 新测试套件:`node tests/run-all.js online`;服务端测试:`cd online && npm test`。

### A. 复用与一致性

| # | 验收项 | 通过标准 |
|---|---|---|
| O-01 | 服务器跑的就是 index.html | `sim-host` 从 `GAME_HTML` 加载 `#gm-main` 脚本;`online/src/` 中不出现任何游戏规则常量的定义(用 `grep -E "TARGETS\s*=|ITEMS\s*=|HOOK\s*=|RULESETS\s*=|TUG_K"` 检查,结果为空) |
| O-02 | 无头运行与浏览器一致(黄金对比) | 对战 × 种子 1–20:同一份按 tick 编号的输入脚本(每 37 tick 交替让 P1/P2 发射,钩子拉回且物品价值 < 50 时用炸药;商店买第一件买得起的商品后准备)分别在浏览器页面(`__game.press` + `advance`)和 vm 宿主里跑完整局:每关结算时 `[P1.money, P2.money]` 序列和 `G.final` 的 JSON **逐字节相同**(20/20) |
| O-03 | 无头加载零报错、资源 | vm 中加载脚本并跑完 20 局:零异常;同时建 20 个房间后进程 RSS ≤ 600 MB;单个房间对局中每 tick 平均耗时 ≤ 2 ms |
| O-04 | 快照往返 | 两整局(种子 1、2)中每 30 tick:客户端镜像按顺序 `apply` 全部增量后的状态,与服务器 `snapshot({full:true})` **深度相等**;中途新建连接收到的完整快照与服务器状态深度相等 |
| O-05 | 快照完整性(像素) | 页面 A 本地跑对战(种子 3,冻结 `G.t`,不画粒子和飘字),在 intro、play(含拔河、随机事件、熔岩、石门各至少 1 次)、results、shop、final 共 ≥ 20 个时刻取快照 → 页面 B `apply` → 两页渲染结果逐像素比较,差异像素 ≤ 0.5% |
| O-06 | 回归 | `node tests/run-all.js`(phase2、touch、logic、keys、shots、phase3 全部现有套件)全部通过;`cd server && npm test` 全部通过;golden1/golden2 与基准一致 |
| O-07 | 本地模式不变 | 电脑主菜单 AC-06(`MENU_ORDER`、`G.menuMode`、方向键/数字键行为)原样通过;没有进入联机时页面不建立任何 WebSocket(`page.on('websocket')` 计数 = 0) |

### B. 联机端到端(两个独立浏览器上下文)

| # | 验收项 | 通过标准 |
|---|---|---|
| O-10 | **完整对局(真实输入)** | 服务端 `FAST=1`、种子 5。上下文 A:按 `O` → 输入昵称"甲" → 点"创建房间";从页面读取房间码。上下文 B 打开 `/#room=<码>`,输入昵称"乙" → 点"加入"。双方各自用真实按键选角色并确认;对局中两边的机器人各自读本页 `G` 决定何时按 `ArrowDown`/`KeyS`;结算按空格;商店按 `KeyS` 购买、`KeyW` 准备;直到双方 `G.screen==='final'`(≤ 6 分钟)。要求:A 是玩家1、B 是玩家2;A、B 两页与服务器 `/__test/room/:code/state` 的 `G.final`(胜者、双方比分、关数)**完全一致**;两页零报错 |
| O-11 | 再来一局 | O-10 结束后双方按"再来一局":只有一方按下时,另一方显示"对方想再来一局!",房间不开局;双方都按 → 两页进入角色选择,房间码不变;再打完一局(可用 `advance` 之外的真实按键),比分仍三方一致 |
| O-12 | **注入延迟/抖动/卡顿** | 服务端 `NET_SIM='lat=100,jitter=50,stall=0.02:300'`(双向每条消息延迟 100±50 ms 并保持顺序;每条消息 2% 概率造成 300 ms 停顿,模拟 TCP 丢包重传),按 O-10 跑三局(种子 5、6、7):三局都到 final,三方比分一致,零报错 |
| O-13 | **出钩方向准确(手感核心)** | O-12 条件下,对每次发射比较 `stats().lastFire.shownAngle`(按键时客户端显示的自己钩子角度)与 `serverAngle`(服务器实际出钩角度):≥ 95% 的发射误差 ≤ 1.5°,其余(超出回看窗口的情况,占比 ≤ 2%)以外最大误差 ≤ 4° |
| O-14 | 本地预测即时、交接平滑 | O-12 条件下:按键后的**下一帧**,自己钩子显示为伸出、长度 > `HOOK.minLen`;伸出阶段(直到服务器报告抓到/打空)相邻两帧显示长度的变化与理论值(速度 × 帧间隔)之差 ≤ 30 px 的帧占 ≥ 98% |
| O-15 | 插值顺滑 | 无注入时:对手钩子摆动阶段相邻两帧角度差 ≤ 6° 的帧占 ≥ 99%;客户端插值延迟 `interpDelayMs` 中位数 ≤ 100 ms |
| O-16 | 抢同一物品(拔河) | 用 `/__test/room/:code/eval` 在场地布置一个金块,让 A 抓住;B 在 A 拉回时真实按键发射并打中:两页都进入拔河(`G.tug` 非空);双方真实连按 5 s,结束后两页物品归属、双方金币与服务器一致 |
| O-17 | 带宽 | O-10 对局期间每个客户端:下行平均 ≤ 25 KB/s,1 秒窗口峰值 ≤ 80 KB/s;上行平均 ≤ 2 KB/s |

### C. 断线、暂停、版本、触屏提示

| # | 验收项 | 通过标准 |
|---|---|---|
| O-20 | 掉线冻结与恢复 | 对局中用 `/__test/drop` 强行断开 B 的 TCP:服务器在下一 tick 冻结(此后 `G.time` 不变);A 在 1 s 内显示"〈乙〉连接中断"遮罩;B 在 3 s 内自动重连;3 s 倒计时后继续;冻结前后服务器 `G.time` 差 ≤ 1 tick;打到 final 三方比分一致 |
| O-21 | 刷新回座 | 对局中 B `page.reload()`:回到原座位(仍是玩家2),收到完整快照,状态与服务器深度相等,继续打完 |
| O-22 | 半开连接 | 用 `online/test/netem-proxy.js` 把 B 的流量黑洞化(不关闭连接):服务器 ≤ 8.5 s 判定掉线并冻结 |
| O-23 | 超时离开 | `SEAT_TIMEOUT=5s`、"结束对局"按钮出现时间改为 2 s:B 断开后不回来 → A 在 2 s 后看到"结束对局"按钮,5 s 后看到"对方已离开";之后房间从 `/__test/rooms` 中消失 |
| O-24 | 暂停 | 对局中 A 按 `P`:两页 `G.paused===true`,并显示"甲 暂停了游戏";B 选"继续" → 两页显示 3-2-1 倒计时,3 s(±0.2 s)后恢复;暂停期间服务器 `G.time` 不变。A 的标签页被隐藏(派发 `visibilitychange`,`document.hidden` 为 true)→ 服务器在 1 tick 内暂停 |
| O-25 | 版本不一致 | B 通过 `addInitScript` 设置 `__GM_BUILD_OVERRIDE` 使哈希不同:B 显示"游戏已更新,请刷新页面"和"刷新"按钮,服务器上该房间座位数不变 |
| O-26 | 防闯入 | 第三个上下文用正确房间码 → "房间已满";错误码 → "房间不存在";同一 IP 第 11 次错误码(1 分钟内)→ "操作太频繁"(`rate_limited`);伪造座位令牌 `resume` → `bad_seat`;`Origin: https://evil.example` 的升级请求 → HTTP 403;座位令牌从不出现在任何请求 URL 中(检查 `page.on('request')` 和 `page.on('websocket')` 的 URL) |
| O-27 | **触屏设备的联机提示** | `devices['iPhone 13 landscape']` 与 `devices['Pixel 7 landscape']`:①主菜单有"联机对战"灰色按钮,命中区域 ≥ 44 CSS px 且在安全区内(`?safe=47,0,47,21`);`touchscreen.tap` 后 1 帧内出现"联机对战需在电脑上进行",2.5 s(±0.2 s)后消失,`G.screen` 仍为 `start`;②打开 `/#room=K7M2QX`:显示提示层,文字含"联机对战需在电脑上进行"和完整链接;点"玩单人模式"后回到主菜单;③整个过程 WebSocket 计数 = 0,零报错;④`node tests/run-all.js touch` 全部通过 |

### D. 服务端单元/集成(`cd online && npm test`,node:test)

| # | 验收项 | 通过标准 |
|---|---|---|
| O-30 | 协议与限制 | 生成 10 万个房间码:全部长度 6、只含规定的 31 个字符,与在用房间码冲突时重新生成;> 1024 字节消息 → 断开(1009);非 JSON / 未知类型 → `bad_message`,累计 20 次断开;每连接令牌桶 40/s、突发 80,超限丢弃,10 s 内丢弃 > 200 条断开(1008);5 s 不握手 → 断开;同 IP 新连接 30 次/分钟、同时连接 8 个、建房 10 次/小时、错误码 10 次/分钟与 50 次/小时,各自在第"上限 + 1"次被拒;第 21 个房间 → `server_full`;`create` 消息里带任何模式字段都被忽略,房间模式始终为 `versus` |
| O-31 | 房间状态机 | 注入时钟 + `TICK_MODE=manual`:空闲回收(只有房主 30 分钟、无人在线 10 分钟、终局后 30 分钟、最长 6 小时)、座位保留 10 分钟、60 s 后出现"结束对局"、暂停/继续 3 s 倒计时、结算 6 s 自动前进或双方都按"继续"立即前进、双方"再来一局"、离开房间,全部在规定时刻(±1 tick)发生 |
| O-32 | 延迟补偿 | 手动 tick,钩子摆动中:`fire at=now−10` → 出钩相位等于历史第 now−10 tick 的相位(误差 < 1e-9),钩子长度等于补跑 10 tick 的结果;`at=now−25` → 角度按 now−25 锁定、只补跑 18 tick;`at=now−40` → 使用当前相位、不补跑;`at` 到现在之间钩子曾不在 swing → 按普通出钩处理;构造"对方已抓住物品"的场景,补跑后该物品 `grabbedBy` 不变(最多进入拔河) |

### E. 部署脚本

| # | 验收项 | 通过标准 |
|---|---|---|
| O-40 | 沙箱演练 | 用 `GM_ROOT` 临时目录 + PATH 里的假 `caddy / systemctl / ss / curl / useradd / id / npm / node`(记录每次调用)运行 `deploy-online.sh --domain goldminer.43.161.221.249.sslip.io`:①正常路径成功,生成的文件、权限、单元内容、env 内容符合 §4.3;②**原始 Caddyfile 校验失败** → 退出非 0,所有文件逐字节不变,没有调用 `systemctl`;③追加后校验失败 → Caddyfile 逐字节还原、`goldminer.caddy` 被删除、退出非 0;④reload 失败 → 还原并再次 reload,退出非 0;⑤现有站点改动后变得不可达 → 自动还原并 reload;⑥端口 8790 被其他程序占用 → 退出且无修改;`--port 8787`(以及 22/80/443/2019)被拒绝;⑦第二次运行:`import` 行仍只有 1 行、env 文件不被覆盖;⑧原 Caddyfile 末尾没有换行时,`import` 仍独占一行;⑨`uninstall-online.sh` 后 Caddyfile 与安装前逐字节相同,单元和站点文件已删除;`--purge` 另外删除程序、页面和 env 文件;⑩`--dry-run` 前后沙箱目录树哈希不变 |
| O-41 | 真实 Caddy 校验 | 用真实 `caddy` 二进制(Ubuntu 24.04 软件源的 2.6.x,或官方 2.x 静态包):对"用户现有 Caddyfile(§0 顶部所示内容,补全闭合括号)+ 追加的 import + 渲染后的模板"执行 `caddy validate` 通过;`caddy adapt` 的输出里,现有主机 `43.161.221.249.sslip.io` 的路由 JSON 在追加前后**完全相同**;新主机 `goldminer.43.161.221.249.sslip.io` 的 `/online/*` 指向 `127.0.0.1:8790`;整个配置不含 `log` |
| O-42 | 禁止事项 | O-40 所有场景的调用记录里:**没有** `apt-get install`、`nginx`、`certbot`、`ufw`、`systemctl restart caddy`、`systemctl stop caddy`、`kill`/`pkill`、任何安装或替换 Node 的命令;除禁用端口的提示文字外不出现 `8787`;`/etc/caddy/Caddyfile` 的 diff 只有末尾新增的 3 行 |
| O-43 | shellcheck | `deploy/*.sh` 全部 `bash -n` 通过,`shellcheck -S warning` 无问题(环境没有 shellcheck 时先 `pip install shellcheck-py`);`server/test/deploy.test.js` 的 D-01~D-05 仍全部通过 |
| O-44 | deploy.sh 保护 | 假 `ss` 报告 Caddy 占用 80/443 时,`deploy.sh` 在任何修改之前退出(非 0)并提示使用 `deploy-online.sh` |
| O-45 | 文档 | `DEPLOY-online.md` 包含 §4.7 全部 9 部分;示例命令使用 `goldminer.43.161.221.249.sslip.io`,并写明自定义域名的备选做法;写明"两人都需要用电脑";不含任何密码或令牌 |

### F. 视觉(截图,人工/Evaluator 目检)

| # | 验收项 | 通过标准 |
|---|---|---|
| O-50 | 电脑截图 | 1280×720:联机大厅、等待房间(房间码、复制按钮、"请让对方在电脑上打开链接")、角色选择(只有自己一侧可操作)、对局中(自己面板有"你"标签)、拔河、断线遮罩、暂停倒计时、商店(对方栏显示"选购中…")、终局(再来一局)、"游戏已更新"。中文无乱码、无裁切、无重叠,主要文字不被遮挡 |
| O-51 | 触屏提示截图 | iPhone 13 横屏:主菜单(含灰色"联机对战"按钮)、点按后的提示、邀请链接提示层。中文无裁切;按钮不压住 HUD 文字和单人卡片 |

---

## 6. 可测试性要求(Builder 必须提供)

| 钩子 | 用途 |
|---|---|
| `window.__game.net`(浏览器与 vm 都有) | `snapshot({full})`、`apply(msg)`、`fxDrain()`、`step()`(= 一次 `update(STEP)`)、`input(slot, action, arg)`、`fireBackdated(slot, phase, ticks)`、`hookHistory(slot)`、`build`(哈希) |
| `__game.net.stats()`(客户端) | `{ connected, you, room, rtt, offsetTicks, interpDelayMs, bufferLen, predActive, lastSnapTick, rxBytes, txBytes, lastFire: { shownAngle, serverAngle } }` |
| 客户端 URL 参数 | `?server=ws://127.0.0.1:<端口>/online/ws`(覆盖服务器地址,`file://` 测试用);`?netdebug=1` 在右下角显示 RTT / 插值延迟 / 缓冲长度 |
| 客户端测试覆盖 | `window.__GM_BUILD_OVERRIDE`(在脚本加载前设置,替换本地计算的哈希,仅用于 O-25) |
| 服务端环境变量 | `PORT, HOST, GAME_HTML, ALLOWED_ORIGINS, TRUST_PROXY, SERVE_STATIC`;`FAST=1`(vm 以 `?fast=1` 加载,每关 10 s);`SEAT_TIMEOUT`、`END_OFFER_AFTER`(默认 60 s)及各回收时限;`TICK_MODE=manual`;`NET_SIM`;`ONLINE_TEST_HOOKS=1` |
| 测试 HTTP 接口(仅 `ONLINE_TEST_HOOKS=1` 且 `NODE_ENV!=='production'` 时存在) | `GET /__test/rooms`;`GET /__test/room/:code/state`(服务器完整快照);`POST /__test/room/:code/seed`;`POST /__test/room/:code/eval`(在该房间 vm 里布置物品等);`POST /__test/step?n=60`(手动 tick);`POST /__test/drop?room&slot`(强行断开 TCP) |
| 网络代理 | `online/test/netem-proxy.js`:浏览器与服务端之间的 TCP 代理,可设延迟、抖动、黑洞(O-22) |
| 注入时钟 | `createServer(config, { clock })`,所有限流、超时、回收都用它 |

---

## 7. 实施顺序(Builder 分步完成,每步都跑回归 O-06)

1. **M1 无头宿主**:`index.html` 可在 vm 中加载;`__game.net` 的服务端部分;物品 id 化。验收 O-01~O-03、O-06。
2. **M2 快照**:`snapshot / apply / fxDrain`、增量。验收 O-04、O-05。
3. **M3 服务端**:房间、协议、限流、暂停、断线、延迟补偿。验收 O-26、O-30~O-32。
4. **M4 电脑客户端**:联机入口、大厅、等待房间、角色选择、插值、本地预测、断线/暂停遮罩、版本提示。验收 O-07、O-10~O-17、O-20~O-25、O-50。
5. **M5 触屏提示**:触屏主菜单灰色按钮、邀请链接提示层。验收 O-27、O-51。
6. **M6 部署**:`deploy-online.sh / update-online.sh / uninstall-online.sh`、模板、`deploy.sh` 保护、`DEPLOY-online.md`。验收 O-40~O-45。

全部完成后:`node tests/run-all.js`(含新的 online 套件)、`cd server && npm test`、`cd online && npm test` 一次性全部通过。
