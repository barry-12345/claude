# 评审报告 — Round 1（Candy TD Battle V2）

结论：FAIL
候选版本：分支 `v2-candy-td-battle` @ `ef863853cecce03a261cf78228f8afc40302a031`
本轮核验方式：全量代码与 diff 审查（`9f0e118..ef86385`）+ 断言审计与独立确定性边界脚本复跑（`npm test` 16/16 + 独立 7 项边界与 8 图 3200t AI 耐久探针）+ 已一次性委派独立 Tester（`gemini-4-hydrogen-high`，报告路径 `docs/review/v2/round-1-tester.md`）完成 7 项浏览器实机交互与 `DPR=2` 压测取证，并抽查 9 张核心原始截图。

## 达标项

- **[AC-01] 纯正常入口单人 AI 完整闭环**：`4501` 生产入口（无 `?test=1`）核实 `window.__CANDY_TEST__ === undefined`，8+1 选图器选 `rainbow_m` 开「狡黠狐狸 AI」，开局 `$190` 建草莓(`$80`)+薄荷(`$100`)剩 `$10`，Eco 发薪至 `$63` 后拆 `(5,4)` 障碍扣 `$60` 露出 `⚡ 极速糖格` 并建草莓（射速 `3.12/s`），派 `Q` 后 Eco `+25→+31/6s`，AI 在新图正常建塔，0 Console/Page Error（证据：`docs/review/v2/round-1-tester.md` T-01、`docs/review/v2/evidence/round-1/tester-t01-lobby.png`、`tester-t01-1b-obstacle.png`、`tester-t01-after-demolish.png`）。
- **[AC-02] 双人 PvP 选图/拆迁隔离/同步与再来一局**：`4501` 双独立 Context 验证 `?room=XXXX` 加入、房主切图 `crown_peaks` 实时同步且非房主 9 枚选图按钮全部 `disabled`、A 拆 `(5,5)` 不影响 B 棋盘、结算无假动作字段且双端再来一局清零重开；`ws-protocol.test.js` 全绿（证据：`docs/review/v2/evidence/round-1/tester-t02-pvp-sync.png`、`tests/ws-protocol.test.js`）。
- **[AC-03] 四塔「铁四角」与全部 8 种 Lv3 分支机制**：代码审、`sim-unit.test.js` 及独立边界探针 100% 核实四塔造价/属性、次数盾先于扣血拦截、焦糖岩浆池 `70t` 穿盾 `50%` 不耗盾 DoT（最多 2 池）、草莓 A 换目标重置、草莓 B 2 弹片破 2 盾+`3.0s` 碎甲（`0.85×`/`0.75×`）、薄荷 Lv1 起易伤取最大不叠加且薄荷自身不吃易伤、薄荷 A 冰冻 `20t/10t` + `50t` 免疫窗、薄荷 B 死亡冰爆 Boss 上限 `120`、柠檬 A 直线穿透 3 额外目标（`85/70/55%`）、柠檬 B Boss/精英（`maxHp>=400`）`+25%` 与 `<30%` 血 `1.75×` 处决（有盾不触发）、缺失/非法 `branch` 返回 `INVALID_BRANCH`、70% 出售返还（`$300→+$210`）；浏览器验证 Lv2 双分支浮卡清晰可用（证据：`tests/sim-unit.test.js`、`docs/review/v2/evidence/round-1/tester-t03-lv3-branch.png`）。
- **[AC-04（部分达标，交互预警重叠项见返工项 1）] 5 种暗黑/霓虹派怪与假动作彻底清除**：全仓 `public/`、`server/`、`README.md` 正则检索 `0` 假动作/虚晃/`express_feint`/`isFake`/`F` 键残留；旧 `express_feint` 返回 `INVALID_SEND_TYPE`；5 种暗袭怪独立 ID、`$0` 防卫赏金、HP 同步 W1/W10/W16+ 倍率、人海/前 30% 免控/8 盾/奶妈 `135px` 群回血（含自然怪 6%、其他 Boss 3%）/铁王八重甲 `0.5×`+6 盾+50% 减速抗性及快递最多 2 辆排队全部精确；己方视角下 `2A` `R`（`💚 暗黑奶妈车`）与 `T`（`🛡️ 终极铁王八`）顶部预警与入口快递车清晰（证据：`tests/sim-unit.test.js`、`tests/ws-protocol.test.js`、`docs/review/v2/evidence/round-1/tester-t03-2a-alert.png`）。
- **[AC-05] 平滑难度曲线 W1–W15 与温和加时 W16+**：W2–W15 环比 EHP 严格单调且全部位于 `[22.0%, 28.0%]`（实测 `23.2% ~ 27.9%`），W10 期中单 Boss、W15 双 Boss、W16+ `2.579 * 1.20^otIndex` 且间隔 `440/400/360/320t` 精确（证据：`tests/sim-unit.test.js`）。
- **[AC-06] 8 张可选地图几何不变量与 AI 动态选点**：8 张 `MAP_DEFS` 越界/正交/不自交/无非相邻粘连/4 障碍含 4 增益 100% 通过；独立 3200 ticks 耐久探针验证 `casual` 与 `clever` AI 在全部 8 张图均无报错、100% 合法建塔、正常拆障碍（各 16 处）与升 Lv3 分支（`casual` 10 座、`clever` 3 座）（证据：`tests/sim-unit.test.js` + Reviewer 独立探针）。
- **[AC-07] 明牌增益障碍物拆迁（`1B`）**：未拆障碍物右下角清晰显示 🎯/⚡/🔥/💰 明牌角标，点击浮卡明牌展示具体解锁增益名称与数值；`$60` 扣款与归属隔离、4 种增益精确数值（`1.20×` 射程/`1.20×` 攻速/`1.15×` 伤害/自然怪 `+$3`、暗袭怪 `+$0`）及卖塔后增益格保留全部通过（证据：`tests/sim-unit.test.js`、`docs/review/v2/evidence/round-1/tester-t01-1b-obstacle.png`、`tester-t01-after-demolish.png`）。
- **[AC-08] 对称双侧锁定视角切换（方案 A）**：`GRID_X0=100` 左右对称留白 `100px`（`36px` 安全隔离带）；最右列 `(17,3)` 建塔不误切；右热区/左热区/`Space`（含长按 repeat 防抖）/`Esc`/`1–4` 全通道无抖动；对手视角移出画布与点击 `Q` 派怪保持锁定不弹回；点击对手棋盘 3 次 `0` 误建 `0` 扣费 `0` 拆迁；悬停对手塔正常显示只读浮卡与淡紫射程圈（证据：`docs/review/v2/round-1-tester.md` T-04、`docs/review/v2/evidence/round-1/tester-t04-self-right-zone.png`、`tester-t04-opp-locked-hover.png`）。
- **[AC-09] 底栏 Hover Tooltip 与 `❓` 3-Tab 图鉴**：全部 9 张底栏卡实测 `#action-tooltip` `bottom === 584 <= 584` 完全不遮挡按钮、`x ∈ [12, 958]` 不溢出、移开隐藏；`❓` 弹窗 3 Tab 完整涵盖 4 塔 + 5 自然怪 + 5 暗袭特种部队，0 假动作残留，`Esc`/遮罩点击关闭流畅（证据：`docs/review/v2/round-1-tester.md` T-05、`docs/review/v2/evidence/round-1/tester-t05-tooltip.png`、`tester-t05-codex-creeps.png`）。
- **[AC-10] Retina `DPR=2` 性能红线与零外部 CDN**：`1280×720`、`deviceScaleFactor: 2` 下 `spawnStress({ towers: 15, creeps: 45 })`（含 8 分支 + 2 岩浆池）连续 5 秒 10 次采样：`FPS 56~118`（9 次 `90~118`，全部 `≥55`）、`Render 0.70~1.60 ms`（`≤8ms`）、`DPR: 2`、粒子 `18~219`（`≤220`）、0 外部非 `127.0.0.1` 请求（证据：`docs/review/v2/round-1-tester.md` T-06、`docs/review/v2/evidence/round-1/tester-t06-stress-dpr2.png`）。
- **[AC-11 ~ AC-18] 断线重连、子路径反代、双门控隔离、协议边界与 V1.1 稳定性回归**：`npm test` 16/16 全绿覆盖 AC-11~AC-17；Tester 实测 `file://` 直开告警与 4 按钮禁用生效（`tester-t07-file-warning.png`），`getAudioState()` 记录全部核心/新增音效事件且静音跨刷新保持，正常与测试入口全程 `0` Console/Page Error。

---

## 返工项

### 【问题 1（必须）：锁定对手视角时，顶部 `#peek-banner` 完全遮挡 `2A` 来袭快递预警横幅 `#incoming-express-banner`】
- **现象与证据**：
  - 来源：Reviewer 代码审查（`public/css/style.css` 第 225–265 行）设计反例 → Tester 实机复现证实（`docs/review/v2/round-1-tester.md` T-03 反例 4）。
  - 实测数字：玩家 B 处于锁定对手视角（`viewMode === 'opponent'`）且玩家 A 发送 `R`（`express_healer`）时，`#peek-banner`（`top: 64px, height: 30px, z-index: 20`，`x: 434.58..845.42`）与 `#incoming-express-banner`（`top: 63.68px, height: 36.63px, z-index: 14`，`x: 524.41..755.57`）在水平方向 100% 重叠（重叠面积 `6934.78 px²`），`#peek-banner` 将 `#incoming-express-banner` 的 `💚 暗黑奶妈车 即将抵达！(2.9s)` 车种图标与倒计时文字完全遮盖，仅底部露出数像素绿边。
  - 复现步骤：1) 双人 PvP 进入 `PLAYING`；2) 防守方 B 按 `Space` 或移入右侧热区锁定对手视角；3) 进攻方 A 按 `R` 或 `T` 发出快递。
  - 证据路径：`docs/review/v2/evidence/round-1/tester-t03-peek-express-overlap.png`。
- **影响**：实战中玩家切入锁定对手视角侦察并派怪时，画面正显示对手棋盘（看不到自家入口的快递车），顶部 `#incoming-express-banner` 是 3 秒内识别 `💚 奶妈车` 或 `🛡️ 铁王八` 并及时回防反制的**唯一视觉提示**；被 `#peek-banner` 完全遮挡直接破坏已批准决策 `2A`（3s 快递车种预警）与方案 A 锁定视角协同的核心对战体验。
- **修改方向**：调整 `#peek-banner` 与 `#incoming-express-banner`（及 `#overtime-banner` / `#toast-container`）的纵向布局与层级，确保当 `#stage[data-peeking="1"]` 时 `#incoming-express-banner` 自动下移至 `#peek-banner` 下方（例如 `top: 102px` 且 `z-index >= 21`）或放入纵向堆叠的顶部横幅容器，使两者同时出现时 0 像素重叠、预警文字与车种图标 100% 清晰可见。
- **下轮验收标准**：在锁定对手视角（`viewMode === 'opponent'`）状态下由对手发送 `R`（`express_healer`）与 `T`（`express_titan`），实测 `#peek-banner` 与 `#incoming-express-banner` 的 `boundingBox` 重叠面积严格等于 `0 px²`，且截图中 `💚 暗黑奶妈车` / `🛡️ 终极铁王八` 与倒计时清晰无遮挡。

### 【问题 2（建议）：对手塔只读悬停卡未将烈焰糖格（`🔥 +15% 伤害`）计入显示伤害】
- **现象与证据**：
  - 来源：Reviewer 代码审查 `public/js/ui.js` 第 579–588 行对比第 675–677 行。
  - 己方塔浮卡（`ui.js:677`）计算了 `effDmg = Math.round(lv.damage * (tower.buffTile === 'damage' ? 1.15 : 1))`，而对手只读悬停卡（`ui.js:587`）虽对射程与攻速乘了 `1.2`，伤害却直接输出了未加成的 `lvDef.damage`。
- **影响**：侦察对手建在 `🔥 烈焰糖格` 上的防御塔时，浮卡显示的伤害数字比实际生效值偏低 15%（虽有 `🔥 烈焰糖格` 标签提示，但与射程/攻速口径不一致）。
- **修改方向**：在 `ui.js:showOpponentTowerCard` 中同步按 `tower.buffTile === 'damage' ? 1.15 : 1` 计算 `effDmg` 并展示（单行修复）。
- **下轮验收标准**：对手塔建于 `🔥 烈焰糖格` 时，悬停只读浮卡显示的伤害值等于 `Math.round(lvDef.damage * 1.15)`。

---

## 未验证项（非门槛 / 环境限制）

- **物理 Mac Retina / Safari 真机实测**：本环境为 Windows 11，已按 SPEC `AC-10` 缺条件条款使用本机 Edge Headless `deviceScaleFactor: 2` 仿真完成 `DPR=2` 压测（`FPS 56~118`、`Render 0.70~1.60ms`）。
- **物理扬声器实听体验**：无头浏览器无法主观听音，已通过 `getAudioState()` 验证 `AudioContext` 状态 `running`、全部新增音效事件日志及静音持久化。
- **腾讯云公网部署与线上 HTTPS/WSS 实测**：按已批准范围明确不含远端 `git push` 与腾讯云生产部署。

---

## 给用户的摘要

Candy TD Battle V2 核心代码实现扎实，`npm test` 16/16 全绿，8 张地图、四塔 8 分支数值、5 种暗袭特种部队（0 假动作残留）、`1B` 明牌障碍拆迁、底栏 Hover Tooltip、3-Tab 图鉴、`DPR=2` 压测性能（`FPS 56~118`, `Render 0.70~1.60ms`）及 V1.1 稳定性回归均一次性通过。但在交互反例复测中发现 1 项必须修复的界面遮挡问题：当玩家锁定查看对手视角时，顶部紫色视角提示条会 100% 遮盖住对手发来的 `2A` 3 秒快递车种预警横幅（`💚 奶妈车` / `🛡️ 铁王八`），导致实战中看对手时漏看高危预警。本轮裁决为 `FAIL`，交 Builder 做一个轻量 CSS/UI 修复（并顺手同步对手塔只读卡的烈焰糖格伤害显示）后即可进入定点复验。

## Obsidian 一行摘要

`FAIL`（Round 1）/ V2 机制数值、8 图、1B 拆迁、锁定视角、Tooltip/图鉴与 DPR=2 性能均达标，唯锁定对手视角时 `#peek-banner` 100% 遮挡 `2A` 来袭快递预警横幅（`6935 px²` 重叠）/ 交 Builder 修复横幅堆叠与对手塔伤害显示口径后定点复验。
