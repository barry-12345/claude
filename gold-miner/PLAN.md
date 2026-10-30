# 黄金矿工 · 单人模式 + 10 个"更好玩"创意 — 设计方案 (PLAN)

> 读者:用户(审批)、Builder(实现)、Evaluator(验收)。
> 本轮**只实现 A 部分(单人模式)**。B 部分 10 个创意只是提案,除非用户审批时点名要做。
> 文中行号指当前 `index.html`(3230 行)的大致位置,仅作定位参考。

---

## 0. 一页速览

| 项 | 结论 |
|---|---|
| 新模式 | **单人模式**:一名矿工站在**屏幕正中**,一人独占整片矿场 |
| 按键 | S/W/A/D **或** ↓/↑/←/→ 都能操作这一个人(两套键等价),菜单可按 1/2/3 直选模式 |
| 难度 | 8 关累计目标 **1000 → 17200**(实测:熟练机器人 100% 通关,新手机器人约一半,乱按 ≈2%) |
| 单人专属玩法 | ① **每关 1–3 星评级**(超额才有意义)② **星级奖励**:2★ 商店 9 折、3★ 8 折 + 送 1 炸药 ③ **商店刷新货架** ④ **最佳纪录"幽灵线"**:实时显示"纪录同期金币",和自己赛跑 ⑤ 单人最佳纪录(通关数/总星数/金币) |
| 关闭的东西 | 拔河、合作合力(只有一个钩子,天然不会触发)、闪电瓶(不生成)、护盾(不出售/骰子不给) |
| 对战/合作 | 规则、数值、随机序列**完全不变**,用"同种子逐关金币一致"的黄金对比来验收 |
| 创意推荐先做 | ①连击倍率 ②悬赏委托 ④黄金尾声 ⑤关前抉择卡(详见第 6 节) |

---

## 1. 定位与技术路线

- 仍然是**单个 HTML 文件**(`/home/user/gold-miner/index.html`),Canvas 2D + WebAudio,所有图形代码绘制,所有 UI 简体中文。
- **在现有代码上扩展,不重写**。沿用现有约定:
  - 常量放顶部(新增 `SOLO_TARGETS`、`STAR_MULT`、`MENU_ORDER`、`SOLO_CFG` 等);
  - 表驱动(`ITEMS / SHOP / CHARS / THEMES / EVENTS` 不改结构,只按模式过滤);
  - `G` 状态机的屏幕不增加新 screen,只在 `start / select / intro / play / results / shop / final` 内按 `G.mode === 'solo'` 分支;
  - 固定步长 `STEP = 1/60`、`window.__game` 测试钩子全部保留,只增不减。
- **新增模式值** `G.mode = 'solo'`,新增 `isSolo()`;`isCoop()` 语义不变。
- **硬约束(回归)**:对战/合作路径上**不得新增、删除或重排任何 `Math.random()` 调用**;所有 solo 判断必须在随机调用之前短路或位于 solo 专属分支内。否则第 4 节的"黄金对比"会失败。
- **第 0 步(Builder 必做,先于任何修改)**:把当前文件原样复制为 `/home/user/gold-miner/tests/baseline.html`,作为回归基准。

---

## 2. 单人模式:范围

### 2.1 做什么(IN)

1. 主菜单 3 张模式卡:**单人模式 / 对战模式 / 合作模式**(从左到右)。
2. 单人角色选择(6 个角色全部可选,被动照常生效)。
3. 单人对局:1 名矿工居中,8 关 × 60 秒,4 个矿区主题、6 个随机事件、所有可抓物品(闪电瓶除外)照常。
4. 单人目标曲线 `SOLO_TARGETS`、单人专属物品密度参数。
5. **星级评价**(每关 0–3★,全局 24★)+ HUD 实时星级面板。
6. **星级奖励**:按本关星数给商店折扣/赠品。
7. 单人商店:居中单栏,固定 6 件商品 + **刷新货架** + 准备好了。
8. 单人结算页、单人终局页(通关数、总星数、逐关星条、最佳纪录、新纪录提示)。
9. **单人最佳纪录**(localStorage `goldminer.soloBest`)+ **纪录幽灵线**(HUD/结算显示"纪录同期 $X")。
10. 暂停菜单在单人下正常工作(继续 / 重新开始〔仍为单人同角色〕/ 返回主菜单)。
11. 种子化随机 `?seed=N` 与 `__game` 新测试接口(第 5 节)。

### 2.2 明确不做(OUT)

- 不做第 6 节的任何创意(除非用户审批时点名)。
- 不改对战/合作的任何规则、目标、物品权重、商店、结算(UI 上只有主菜单变成 3 张卡、方向键改为"左右移动选择")。
- 不做电脑 AI 对手、无尽模式、难度选择、在线排行榜、局外成长/解锁、角色主动技能、触屏/手柄。
- 不新增物品、主题、事件、商店道具(单人只做过滤和折扣/刷新)。
- 不按角色分别记录单人纪录(全局一份)。

---

## 3. 关键机制与参数

### 3.1 按键映射

| 场景 | 单人模式 | 说明 |
|---|---|---|
| 主菜单 | A / ← 向左一格,D / → 向右一格(不循环,到边停住);**1 / 2 / 3** 直选 单人/对战/合作;Tab 翻图鉴;空格 确认 | 对战/合作共用此菜单 |
| 角色选择 | A/D **或** ←/→ 选择;S **或** ↓ 确认;W **或** ↑ 取消;确认后 0.8 秒自动开始或按空格立即开始;Esc 返回 | |
| 游戏中 | S **或** ↓ 发射钩子;W **或** ↑ 使用炸药;P / Esc 暂停;M 静音 | |
| 结算 | 空格 继续 | |
| 商店 | A/D **或** ←/→ 选择;S **或** ↓ 购买/执行;W **或** ↑ 准备好了 | |

实现方式:在 `handleKey` 入口,若 `G.mode === 'solo'` 且屏幕属于 `select / play / shop`,先做按键归一化 `ArrowDown→KeyS, ArrowUp→KeyW, ArrowLeft→KeyA, ArrowRight→KeyD`,再走原逻辑(单人玩家的 `cfg.keys` 用 P1 那套)。
暂停菜单原本就接受 W/S/↑/↓,不需改。主菜单新增 `Digit1/2/3`(以及 `Numpad1/2/3`)。

> 行为变化(唯一会影响老玩家的地方):以前主菜单"A=对战、D=合作"是直选;现在是"左右移动一格"。从默认的"对战"出发,按 D 仍到"合作"、从"合作"按 A 仍到"对战",按 A 从"对战"会到"单人"。

### 3.2 玩家与场地

- `G.players` 在单人下**只有 1 个元素**(不要用"P2 已淘汰"冒充,否则会画墓碑/淘汰面板)。
- `SOLO_CFG = { id: 0, name: '玩家', color: '#2f7cf6', dark: '#1c4fb0', x: 640, keys: P1 的键, labels: { fire: 'S/↓', dyn: 'W/↑', left: 'A/←', right: 'D/→', buy: 'S/↓', ready: 'W/↑' } }`。
  - 绞盘 `p.x = 640`(屏幕正中),矿工身体 `p.mx = 590`,`dir = 1`。
- `reachable()` 只按这一个玩家判断(x=640 时,深处整宽都可达,浅层两角不可达,这是期望的)。
- 必须加保护的两人假设(Builder 逐条处理):
  - `updatePlay` 的 `order = Math.random()<0.5?[0,1]:[1,0]` —— **对战/合作保持原样**;单人直接 `for (const p of G.players)`,**不调用** `Math.random()`。
  - `otherPlayer(p)` 单人返回 `undefined`;`findHit` 已有 `q &&` 保护,确认无其它解引用。
  - `deliver` 的 bolt 分支已有 `!o` 保护(单人本就不生成闪电瓶)。
  - `startGame` 按模式建玩家:solo → `[newPlayer(SOLO_CFG)]`,`p.char = G.chars[0]`。
  - `selectKey / beginWithChars / update('select')`:单人只看 `G.sel[0]`。
  - 商店 `G.shop` 长度 1;`updateShop` 只等 1 人准备。
  - 所有 `drawXxx` 中 `G.players.forEach((p,i)=> x = 60 + i*620 …)` 一类布局,单人走单独绘制函数。

### 3.3 目标曲线(累计)

```
SOLO_TARGETS = [1000, 2300, 3900, 5900, 8200, 10800, 13800, 17200]
每关增量 inc  =  1000, 1300, 1600, 2000, 2300, 2600, 3000, 3400
```

依据(我用 Playwright 跑了 4 档机器人 × 40 局,种子化,事件随机开启,不购物,详见附录 A):

| 机器人 | 通过第1关 | 通过第3关 | 通过第5关 | 通过第7关 | 8 关全通 | 平均星数 |
|---|---|---|---|---|---|---|
| 乱按(完全不瞄准) | 75% | 48% | 18% | 8% | **2%** | 3.2 |
| 新手 | 95% | 92% | 90% | 70% | **55%** | 9.6 |
| 熟练 | 100% | 100% | 100% | 100% | **100%** | 14.2 |
| 完美 | 98% | 98% | 98% | 98% | 98% | 18.1 |

真人通常介于"新手"和"熟练"之间,且会在商店花钱,所以这条曲线对真人是"能通关但要认真打"。

### 3.4 物品密度(单人)

- 物品数量公式不变:`n = round(28 + 1.5·r ± 2)`(一个人独占整片场地,单钩每关大约能清掉 60–90% 的价值,不会无事可做)。
- 保底价值:`need = max(1700, inc × 2.1 + 500) × hazardBoost` —— 单人用 **2.1**(与合作相同;对战仍是 2.7)。
- 权重:单人下 `w.bolt = 0`(现有 `aliveCount < 2` 条件已满足,确认即可)。其余权重与对战相同。

### 3.5 星级评价(单人专属核心)

每关结束时:

| 星数 | 条件 |
|---|---|
| 0★ | 累计金币 < 本关目标(失败;若有免死金牌则"保住"但仍 0★) |
| 1★ | 累计金币 ≥ 本关目标 |
| 2★ | 1★ 且 **本关收入** `p.roundGain` ≥ 1.5 × inc |
| 3★ | 1★ 且 本关收入 ≥ 2.0 × inc |

- `STAR_MULT = [1.5, 2.0]`;纯函数 `starsFor(round, roundIncome, cumulative)` 返回 0–3。
- **游戏中实时**:星数提升瞬间在矿工头顶弹出"★2!"/"★3!"(复用 `floatText` + `diamond` 音效)。
- `G.stars[round-1]` 记录每关星数;全局满分 24★。

### 3.6 星级奖励(进入商店时结算)

| 本关星数 | 奖励 |
|---|---|
| 0–1★ | 无 |
| 2★ | 本次商店全部商品 **9 折**(含刷新价) |
| 3★ | 本次商店全部商品 **8 折** + **免费 +1 炸药**(商店顶部提示"3 星奖励:炸药 +1") |

价格:`price = round(basePrice × discount / 5) × 5`,`basePrice` 为现有公式结果;每件商品都保存 `basePrice`、`price`。

### 3.7 单人商店

- 布局:居中单栏(原单人半屏布局,`x0 = 320`),3 列 × 3 行 = 6 件商品 + **刷新货架** + **准备好了**。
- 商品池:`shopPool` 去掉 `shield`;`medal` 在已持有时去掉。固定 **6** 件(单人不掷 5/6)。
- 幸运骰子 `resolveDice` 在单人下也排除 `shield`。
- **刷新货架**:价格 `30 + 15 × round`,同一次商店里每再刷新一次 +30(再乘折扣)。刷新时重新抽 6 件,排除 `p.pending` 里已买到的加成、已持有的免死金牌;已买的效果保留。钱不够 → "金币不足!" + `deny` 音效。
- 底部提示:`A/← D/→ 选择    S/↓ 购买    W/↑ 准备好了`。
- 顶部显示:金币、下一关目标与差额、本次折扣("2 星奖励:9 折")。

### 3.8 结算、终局与纪录

- `endRound`(solo 分支):`passed = p.money ≥ target`;未通过且有金牌 → 消耗金牌、`saved`;否则 `over`。计算星数、记录 `G.soloCum[round-1] = p.money`。
- **结算页**(单人专用版式,居中大面板):本关收入、捕获件数、当前总金币、过关目标、进度条;**星星依次盖章动画**(0.25 秒一颗);"比纪录同期 +$X / −$X"(有纪录时);下一商店折扣提示;底部"按空格进入商店 / 查看最终结果"。
- `afterResults`:`over` 或 第 8 关 → `finishGame`;否则 `openShop`。
- **终局页**(单人):胜利"全部通关!"+ 奖杯 + 彩带 / 失败"挑战结束";通过关卡 X/8、总星数 Y/24、最终金币、角色;**8 格逐关星条**;最佳纪录 + "新纪录!"闪烁。空格 = 同角色重开单人;Esc = 主菜单。
- **最佳纪录** `goldminer.soloBest = { cleared, stars, money, char, perRound: [每关结束时累计金币…] }`。比较顺序:通关数 > 总星数 > 金币。与合作纪录 `goldminer.coopBest` 互不影响。所有读写沿用 `lsGet/lsSet` 的 try/catch。
- **纪录幽灵线**:游戏中右侧星级面板显示"纪录同期 $X"(= 最佳纪录在本关结束时的累计金币;没有该关数据则不显示),当前累计 ≥ 它时绿色,否则橙色;左侧进度条上同时画一个小旗标记。

### 3.9 HUD(单人)

- 左面板(x=10, w=480):头像、"单人 · 角色名"、累计金币、朝目标的进度条(+纪录小旗)、炸药数、加成图标。
- 中面板(500–780):沿用对战版式:"第 r / 8 关"、"目标 $X"、倒计时。
- 右面板(x=790, w=480):"本关收入 +$X";三颗星,下标分别为"达标 / $1.5×inc / $2×inc",已达成的填金色;"纪录同期 $X"。
- 第 1 关前 8 秒的按键提示居中(x=640):"S/↓ 发射钩子    W/↑ 使用炸药"。

### 3.10 主菜单与选择页

- 3 张卡:`x = 40 + i × 406`, `w = 386`, `h = 84`(y=82)。每张卡:名称、一句话说明、键帽 "1"/"2"/"3"、选中时金色描边。
  - 单人:"一人独占矿场 · 冲 3 星拿高分",下方"最佳: 第 X 关 · ★Y · $Z / 暂无"。
  - 对战:原文案。合作:原文案 + 合作最佳纪录。
- 标题旁的小字由"双人同屏"改为"单人 / 双人同屏"。
- 规则面板:新增 `RULES.solo`(5 条):一人独占矿场;8 关×60 秒,累计金币低于目标即结束;目标 1000→…→17200;每关按本关收入评 1–3 星,星越多下次商店越便宜;刷新纪录和自己的"幽灵"赛跑。
- 操作说明面板:单人时显示单列"玩家:S 或 ↓ 发射 …"。
- `MENU_ORDER = ['solo', 'versus', 'coop']`,`G.menuMode` 为其下标;读取 `goldminer.mode` 时按名字找下标,找不到默认 `versus`(与现在一致)。
- 选择页(单人):6 张角色卡同现在,只有一个选中框;下方一个居中面板(x=360, w=560)显示所选角色与按键提示;底部"确认后开始    Esc 返回"。

### 3.11 其它模式交互规则在单人下

| 机制 | 单人下 |
|---|---|
| 拔河 | 不可能触发(只有一个钩子),`G.tug` 恒为 null |
| 合作合力 | 不可能触发,`assist` 状态不出现 |
| 闪电瓶 | 不生成 |
| 护盾 | 不出售、骰子不给 |
| 免死金牌 | 照常,可救一次 |
| 大力熊"拔河 +30%"、时光博士"冻结减半" | 无效但无害,其余被动正常;选择页不改文案 |
| 随机事件 | 6 个全部照常(第 2 关起 50%) |

---

## 4. 量化验收标准(Evaluator 逐条验证)

所有自动化用 Playwright(`/opt/node22/lib/node_modules/playwright`,浏览器在 `/opt/pw-browsers`)加载 `file:///home/user/gold-miner/index.html`。"机器人"定义见附录 A。除标明"真实按键"的条目外,可通过 `__game.press()` + `__game.advance()` 驱动。

### A. 稳定性

| # | 验收项 | 通过标准 |
|---|---|---|
| AC-01 | 三种模式整局零报错 | 单人/对战/合作 × 种子 1–20,"熟练"机器人从开局一直打到 final 屏:`pageerror` 与 `console.error` **总数 = 0**,且每局都到达 `G.screen === 'final'` |
| AC-02 | 测试钩子向后兼容 | `window.__game` 仍包含现有全部成员(`G, ITEMS, TARGETS, COOP_TARGETS, SHOP, HOOK, FAST, LEGEND_PAGES, Snd, press, advance, generateLevel, levelWorth, hookTip, endRound, makeItem, explodeTNT, startGame, startRound, selectKey, reshuffle, spawnMeteor, tugPress, resolveTug, startTug, rollEvent, slabState, ventState, slabBlocks, plumeAt, burnHook, occFor, CHARS, EVENTS, THEMES, themeOf, pauseGame, resumeGame, loadBest, saveBest, deliver, finishGame, afterResults, shopAction, openShop, curTarget`),并新增第 5 节列出的成员 |

### B. 回归(对战 / 合作不变)

| # | 验收项 | 通过标准 |
|---|---|---|
| AC-03 | **黄金对比** | 对 `tests/baseline.html` 与新 `index.html`,用附录 B 的"定时乱按+买第一件"脚本,在**同一次同步 `evaluate` 内**跑完整局,模式 ∈ {versus, coop} × 种子 1–10:每关结算时 `[P1.money, P2.money, G.teamMoney]` 序列、`G.final.winner / cleared / victory` **逐字节相同**(20/20) |
| AC-04 | 对战/合作的数值未动 | `TARGETS`、`COOP_TARGETS`、`ITEMS`、`SHOP`、`CHARS`、`EVENTS` 与基准深度相等;合作模式下 `goldminer.coopBest` 读写行为不变 |
| AC-05 | 对战/合作真实按键冒烟 | **真实按键**:主菜单按 `Digit2` → 空格 → P1 按 `KeyS`、P2 按 `ArrowDown` 确认 → 0.8 s 后 `G.mode==='versus'`、`G.players.length===2`、进入 intro;同样 `Digit3` 走合作 |

### C. 菜单与按键(真实按键)

| # | 验收项 | 通过标准 |
|---|---|---|
| AC-06 | 3 卡模式选择 | 清空 localStorage 后加载:默认选中"对战"(`G.menuMode===1`);`ArrowLeft` → 单人(0);再 `ArrowLeft` 仍是 0(不循环);`KeyD` ×5 → 2;`Digit1/2/3` 直选;全部只用 `page.keyboard.press` |
| AC-07 | 模式记忆 | 选单人后按空格进入选择页,刷新页面 → 主菜单仍选中单人(`goldminer.mode === 'solo'`) |
| AC-08 | 单人两套键等价 | 单人选择页:`ArrowRight` 与 `KeyD` 各移动一格;`ArrowDown` 或 `KeyS` 都能确认;游戏中 `ArrowDown` 与 `KeyS` 都能让 `hook.state` 从 swing 变 extend;`ArrowUp` 与 `KeyW` 都能在拉回时用炸药(`p.dyn` 减 1) |

### D. 真实用户端到端(只用 `page.keyboard.press`,不调用任何 `__game` 函数;允许读取 `G` 做断言/决策)

| # | 验收项 | 通过标准 |
|---|---|---|
| AC-09 | 单人整局(快速) | `index.html?fast=1&seed=3`:`Digit1` → `Space` → `ArrowRight`×2 → `ArrowDown`;断言 `G.mode==='solo'`、`G.players.length===1`、`G.players[0].char===2`、`G.players[0].x===640`;之后每 700 ms 交替按 `ArrowDown`/`KeyS`,results 屏按 `Space`,shop 屏按 `KeyS` 再按 `KeyW`,直到 `G.screen==='final'`(≤ 6 分钟);零报错;`localStorage['goldminer.soloBest']` 可解析且含 `cleared, stars, money, char, perRound` |
| AC-10 | 单人真人节奏通关第 1 关 | 正常速度 `?seed=1/2/3`:脚本每帧读 `G` 用附录 A 的"熟练"策略决定,**按键用 `page.keyboard.press('ArrowDown')`/`('ArrowUp')`**;3/3 局第 1 关结算 `stars ≥ 1`;随后在商店用 `ArrowRight` 移到一件买得起的商品(第一件就买得起则不必移动)、`ArrowDown` 购买(金币减少 = 该商品 `price`)、`ArrowUp` 准备 → 进入第 2 关 intro |
| AC-11 | 单人暂停 | 游戏中按 `KeyP` → `G.paused===true`;`ArrowDown` + `Enter` → 重新开始,仍为单人、同角色、第 1 关;再暂停 → `ArrowDown`×2 + `Enter` → 回到 start 屏 |

### E. 单人规则正确性

| # | 验收项 | 通过标准 |
|---|---|---|
| AC-12 | 难度曲线(核心) | 种子 1–50,完整游戏流程(含 intro/results/shop,机器人在商店直接准备不购物),统计"通过关数": **乱按**:8 关全通 ≤ 10%,通过 ≥3 关 ≤ 65%;**新手**:通过第 1 关 ≥ 85%,8 关全通在 30%–80% 之间;**熟练**:8 关全通 ≥ 90%,平均总星数在 11–19;**完美**:8 关全通 ≥ 95%,平均总星数 ≥ 15 |
| AC-13 | 星级函数 | `starsFor` 边界:以第 1 关(inc=1000,目标 1000)为例:(999 收入,累计 999)→0;(1000,1000)→1;(1499,1499)→1;(1500,1500)→2;(1999,…)→2;(2000,2000)→3;(2500 收入,累计 900)→0 |
| AC-14 | 无闪电瓶/护盾/拔河 | 种子 1–50 × 8 关生成的单人关卡中 `bolt` 数 = 0;所有单人商店(含每次刷新后)无 `shield`;骰子结果从不为 `shield`;AC-12 全部对局中 `G.tug` 始终为 null,`hook.state` 从未出现 `tug`/`assist` |
| AC-15 | 可达性与保底 | 单人关卡每个物品满足 `|x−640| ≤ (y−PIVOT_Y)·tan66°`;种子 1–50 × 8 关中 ≥ 95% 的关卡 `levelWorth ≥ need`(need 按 3.4 节) |
| AC-16 | 星级奖励 | 强制第 1 关 3★ 后 `openShop`:每件商品 `price === round(basePrice×0.8/5)×5`,`p.dyn` 比结算前多 1;2★ 时为 0.9 折且炸药不变;0–1★ 时 `price === basePrice` |
| AC-17 | 刷新货架 | 第 3 关商店、金币充足:选中刷新卡按 `KeyS` → 金币减少 `(30+15×3)×折扣`(取整到 5),`s.rerolls` 加 1,刷新价 +30;新货架 6 件、不含已买到的加成;金币不足时金币不变且出现"金币不足!" |
| AC-18 | 失败与免死金牌 | 单人第 2 关强制把金币设为目标−1 并结束本关:无金牌 → 结算显示失败、`afterResults` 进入 final;有金牌 → 金牌被消耗、0★、进入商店 |
| AC-19 | 纪录 | 第一次单人终局写入 `goldminer.soloBest` 且 `G.final.newBest===true`;同条件更差的一局不覆盖;`perRound` 记录每一关(含失败的那一关)结束时的累计金币,`perRound.length === 终局时的 G.round`;`goldminer.coopBest` 不受影响 |
| AC-20 | 单人 `G` 结构 | 单人对局中 `G.players.length===1`、`G.shop.length===1`、`G.stars.length === G.round`(结算后) |

### F. 视觉检查(截图,人工/Evaluator 目检)

| # | 验收项 | 通过标准 |
|---|---|---|
| AC-21 | 截图 7 张 | 1280×720 截:主菜单(选单人)、单人选择页、单人第 1 关游戏中、单人结算(带星)、单人商店(带折扣)、单人终局(胜利)、单人终局(失败)。要求:中文无乱码、无文字互相重叠或被裁切、矿工位于正中、三颗星和纪录线可见 |

---

## 5. 可测试性要求(Builder 必须提供)

1. **种子随机**:URL 带 `?seed=N`(整数)时,脚本最开头执行 `Math.random = mulberry(N)`(mulberry 移到最前或复制一份)。不带参数时行为与现在完全相同。另提供 `__game.reseed(n)`。
2. `__game.startMode(mode, chars = [0, 1])`:设置 `G.mode`、`G.chars` 并直接 `startGame()`(跳过菜单)。
3. 新常量/函数挂到 `__game`:`SOLO_TARGETS, STAR_MULT, MENU_ORDER, PIVOT_Y, W, H, isSolo, starsFor, loadSoloBest, saveSoloBest, targets`。
4. 新状态字段(放 `G` 上,便于读取):`G.stars[]`、`G.soloCum[]`、`G.shop[0].discount`、`G.shop[0].rerolls`、`G.shop[0].rerollPrice`、`G.shop[0].rerollIdx`(刷新卡在卡片列表中的下标)、每件商品 `basePrice`、`G.results[0].stars`。
5. `shopAction(0, 'reroll')` 可直接触发刷新(按键路径为选中刷新卡后按购买键)。
6. 不新增"只在真实时间下才发生"的逻辑:游戏逻辑只依赖 `update(dt)`,保证 `advance()` 与真实运行一致。
7. 渲染路径可以继续用 `Math.random`(屏幕震动),但**逻辑路径**新增的随机数只能出现在 solo 分支。

---

## 6. B 部分:为什么"有点无聊" + 10 个新创意

### 6.1 诊断(基于代码与实测)

| # | 原因 | 证据 |
|---|---|---|
| D1 | **目标太松,没有压力** | 一个"每 47 帧按一次、完全不瞄准"的脚本:对战两人都通关 8 关,合作打到 $27,865(目标 $17,000);"随机时机乱按"机器人合作 8 关通关率 ≥ 90% |
| D2 | **每一钩的决策太浅** | 物品价值固定、全部可见;最优策略就是"挑价值/重量最高的拉",上一钩对下一钩没有任何影响(只有四叶草例外) |
| D3 | **关内节奏平,尾段空转** | 单钩完美机器人 60 秒能清掉约 90% 的场地价值,最后十几秒只剩石头;大石头(重 9)拉回速度 40 px/s、铁锚 30 px/s,一次就是 10–15 秒什么都做不了 |
| D4 | **8 关同质** | 每关目标都是"累计到 $X";主题 2 关一换;事件只有 50% 且淘金热/大风只是数值变化 |
| D5 | **商店是一次性小数值** | 13 件里 11 件是"下一关 ×1.3/×1.5/×1.6",没有贯穿整局的构筑和组合;在对战里花钱还会离目标更远,常常最优解是"不买" |
| D6 | **反馈缺少起伏** | 抓到 $50 和 $800 的手感差不多(都是飘字+音效),没有连续奖励、顿帧、慢动作 |

### 6.2 十个创意(均未实现过;不含局外成长、不含角色主动技能)

| # | 名称 | 一句话 | 怎么玩 | 解决 | 成本 | 适用 |
|---|---|---|---|---|---|---|
| 1 | **连击倍率** | 连续抓好东西,越抓越值钱 | 连续抓到"有价值物品"(≥$100)连击 +1,倍率 ×1.0→1.2→1.5→2.0(上限);抓到石头/垃圾或空钩则清零;HUD 显示连击条,倍率升级时有音阶上升 | D2 D6:每一钩都有"要不要冒险去够那颗钻石"的取舍;炸药变成"保连击"的工具 | S | 全部 |
| 2 | **悬赏委托** | 每关 3 张小任务,做完拿奖金 | 开局展示 3 张随机委托,如"抓 2 颗宝石 +$300"、"连续 3 钩不空 +$200"、"最后 10 秒抓到大金块 +$400"、"一钩不用炸药 +$150";对战中谁先完成谁拿 | D2 D4:每关有不同小目标,逼你改变路线而不是一味贪大 | M | 全部 |
| 3 | **绞盘节奏** | 拉重物时跟着节拍按键能加速 | 拉回重量 ≥3 的物品时,绞盘上出现节拍圈,踩点按发射键拉速 +60%,踩空停顿 0.3 秒;拔河中不触发 | D3:把"干等 10 秒"变成小游戏 | S–M | 全部 |
| 4 | **黄金尾声(矿脉喷发)** | 最后 15 秒地下涌出新宝藏 | 剩 15 秒时屏幕一震,中浅层喷出 4–6 个新金块/宝石,这段时间金块价值 ×1.5,配倒计时心跳音 | D3 D1:尾段从"捡石头"变成"最后冲刺",时间管理更有意思 | S | 全部 |
| 5 | **关前抉择卡** | 每关开始前 2 选 1 规则卡 | 第 2 关起抽 2 张卡选 1:如"贪婪:目标 +20%,宝石 ×2"、"轻装:时间 −15 秒,拉速 +40%"、"迷雾:物品被遮住直到钩子靠近,收入 ×1.3"、"炸药雨:TNT ×3,每次爆炸 +$50";对战由落后的一方选(追分机制),合作轮流选 | D4 D1:每关规则都不一样,主动选择风险 | M | 全部 |
| 6 | **本局遗物** | 每 2 关免费选 1 件、整局有效的遗物 | 第 2/4/6 关后 3 选 1,可叠加组合:"钻石之心:每颗宝石 +$80"、"爆破执照:被炸碎的物品返还一半价值"、"老练绞盘:重量≥5 拉速 +50%"、"磁力手套:小金块自动吸附"…每局结束清空 | D5:一局内有构筑和流派,不是局外成长 | M | 全部 |
| 7 | **反弹钩·花式射击** | 钩子碰墙会反弹一次 | 钩子碰到左右边界反弹一次继续前进,反弹后抓到的东西 ×1.5 并显示"花式!";可以绕过石门、岩浆柱打角度 | D2:增加瞄准技巧上限和"秀操作"时刻 | M | 全部 |
| 8 | **主题守护兽关** | 每个主题第 2 关出现一只巨型守护兽 | 第 2/4/6/8 关出现在场地中游走的守护兽(草原金牛、冰原雪怪、火山熔岩龟、古墓法老之灵),每钩中一次掉落一包战利品,命中 3 次击败得 $1,500;它会周期性干扰(撞歪钩子/扔雪球) | D4:给每个主题一个高潮关 | L | 全部 |
| 9 | **手感强化包** | 让大收获"有分量" | 抓到时 60 ms 顿帧;≥$500 物品 0.3 秒慢动作 + 镜头轻推;金币数字滚动上涨;重物拉回时绳子吱呀声随重量变调;钩子擦过贵重物品时飘"差一点!";最后 10 秒心跳 | D6:同样的玩法,爽感明显提升 | S | 全部 |
| 10 | **双人互动升级** | 给两人之间更多"交锋" | 对战:商店"黑市"新增干扰道具(落石:往对手半场掉 3 块石头;烟雾弹:对手下一关没有瞄准虚线;分赃钩:对手下一次大收获分你 30%)。合作:两人 1.5 秒内先后入账触发"默契"+20% | D2 D4:对战不只拼手速,合作更讲配合 | M | 对战/合作 |

### 6.3 推荐先做(3–4 个)

1. **#1 连击倍率**(S)—— 投入最小、对"每一钩都有意义"的改善最大,也自然把"空钩/抓石头"变成真正的惩罚。
2. **#4 黄金尾声**(S)—— 直接修掉尾段空转,让每关都有一个高潮。
3. **#2 悬赏委托**(M)—— 让 8 关不再千篇一律,小目标驱动不同打法。
4. **#5 关前抉择卡**(M)—— 让玩家主动选风险,对战里还附带追分机制。

顺手可加:**#9 手感强化包**(S),与 #1 一起做效果最好。
如果连击和委托都做,合作/对战目标需要同步重新校准(见问题 3)。

---

## 7. 需要用户拍板的问题

**Q1. 单人难度用哪档?**
- (a) **标准(推荐)**:`1000→17200`,熟练玩家稳过、新手约一半能通关,星级拉开高手差距。
- (b) 更难:后 4 关目标再 +10%。
- (c) 更宽松:后 4 关目标 −10%。

**Q2. 这一轮要不要顺带做创意?**
- (a) **只做单人模式(推荐)**:对战/合作可以严格按"同种子逐关一致"验收,风险最低;下一轮再做 #1/#2/#4/#5。
- (b) 单人 + #1 连击 + #4 黄金尾声(两个都是 S),这样对战/合作的回归改为"除新机制外不变",验收会更复杂。

**Q3. 实测合作模式偏简单(不瞄准乱按也能 8 关通关),要不要调目标?**
- (a) **这轮不动,等做创意时一起重新校准(推荐)**。
- (b) 这轮就把合作目标提高约 30%(会打破 AC-03 的合作黄金对比,改为只对比对战)。

---

## 附录 A:验收机器人定义(Evaluator 照此实现)

在页面内运行,只使用 `window.__game`。

```js
const g = window.__game, G = g.G, H = g.HOOK, PIVOT_Y = 198, STEP = 1 / 60;
// 当前钩子方向射线上最先碰到的物品
function firstHit(p) {
  const a = p.hook.angle, sx = Math.sin(a), cy = Math.cos(a);
  let best = null, bd = 1e9;
  for (const it of G.items) {
    if (it.dead || it.grabbedBy >= 0) continue;
    const dx = it.x - p.x, dy = it.y - PIVOT_Y;
    const along = dx * sx + dy * cy; if (along <= 0) continue;
    const perp = Math.abs(dx * cy - dy * sx);
    if (perp < (it.hr || it.r) + H.radius - 2 && along < bd) { bd = along; best = it; }
  }
  return best;
}
const EV = { bag: 250, piggy: 400, egg: 260, chest: 700, hourglass: 150, clover: 150, lamp: 150, meteor: 450 };
const val = it => it.value || EV[it.type] || 0;
const BOTS = {
  random:  { miss: 1.00, lag: 0, cool: 0.50, thr: 60 },   // 乱按:每次都在 0.3–2.0 秒后随机发射
  novice:  { miss: 0.35, lag: 8, cool: 0.70, thr: 40 },   // 新手
  skilled: { miss: 0.10, lag: 4, cool: 0.35, thr: 60 },   // 熟练
  perfect: { miss: 0.00, lag: 0, cool: 0.00, thr: 60 },   // 完美
};
// 每个存活玩家一个状态 bt = { p, wait:-1, cd:0, rnd:-1, dec:false }
function botTick(bt, cfg) {
  const p = bt.p, h = p.hook;
  if (h.state === 'swing') {
    if (bt.cd > 0) { bt.cd -= STEP; return; }
    if (!bt.dec) { bt.dec = true; bt.rnd = Math.random() < cfg.miss ? Math.floor((0.3 + Math.random() * 1.7) * 60) : -1; }
    if (bt.rnd >= 0) { if (bt.rnd-- === 0) g.press(p.cfg.keys.fire); return; }   // 本钩乱按
    if (bt.wait > 0) { if (--bt.wait === 0) { g.press(p.cfg.keys.fire); bt.wait = -1; } return; }
    const it = firstHit(p);
    if (it) {
      const v = val(it);
      if (v / Math.max(0.6, it.weight) >= cfg.thr || v >= 300) {
        const l = Math.floor(Math.random() * (cfg.lag + 1));   // 反应延迟 0..lag 帧
        if (l === 0) g.press(p.cfg.keys.fire); else bt.wait = l;
      }
    }
  } else {
    bt.cd = cfg.cool; bt.dec = false; bt.rnd = -1;
    if (h.state === 'retract' && h.item && p.dyn > 0 && h.item.weight >= 4 && val(h.item) < 100 && h.len > 200) g.press(p.cfg.keys.dyn);
  }
}
// 整局驱动(每帧):
//  intro → 只 advance;play → 对每个存活玩家 botTick 后 advance(STEP);
//  results 且 G.resultsT > 0.5 → press('Space');
//  shop 且 G.t - G.shopStartT > 0.3 → press('KeyW')(对战/合作再 press('ArrowUp'));
//  final → 结束。 每局开头 __game.reseed(seed); __game.startMode('solo', [0]);
```

规划时的实测(当前代码,P1 移到 x=640、P2 移除、关卡按合作保底系数生成,40 局/档)给出了 3.3 节的表格;Builder 实现后若 AC-12 不达标,允许把 `SOLO_TARGETS` 每项在 ±10% 内、`STAR_MULT` 在 ±0.25 内微调,并在代码注释里写明最终值和实测通过率。

## 附录 B:回归黄金对比脚本(AC-03)

```js
// Playwright: 两个页面分别加载 tests/baseline.html 与 index.html,都在 addInitScript 里把
// Math.random 换成同一个 mulberry(seed)(不要用 ?seed=,基准文件不认识这个参数)。
// 然后在一次同步 page.evaluate 内跑完整局:
const g = window.__game, G = g.G, STEP = 1 / 60;
G.mode = mode; G.chars = [1, 4]; g.startGame();
const log = []; let guard = 0;
while (G.screen !== 'final' && guard++ < 60 * 60 * 30) {
  if (G.screen === 'play') {
    for (const p of G.players) if (p.alive && p.hook.state === 'swing' && Math.floor(G.playT * 60) % 47 === p.id * 13) g.press(p.cfg.keys.fire);
  } else if (G.screen === 'results' && G.resultsT > 0.5) { log.push(G.players.map(p => p.money).concat([G.teamMoney])); g.press('Space'); }
  else if (G.screen === 'shop' && G.t - G.shopStartT > 0.3) { g.press('KeyS'); g.press('KeyW'); g.press('ArrowUp'); }
  g.advance(STEP);
}
return { log, final: G.final };
// 两个文件的 JSON.stringify(log) 与 final.winner/cleared/victory 必须完全相同。
```

(规划时已验证:当前代码在同种子下两次运行结果逐字节一致,所以这个对比是可行的。)

---

## 附录 C:Builder 实施顺序(建议)

0. 复制 `index.html` → `tests/baseline.html`。
1. 顶部常量:`SOLO_TARGETS`、`STAR_MULT`、`MENU_ORDER`、`SOLO_CFG`、`?seed=` 处理。
2. 模式辅助:`isSolo()`、`targets()`、`generateLevel` 的保底系数、`shopPool`/`resolveDice` 过滤。
3. `startGame`(按模式建玩家)、`updatePlay`(单人不掷顺序)、星级实时检测。
4. `endRound / afterResults / finishGame` 的 solo 分支,纪录读写。
5. 商店:6 件、折扣、3★ 赠炸药、刷新货架。
6. 输入:主菜单 3 卡 + 1/2/3、单人按键归一化、单人选择页。
7. 绘制:主菜单、选择页、HUD(三面板)、intro、结算、商店、终局。
8. `__game` 新接口;自测 AC-01、AC-03、AC-12 后交付。
