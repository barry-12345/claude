# Tester 实测证据报告 — Round 1（Candy TD Battle V2）

## 1. 运行环境与版本核对
- **实际测试版本**：分支 `v2-candy-td-battle` @ `ef863853cecce03a261cf78228f8afc40302a031`（与简报一致：是）
- **运行环境**：Windows 11 / Microsoft Edge Headless `158.0.4370.33`（Playwright 驱动，独立 `BrowserContext`） / 视口 `1280×720`（`T-06` 为 `deviceScaleFactor: 2`）；端口：正常入口 `4501`（`allowTestHooks=false`，PID `13300`）、受控测试入口 `4502`（`allowTestHooks=true`，PID `41244`）、`T-07` 直开 `file://`（不适用）
- **实际调用模型与档位**：`gemini-4-hydrogen-high`（`Gemini 4 Hydrogen (High)`）

## 2. 用例执行总表
| 用例编号 | 对应 SPEC | 入口方式 | 执行步骤摘要 | 客观结果 | 关键数字 / 错误摘录 | 精选证据路径 |
| --- | --- | --- | --- | --- | --- | --- |
| T-01 | AC-01, AC-07(1B), AC-13 | 正常入口 `http://127.0.0.1:4501/`（无 `?test=1`） | 核对 `__CANDY_TEST__`；大厅选 `rainbow_m` 开「🦊 狡黠狐狸 AI」；`$190` 建草莓+薄荷剩 `$10`；点 `(5,4)` 障碍核对 1B 预览；Eco 发薪至 `$63` 后拆迁扣 `$60` 留 `$3`，攒足建草莓于增益格；发 `Q` 暗袭并按 `Space` 确认 AI 已建塔 | 通过 | `typeof __CANDY_TEST__ === 'undefined'`；9 张选图卡；地图名 `彩虹双拱门`；`$190→$110→$10`；拆迁 `$63→$3`；增益 `⚡ 极速糖格 (+20%攻速)`，射速显示 `3.12/s`；Eco `+25→+31/6s`；AI 在 `(5,3)` 建草莓塔、Eco `+37`；`0` console/page error | `docs/review/v2/evidence/round-1/tester-t01-lobby.png`, `docs/review/v2/evidence/round-1/tester-t01-1b-obstacle.png`, `docs/review/v2/evidence/round-1/tester-t01-after-demolish.png` |
| T-02 | AC-02 | 正常入口 `http://127.0.0.1:4501/`（双 Context） | A 建双人房 `H83K`，B 通过 `?room=H83K` 预填房间码加入；A 切图 `crown_peaks`，核对 B 实时同步且选图按钮禁用；双方准备进 `PLAYING`；A 拆 `(5,5)` 建塔并发 `Q`，核对 B 地图同步且 `(5,5)` 障碍仍未拆 | 通过 | B 侧 `.map-card.selected` 同步为 `crown_peaks`、全部 9 枚选图按钮 `disabled === true`；双端地图均显示 `奶油皇冠峰`；A Eco `+31/6s`、B 侧对手 Eco `+31`；B 点击 `(5,5)` 仍弹出 `🍮 薄荷布丁簇` 拆迁卡；`0` console/page error | `docs/review/v2/evidence/round-1/tester-t02-pvp-sync.png` |
| T-03 | AC-03, AC-04(2A), 代码审反例 | 钩子 `http://127.0.0.1:4502/?test=1`（双 Context PvP） | `grantResources` 补 `$3000`；草莓 `(2,3)` 升 Lv2 核对 A/B 分支卡并升分支 A 查 70% 返还；A 发 `R` 与 `T` 查 B 预警横幅与快递车；**反例 4**：B 按 `Space` 锁定对手视角后 A 发 `R` 测重叠；降 B 血至 `1` + `jumpWave(15)` + `fastForwardTicks(1500)` 结算并双端再来一局 | 失败（反例 4 重叠遮挡） | Lv3 分支 A `🔥 加特林 $145`/B `💥 碎糖炮 $145`，`invested=300` 出售 `+$210`（精确 70%）；`R` 显示 `💚 暗黑奶妈车 即将抵达！(2.6s)`、`T` 显示 `🛡️ 终极铁王八 即将抵达！(2.8s)`；**反例 4**：`#peek-banner`（`z=20`，`y=64..94`）与 `#incoming-express-banner`（`z=14`，`y=63.68..100.32`）完全水平重叠（重叠面积 `6934.78 px²`），`#incoming-express-banner` 文字被遮挡；结算无假动作字段，再来一局重置为 `wave=0, hp=20, gold=190, towers=0`；`0` console/page error | `docs/review/v2/evidence/round-1/tester-t03-lv3-branch.png`, `docs/review/v2/evidence/round-1/tester-t03-2a-alert.png`, `docs/review/v2/evidence/round-1/tester-t03-peek-express-overlap.png` |
| T-04 | AC-08, 代码审反例 | 钩子 `http://127.0.0.1:4502/?test=1` | 开 `classic_s` AI 局；最右列 `(17,3)` 建塔；移入右热区 `(1246,360)`；自由移动/移出画布/点 `Q` 派怪；快进 `220 ticks` 等 AI 建塔并悬停其塔；点击对手棋盘空地/障碍/塔 3 次；移入左热区 `(34,360)` 回防；测 `Space` 切换、长按 repeat、`Esc`、`1` 键 | 通过 | `(17,3)` 建塔后 `viewMode='self'`；进右热区后 `viewMode='opponent'`、`peekProgress=1`、右热区隐藏/左热区显示；移出画布与点 `Q` 保持 `opponent`；悬停 AI 塔显示只读浮卡与射程圈（`hoverOpponentTowerId=2`）；点击对手棋盘 3 次前后己方均为 `gold=1917, towers=1, cleared=0`；左热区/`Esc`/`1` 均回防且 `1` 选中 `strawberry`；repeat 防抖后仍为 `opponent`；`0` console/page error | `docs/review/v2/evidence/round-1/tester-t04-self-right-zone.png`, `docs/review/v2/evidence/round-1/tester-t04-opp-locked-hover.png` |
| T-05 | AC-09 | 钩子 `http://127.0.0.1:4502/?test=1` | 依次悬停 4 塔卡 + 5 派怪卡测量 `#action-tooltip` 边界与文案，移开后检查隐藏；打开 `❓` 切 3 Tab 核对条目与文案；测 `Esc` 与点击遮罩外侧关闭 | 通过 | 9 张卡 `#action-tooltip` 实测 `bottom` 均等于 `584`（`y+height=584 <= 584`）、`x ∈ [12, 958]`（`right <= 1268 <= 1280`），不遮挡底栏；移开后 `tooltipVisible=false`；图鉴含 `4` 塔 + `10` 怪（5 自然 + 5 暗袭），全文无“假动作/虚晃/F键/feint”；`Esc` 与遮罩外点击均可关闭（`helpOpen=false`）；`0` console/page error | `docs/review/v2/evidence/round-1/tester-t05-tooltip.png`, `docs/review/v2/evidence/round-1/tester-t05-codex-creeps.png` |
| T-06 | AC-10 | 钩子 `http://127.0.0.1:4502/?test=1&netdebug=1`（`deviceScaleFactor: 2`） | `1280×720`、`DPR=2` 监听网络请求；开 AI 局调 `spawnStress({ towers: 15, creeps: 45 })` 后连续 5 秒按 500ms 采样 10 次 `#netdebug-panel` | 通过 | 10 次采样 `FPS` 为 `56~118`（仅 1 次瞬间 `56`，其余 `90~118`，均 `≥55`）；`Render` 为 `0.70~1.60 ms`（均 `≤8ms`）；`DPR: 2`；粒子数 `18~219`（均 `≤220`）；非 `127.0.0.1` 外部请求数 `0`；`0` console/page error | `docs/review/v2/evidence/round-1/tester-t06-stress-dpr2.png` |
| T-07 | AC-17, AC-18 | `file://` 直开 + 钩子 `http://127.0.0.1:4502/?test=1` | 1. 直开 `public/index.html` 核对警告与按钮；2. `4502/?test=1` 触发建塔、Lv3 转职、拆迁、发 `R` 快递及压力战斗后读 `getAudioState()`；3. 点静音 `🔊→🔇` 并刷新页面核对持久化 | 通过 | `file://` 下 `#file-protocol-warning` 可见且 4 个开局按钮 `disabled=true`（仅浏览器按 CORS 策略阻止 `file://` 加载 ES Module 产生两条预期资源阻止报错，0 `pageerror`）；`4502` 对局 `getAudioState()` 记录 `build`, `upgrade`, `demolish`, `express_honk`, `pop`, `frost`, `boom`, `shield_hit`, `laser`, `execute`, `heal_pulse`, `coin`，`state='running'`；静音点击后 `muted=true`、`🔇`，刷新后保持 `muted=true`、`🔇`；`4502` 侧 `0` console/page error | `docs/review/v2/evidence/round-1/tester-t07-file-warning.png` |

## 3. 失败 / 异常详述（仅列失败与阻塞项）
### [T-03] 锁定对手视角时，顶部 `#peek-banner` 与 `#incoming-express-banner` 完全重叠遮挡（反例 4）
- **前置与复现步骤**：
  1. 双 Context 在 `http://127.0.0.1:4502/?test=1` 开启 PvP 对战（`classic_s`）并进入 `PLAYING`。
  2. 玩家 B 按 `Space` 锁定进入对手视角（`viewMode === 'opponent'`，顶部显示 `#peek-banner`）。
  3. 玩家 A 按 `R` 向玩家 B 发送 `express_healer`（`💚 暗黑奶妈车`）。
- **实际观察**：
  - 玩家 B 端同时显示 `#peek-banner`（`👀 已锁定对手视角（移入最左边缘 / Space / Esc / 1-4 回防）`）与 `#incoming-express-banner`（`💚 暗黑奶妈车 即将抵达！(2.9s)`）。
  - 两者定位均居中于 `top: 64px`：实测 `#peek-banner` boundingBox 为 `left: 434.58, top: 64, right: 845.42, bottom: 94, width: 410.84, height: 30`（`z-index: 20`）；`#incoming-express-banner` boundingBox 为 `left: 524.41, top: 63.68, right: 755.57, bottom: 100.32, width: 231.16, height: 36.63`（`z-index: 14`）。
  - 水平方向完全被包含重叠（`overlapX = 231.16px, overlapY = 30px, overlapArea = 6934.78 px²`），`#peek-banner` 将 `#incoming-express-banner` 文字内容完全遮盖，仅在底缘露出数像素绿色边框。
  - 注：T-03 其余子项（Lv3 双分支浮卡、70% 出售返还 `$210`、常规视角下 `2A` `R/T` 横幅与快递车显示、结算页无假动作字段、双端再来一局清零重开）均正常完成且无报错。
- **错误日志摘录**：无 JS `console.error` / `pageerror`。
- **证据文件**：`docs/review/v2/evidence/round-1/tester-t03-peek-express-overlap.png`

## 4. 客观体验观察（纯事实，非裁决）
- **浮卡遮挡相邻格现象**：在 `T-07` 实测中，在 `classic_s` 地图将塔建于 `(2,3)` 后点击该塔打开 `#tower-popover`（定位在 `left: 284px, top: 190px`），该浮卡面板在打开状态下覆盖右侧相邻的障碍物格 `(3,4)`（中心坐标 `x=310, y=324`），需先关闭塔浮卡（点击 `×` 或按 `Esc`）才能点中 `(3,4)` 障碍物。
- **图鉴窗口纵向滚动**：`1280×720` 视口下打开 `❓` 的「👾 怪物图鉴」Tab 时，5 张自然怪卡片占满首屏可见高度，下方「👾 玩家暗袭特种部队（5 种）」后 3 张卡片（`shield_choco` / `dark_healer` / `iron_titan`）需在弹窗内部向下滚动查看（见 `docs/review/v2/evidence/round-1/tester-t05-codex-creeps.png`）。
- **`file://` 直开机制**：直开 `public/index.html` 时 Edge 按同源策略拒绝加载 `file://` 下的 `<script type="module" src="./js/main.js">`，页面内联兜底脚本正常显示 `#file-protocol-warning` 并禁用 4 个开局按钮。

## 5. 未测项与止损记录
- 简报已列出的暂不可测环境项（物理 Mac Retina / Safari 真机、物理扬声器实听、腾讯云公网线上地址）未执行；T-01 至 T-07 全部 7 条必测用例均已完整执行完毕，无因卡死或超时跳过的用例。
- 测试收尾已精确终止本次启动的 `4501`（PID `13300`）与 `4502`（PID `41244`）Node 进程，并清理 `$env:TEMP` 下全部临时 Playwright 脚本与日志。
