结论：FAIL
候选版本：feat/tennis-2k @ 9c86b7bdaa32be1d99a4fa3e4b150d1d3eebb444（基点 b2a9b92f1e4c103959e46e0a5c4f26c0e775409b）
本轮核验方式：只读全量代码审（全部 11 个 `shared/src/*.ts` 模块 + 5 个 `shared/tests/*.ts` 测试文件 + workspace 配置）+ 独立运行 `npm run typecheck` / `npm run build` / `npm test` + 2 组系统临时目录对抗性边界探针脚本（已清理，零产品文件改动；WP1 为纯 TS 引擎，按 `evaluator.md` 跳过 UI Tester）

达标项：
- [版本与仓库边界 / AC-16 局部] `git rev-parse HEAD` 确认为 `9c86b7bdaa32be1d99a4fa3e4b150d1d3eebb444`；`git diff b2a9b92..HEAD --stat` 仅改动 `tennis-2k/` 内 28 个文件（根 workspace 配置、占位 `client/package.json` & `server/package.json`、`shared/**`、`docs/review/wp1/**`），零修改 `docs/SPEC.md`、`docs/CONTRACT.md` 或外部目录，未提交 `node_modules/`；`shared/src/*.ts` 运行时零 DOM / Node / `three` / `ws` / `Math.random()` 依赖，全部核心纯函数通过 `Object.freeze` 深冻结零入参修改验证。
- [契约完整性] `shared/dist/index.js`（ESM）正常导出全部 46 个符号，100% 覆盖 `CONTRACT.md` §2–§3 要求的 `COURT_DIM`（全部 19 项数值完全吻合）、`COURTS`、`ARCHETYPES`、全部类型/消息联合类型及 20 个纯函数签名；`npm run typecheck`、`npm run build`、`npm test`（5 文件 22 用例）全部通过。
- [AC-02 场地物理与 3 次迭代解算] 3D 重力 + 二次阻力（`k_d=0.022`）+ Magnus（`k_m=0.00055`）+ 2× 子步进防穿网与旋转方向符号推导全部自洽；真实一发探针实测：红土弹高 `1.5847 m` 较硬地 `1.3007 m` 高 `+21.8%`（≥ 8%）、草地弹高 `0.9968 m` 较硬地低 `-23.4%`（≥ 10%）、草地弹后水平速 `27.113 m/s` 较红土 `20.945 m/s` 快 `+29.4%`（≥ 20%）；8 组高压球道解算用例 100% 过网且最大目标落点误差 `0.142 m`（≤ 0.15 m）。
- [AC-03 / AC-04 流派均衡与操控弹道] 4 流派五维总分严格 `400`，服饰/头饰/体型区分清晰；`defender` 满速 `7.032 m/s` 较 `power` 高 ≥ 15%、`allcourt` 绿条较 `serve_volley` 宽 ≥ 12%、`power` 一发初速最高；`J`/`K`/`W+K`（`|Z| ∈ [1.8, 3.6] m`）/`L`（顶点 ≥ 5.0 m）区分明确，`serve_ready` 静默忽略 `L`，极限救球滑步延伸触球半径至 `1.80 m`。
- [AC-05 2K 绿条甜区与精度] `progress >= 1.18` 无条件优先判 `VERY_LATE`（覆盖高 `TIM` + Takeover + `serve_kick` 组合）；独立探针验证 20 组变起点/变瞄准 `PERFECT` 回合球 100% 过网且相对真实理想落点最大误差 `0.0754 m`（≤ 0.15 m）；一发初速高于二发 ≥ 25%、一发红区 20/20 失误、二发绿/白区 ≥ 95% 进界。
- [AC-08 / AC-09 赛制状态机与 3 档 AI] Fast4 金球、`4-2` 完赛、`3-3` 7 分抢七与换发、超级抢十 `9-9 → 11-9`、`computeStatsSummary` 零分母保护全部达标；同种子 100% 确定性；独立复跑 30 局基准（含互换 P0/P1 先后手共 120 局，0 超时）：`Pro(P0) vs Rookie(P1) = 83.3% (25/30)`、`Pro(P1) vs Rookie(P0) = 86.7% (26/30)`（均 ≥ 75%）；`Legend(P0) vs Pro(P1) = 80.0% (24/30)`、`Legend(P1) vs Pro(P0) = 70.0% (21/30)`（均 ≥ 70%）；UE 率严格递减（`rookie 2.05% > pro 1.08% > legend 0.24%`）。
- [镜像与联机暂停/断线/弃权 FSM] `toLocalVec3` / `toLocalView`（含 `ball.spin`、`predictedLanding`、`firstBouncePos`、`hawkeye.bouncePos`）/ `toLocalEvent` / `toWorldInput` 与 P0/P1 `W+K` 放小球对称性全部通过；手动暂停 3 次上限、`PAUSE_LIMIT_REACHED`、60s 到期 `PAUSE_TIMEOUT_RESUMING`、3s `resuming` 幂等、单机豁免、断线保留原 `pausedFromPhase` 且不退次数、双断线独立 15s 计时与超时 `MATCH_OVER(reason:'forfeit')`、4 位无歧义房间码生成全部通过。

返工项（FAIL 时填写）：

【问题 1（必须）：高速底线界内球及 `launchHawkeyeTestBall(line:'baseline', inBounds:true)` 在三块场地全部漏触发鹰眼】
- 现象与证据：
  - 代码来源：`shared/src/engine.ts` L1136–1150；测试缺口：`shared/tests/ac05_ac06_ac07_meter_takeover_hawkeye.test.ts` L271 仅测试 `line: 'sideline'`，漏测 `line: 'baseline'`。
  - 独立探针复现：分别在 `hard` / `clay` / `grass` 三块场地调用 `launchHawkeyeTestBall(state, { inBounds: true, distCm: 8, line: 'baseline' }, rng)` 并按 `stepMatch` 推进，三块场地均在首跳界内（距底线 `~8 cm`）后、二跳发生前高速越过场地安全边界 `|z| > 22`（实测 `bounces = 1`，出界坐标 `z = -22.198 / -22.084 / -22.053`），触发 L1146–1149 分支并执行 `finalizePoint(next, hitter, reason, null, events)`——直接传入 `null` 而未从 `next.ball.firstBouncePos` 回溯构造 `hawkeyeCandidate`，导致三块场地 `HAWKEYE_START` 均未触发（`hs = null`，直接进入 `point_over`）。
- 影响：直接违反 `AC-07` 与 `SPEC.md` §3.7 / §5；实战中所有高速压底线制胜球/发球 Ace 若在二跳前飞出 `|z| > 22` 均会静默丢失鹰眼特写，且 `triggerHawkeyeShot({ inBounds: true, distCm: 8, line: 'baseline' })` 在三块场地 100% 失效。
- 修改方向：在 `shared/src/engine.ts` L1146–1149 的 `bounces >= 1` 场外终结分支中，与 `bounces === 2` 分支（L1106–1129）一致地基于 `next.ball.firstBouncePos` 调用 `evaluateBounceBounds` 构造 `hawkeyeCandidate` 并传入 `finalizePoint`；在 `ac05_ac06_ac07_meter_takeover_hawkeye.test.ts` 补齐 `line: 'baseline'`（界内 `8 cm` / 界外 `10 cm` / `25 cm`）及三场地覆盖。
- 下轮验收标准：`hard` / `clay` / `grass` 三块场地执行 `launchHawkeyeTestBall` 覆盖 `sideline` 与 `baseline` 的 `inBounds: true, distCm: 8` 及 `inBounds: false, distCm: 10`，均 100% 触发 `HAWKEYE_START` 且 `isIn` 与 `distanceToLineCm <= 15` 精确一致；`distCm: 25` 均不触发。

【问题 2（必须）：`evaluateBounceBounds` 对明显出界球误选垂直方向未越界边线，导致 `> 15 cm` 大出界误触发鹰眼并播报错误线位】
- 现象与证据：
  - 代码来源：`shared/src/physics.ts` L180–231（`evaluateBounceBounds`）。
  - 独立探针实测 3 组反例：
    1. 回合球偏出单打边线 **50 cm**（`x = 4.615`，`inX = false`）但位于底线内侧 `2 cm`（`z = -11.865`，`inZ = true`）→ 实际返回 `{"inBounds":false,"distanceToLineCm":2,"lineType":"baseline"}`；
    2. 回合球飞出底线 **91.5 cm**（`z = -12.8`，`inZ = false`）但位于边线内侧 `2.5 cm`（`x = 4.09`，`inX = true`）→ 实际返回 `{"inBounds":false,"distanceToLineCm":2.5,"lineType":"sideline"}`；
    3. 发球落入错误半区 **300 cm**（`x = +3.0`，目标发球区 `[-4.115, 0]`）但位于发球线内侧 `2 cm`（`z = -6.38`）→ 实际返回 `{"inBounds":false,"distanceToLineCm":2,"lineType":"service_line"}`。
- 影响：直接违反 `AC-07`（`> 15 cm` 不误触发；判定与物理 100% 一致）。大幅出界球（50–300 cm）只要靠近另一条未越过的垂直线，就会误触发 1.8 s 鹰眼特写，且下游 WP2 会把镜头聚焦到一条球实际在界内的线上显示 `OUT · 2.0 cm`，严重损害竞技可信度。
- 修改方向：在 `evaluateBounceBounds` 中，当 `inBounds === false` 时仅从**实际越界维度对应的线**计算 `distanceToLineCm` 与 `lineType`（单打：`!inX` 仅计 `dSideline`，`!inZ` 仅计 `dBaseline`；发球：`!inX` 计实际越界的外边线 `dOuter` 或中发球线 `dCenter`，`!inZ` 计 `dServiceZ`；若 `inX` 与 `inZ` 同时越界则按越界幅度/对应违规线返回，严禁将未越界线计入候选）。补充上述 3 类反例单测。
- 下轮验收标准：上述 3 组反例分别返回 `sideline / ~50 cm`、`baseline / ~91.5 cm`、`center_service_line / ~300 cm`（且 `inBounds === false`），在 `stepMatch` 中均不触发 `HAWKEYE_START`。

【问题 3（必须）：发球纵向瞄准 `aimZ` 符号与 `SPEC.md` §3.2 相反（按 `W` 变浅、按 `S` 变深）】
- 现象与证据：
  - 代码来源：`shared/src/engine.ts` L376（`executeServeLaunch`）：`let targetZ = targetSide * (baseDepth - clamp(-input.aimZ * srv.side, -1, 1) * 0.45);`。
  - 独立探针实测（经 `toWorldInput` 转换后）：P0（`side=+1`）按本地 `W`（`localAimZ=-1`）发球落点 `|z| = 5.204 m`，按 `S`（`localAimZ=+1`）落点 `|z| = 6.104 m`；P1（`side=-1`）按 `W` 落点 `|z| = 5.196 m`，按 `S` 落点 `|z| = 6.096 m`。与 `SPEC.md` §3.2（`W = -1` 向前/深区、`S = +1` 向后/浅区）及 `executeRallyShot`（L533/L539 按 `W` 变深）完全相反。
- 影响：玩家发球按 `W` 压深反而发浅、按 `S` 发浅反而压深，与回合内 `WASD` 瞄准直觉冲突。
- 修改方向：将 `shared/src/engine.ts` L376 的 `-` 改为 `+`（`baseDepth + clamp(-input.aimZ * srv.side, -1, 1) * 0.45`，并确保深度夹在有效发球区 `[3.8, COURT_DIM.SERVICE_LINE_Z - 0.14]` 内），补充 P0/P1 发球 `W` vs `S` 纵向落点单测。
- 下轮验收标准：P0 与 P1 发球按本地 `W`（`aimZ=-1`）落点 `|z|` 均显著大于按本地 `S`（`aimZ=+1`），且 `PERFECT` 发球 100% 落入目标发球框。

【问题 4（必须）：`applyScorePatch` 在非 `serve_ready` 阶段调用时未清理残留对局/鹰眼/绿条状态】
- 现象与证据：
  - 代码来源：`shared/src/rules.ts` L210–245（`applyScorePatch`）。
  - 独立探针实测：在 `phase='hawkeye'`、`hawkeye.active=true`、`players[0].meter.active=true`、`ball.bounces=2` 状态下调用 `applyScorePatch(state, { games: [3, 2], points: [3, 0] })`，返回状态虽然 `phase='serve_ready'`，但残留 `hawkeye.active=true`、`players[0].meter.active=true`、`ball.bounces=2`（以及未清 `phaseTimer`、`isSliding`、`ball.firstBouncePos`、`ball.predictedLanding`、`ball.lastHitter`）。
- 影响：WP2/WP3 在 `?test=1` 下执行 `setScore` 会产生 `phase='serve_ready'` 与 `hawkeye.active=true` / 绿条未清的状态撕裂，导致后续 `AC-08` 联调与 UI 渲染异常。
- 修改方向：在 `applyScorePatch` 中完整重置 `phaseTimer`、`hawkeye.active = false`、`hawkeye.elapsedSec = 0`、双方球员运动/滑步/动画/绿条字段以及球的回合元字段（与 `resetPlayersForServe` 对齐），并补充从 `hawkeye`/`rally` 调用 `applyScorePatch` 的单测。
- 下轮验收标准：从 `hawkeye` / `serve_toss` / `rally` 调用 `applyScorePatch` 后，`phase === 'serve_ready'`、`hawkeye.active === false`、双方 `meter.active === false`、`ball.bounces === 0`、`ball.firstBouncePos === null`、`ball.predictedLanding === null`。

【问题 5（建议）：一发擦网重发（LET）重复计入 `firstServesTotal`、`Takeover` 制胜拍当分即扣减计数、以及 `AC-05` 测试断言自比改进】
- 现象与证据：
  1. `shared/src/engine.ts` L351–360 在发球出手时即递增 `firstServesTotal` 与 `totalMeterShots`，L1067–1071 判发球 `LET` 重发时未回滚计数，导致擦网重发虚降一发成功率；
  2. 独立探针验证：当玩家能量为 `70` 时击出 `PERFECT` 一发 Ace，出手瞬间激活 Takeover（`takeoverPointsLeft = 2`），但该 Ace 分随即结束触发 `advanceTakeoverOnPointEnd` 将 `takeoverPointsLeft` 扣减为 `1`——玩家在激活当分零次享受 Takeover 绿条放宽，实际仅享受 1 个完整得分回合（`SPEC.md` §3.7 为“持续 2 个完整得分回合”）；
  3. `shared/src/engine.ts` L838–842 / L867–871 鹰眼或分间结束转入 `paused_disconnect` 时未同步写入 `pause.remainingSec`（下一 tick 才修正）与 `pause.initiatedBy`；
  4. `shared/tests/ac05_ac06_ac07_meter_takeover_hawkeye.test.ts` L79–83 将实际首跳与同引擎算出的 `s.ball.predictedLanding` 比较而非与目标点比较，建议改为相对目标点断言 `<= 0.15 m`。
- 影响：属于边界精确度与测试断言质量优化，建议在修复 4 项必须问题时一并收敛，使 `AC-05`/`AC-06`/`AC-08` 在后续 WP2/WP3 联调中零隐患。
- 修改方向：Serve LET 时回滚本次发球统计计数；若调整 Takeover 激活当分不立即扣减，请同步确保现有 `AC-06` 持续 2 分 + 第 3 分冷却逻辑清晰可测；`hawkeye`/`point_over` 转入 `paused_disconnect` 时同步设置 `remainingSec` 与 `initiatedBy`；加强 `AC-05` 断言直接比对目标点。
- 下轮验收标准：Serve LET 后 `firstServesTotal` 不虚增；上述边界场景单测覆盖通过。

未验证项（非门槛 / 环境限制）：
- `AC-01`、`AC-10`–`AC-16` 涉及 3D 渲染、Web Audio、DPR/帧率自适应、双端 WebSocket 联机与子路径反代，属 WP2（`client`）、WP3（`server`）与整合阶段验收范围，本轮 WP1 仅审阅并验证 `@court2k/shared` 确定性引擎与契约。

给用户的摘要：WP1（`@court2k/shared` 物理/规则/AI 引擎与 workspaces 脚手架）Round 1 整体结构清晰、契约导出完整且 22 项单测全部通过，但独立代码审与对抗探针发现 4 个必须修复的缺陷：① 高速压底线界内球（含 `launchHawkeyeTestBall(line:'baseline')`）在三块场地因二跳前越过 `|z|>22` 全部漏触发鹰眼；② `evaluateBounceBounds` 对 50–300 cm 大出界球误选垂直未越界线导致误触发鹰眼且播报错线；③ 发球纵向瞄准 `W/S` 方向反转；④ `applyScorePatch` 未清理残留鹰眼/绿条/球状态。本轮裁决 `FAIL`，退回 Builder 定点修复后复验。

Notion 一行摘要：FAIL / WP1 契约与基础物理达标，但检出底线鹰眼漏触发、大出界误选线、发球 W/S 反转及 applyScorePatch 状态残留 4 项必改缺陷 / 退回 WP1 Builder 开展 Round 2 修复后全量回归复验
