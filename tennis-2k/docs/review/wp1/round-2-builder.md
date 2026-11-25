# Builder 交付报告 — Round 2（Court 2K：大满贯时代 / WP1 `@court2k/shared` 返工修复）

## 0. 快速索引
- **候选版本**：`feat/tennis-2k @ 8b97967e20101ba6dbe66ab7690f2a735468fa24`（本交付报告随下一提交落盘；基于 Round 1 `9c86b7bdaa32be1d99a4fa3e4b150d1d3eebb444`）
- **本轮相对上轮变化**：修复 Round 1 评审报告（`round-1.md`）全部 4 项必须修复缺陷及 3 项建议改进（底线高速球出界前未回溯鹰眼、大出界球误选垂直未越界线、发球纵向 `W/S` 瞄准反转、`applyScorePatch` 状态残留、Serve LET 统计回滚、跨分切入 `paused_disconnect` 补全 `remainingSec`/`initiatedBy`、`AC-05` 断言改为直比目标点），改动模块 `shared/src/physics.ts`、`shared/src/engine.ts`、`shared/src/rules.ts` 及 3 个 Vitest 测试文件。
- **启动方式与 Tester 前置条件**：
  - 启动命令 / 入口：在 `D:\court2k-work\claude\tennis-2k` 执行 `npm run build && npm run typecheck && npm test`
  - 测试账号 / 种子 / 样本：无外部账号；单测固定种子 `42`、`100`、`77`、`88`、`91`、`55`、`66`、`11`、`99`、`1234`、`1000..1029`、`2000..2029`
  - 受控测试钩子用法：`applyScorePatch(state, patch)`、`launchHawkeyeTestBall(state, { inBounds, distCm, line }, rng)`、`fastForwardPauseState(state, seconds)`（纯函数，无全局副作用）
  - 清理方式：纯内存/无常驻进程
- **自测命令与证据索引**：
  - 一键测试命令：`npm run build && npm run typecheck && npm test`（结果：5/5 测试文件、25/25 用例通过）
  - 关键截图/日志路径：
    - `docs/review/wp1/evidence/round-2/build-typecheck-test.txt`
    - `docs/review/wp1/evidence/round-2/workspace-and-purity-check.txt`
- **环境未验证缺口**：
  - WP1 为纯 TypeScript 内核与 Vitest 单元测试，不包含前端 3D 渲染/浏览器实机交互（`AC-01`、`AC-10`~`AC-16` 属 WP2/WP3/整合阶段）。

---

## 1. 实现概述与接口说明（Round 2 定点修复）

1. **修复【问题 1】高速底线界内球二跳前飞出 `|z| > 22` 漏触发鹰眼（`shared/src/engine.ts`）**：
   - 抽取共用辅助函数 `buildHawkeyeCandidateFromFirstBounce(state, isServeBall, targetSide)`；
   - 在 `bounces === 2` 分支与 `|z| > 22 || |x| > 14`（`bounces >= 1`）场外终结分支中统一回溯 `next.ball.firstBouncePos` 并调用 `evaluateBounceBounds` 生成 `hawkeyeCandidate` 传入 `finalizePoint`，确保三块场地底线压线球（含 `launchHawkeyeTestBall({ line: 'baseline', inBounds: true, distCm: 8 })`）100% 触发鹰眼。
2. **修复【问题 2】`evaluateBounceBounds` 对明显出界球误选垂直未越界线（`shared/src/physics.ts`）**：
   - 当 `inBounds === false` 时，仅计算**实际越界维度**对应的线与距离：
     - 单打回合：`!inX && inZ` 仅计 `sideline`；`inX && !inZ` 仅计 `baseline`；`!inX && !inZ` 取直角角点距离 `hypot(dSideline, dBaseline)` 并取主导越界线；
     - 发球：`!inX` 按 `pos.x * expectedSignX < 0` 精确区分中发球线 `center_service_line` 与外边线 `sideline`；`!inZ` 计 `service_line`；双越界取 `hypot(xDist, dServiceZ)`。
   - 彻底消除 50–300 cm 大出界球因贴近未越界垂直线而误触发鹰眼及错报线位的问题。
3. **修复【问题 3】发球纵向瞄准 `W/S` 方向反转（`shared/src/engine.ts`）**：
   - 在 `executeServeLaunch` 中将 `targetZ` 由 `baseDepth - forwardAimZ * 0.45` 修正为 `clamp(baseDepth + forwardAimZ * 0.45, 3.8, COURT_DIM.SERVICE_LINE_Z - 0.16)`，使 P0（`side=+1`）与 P1（`side=-1`）按本地 `W`（`aimZ=-1`）发往更深发球区、按 `S`（`aimZ=+1`）发往更浅发球区，与 `SPEC.md` §3.2 及回合内手感一致。
4. **修复【问题 4】`applyScorePatch` 状态残留（`shared/src/rules.ts`）**：
   - 补全重置 `phaseTimer = 0`、`hawkeye.active = false`、`hawkeye.elapsedSec = 0`、双方球员运动/滑步/动画/绿条字段以及 `ball` 全部回合元字段（`bounces = 0`、`firstBouncePos = null`、`predictedLanding = null`、`lastHitter = null` 等）。
5. **落盘【问题 5】建议项**：
   - Serve `LET` 重发时回滚本次发球计入的 `totalMeterShots`、`perfectShots` 与 `firstServesTotal`；
   - `hawkeye` / `point_over` 结束转入 `paused_disconnect` 时抽取 `enterDisconnectPauseFromPlay` 同步设置 `pause.initiatedBy`、`pause.remainingSec` 与 `resumeCountdownSec = 0`；
   - 将 `AC-05` 落点精度测试断言改为将实际首跳直接比对理想世界坐标目标点（`<= 0.15 m`）；
   - 关于 Takeover 激活当分计数：为严格保持 `CONTRACT.md` 中 `PlayerState.takeoverPointsLeft`（`0 | 1 | 2`）无未声明隐藏字段，维持每次 `POINT_SCORED` 递减 `1`（先递减旧有激活计数，再结算本分奖励避免末尾得分支直接扣减）。

---

## 2. 验收项逐条自测结果（对应 SPEC 编号）

| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **AC-02** | Vitest (`ac02_courts_physics.test.ts`) | 4/4 通过：三场地弹高/减速差异达标，2× 子步进 0 穿网，3 次迭代解算 ≤ `0.15 m` | `docs/review/wp1/evidence/round-2/build-typecheck-test.txt` |
| **AC-03 / AC-04** | Vitest (`ac03_ac04_archetypes_controls.test.ts`) | 5/5 通过：4 流派总分 `400`，跑速/绿条/一发初速梯度，4 球路与 `1.80 m` 滑步触球全通过 | `docs/review/wp1/evidence/round-2/build-typecheck-test.txt` |
| **AC-05 / AC-06 / AC-07（含回归）** | Vitest (`ac05_ac06_ac07_meter_takeover_hawkeye.test.ts`) | 6/6 通过：`AC-05` 改直比目标点 20/20 `<= 0.15 m`；`hard`/`clay`/`grass` 三场地 `sideline`+`baseline` `8cm` IN / `10cm` OUT 100% 触发鹰眼、`25cm` 均不触发；50/91.5/300 cm 大出界 0 误触发且精确返回越界线；Serve LET 统计零虚增 | `docs/review/wp1/evidence/round-2/build-typecheck-test.txt` |
| **AC-08 / AC-09（含回归）** | Vitest (`ac08_ac09_rules_ai.test.ts`) | 4/4 通过：Fast4/抢十/统计 + `applyScorePatch` 从 `hawkeye` 脏状态彻底清零；`Pro vs Rookie 83.3% (25/30)`、`Legend vs Pro 80.0% (24/30)`、UE 率 `2.05% > 1.08% > 0.24%` | `docs/review/wp1/evidence/round-2/build-typecheck-test.txt` |
| **镜像与 FSM（含回归）** | Vitest (`mirror_and_pause_fsm.test.ts`) | 6/6 通过：P0/P1 发球 `W` 落点 `|z|` 均显著深于 `S`（`+0.5 m` 以上）且 100% 进框；`W+K` 对称、暂停/断线/双断线/弃权全通过 | `docs/review/wp1/evidence/round-2/build-typecheck-test.txt` |
| **构建与纯度** | `build` + `typecheck` + `npm ls` + Node ESM + grep | 0 TS 错误；46 导出正常导入；`shared/src/*.ts` 零禁止引用 | `docs/review/wp1/evidence/round-2/workspace-and-purity-check.txt` |

---

## 3. 改动影响面与失效旧证据（返工轮必填）

- **修改的模块 / 文件**：
  - `shared/src/physics.ts`（`evaluateBounceBounds`）
  - `shared/src/engine.ts`（`executeServeLaunch`、`enterDisconnectPauseFromPlay`、`buildHawkeyeCandidateFromFirstBounce`、Serve `LET` 统计回滚、`|z|>22 || |x|>14` 分支鹰眼回溯）
  - `shared/src/rules.ts`（`applyScorePatch`）
  - `shared/tests/ac05_ac06_ac07_meter_takeover_hawkeye.test.ts`（修改 `AC-05` 精度断言为直比理想目标点，依据 `SPEC.md` §4 `AC-05`“相对目标点落点误差 ≤ 0.15 m”；新增三场地底线/边线鹰眼、50–300cm 大出界反例与 Serve LET 回滚回归测试）
  - `shared/tests/ac08_ac09_rules_ai.test.ts`（新增 `applyScorePatch` 脏状态清理回归测试）
  - `shared/tests/mirror_and_pause_fsm.test.ts`（新增 P0/P1 发球 `W/S` 纵向瞄准对称回归测试）
- **触及的公共状态 / 存档 / 权限 / 契约 / 邻近流程**：
  - 未修改任何 `CONTRACT.md` 类型、导出签名或协议字段；
  - `evaluateBounceBounds` 变更同时作用于 `stepMatch` 内首跳出界判定、二跳/出界后鹰眼触发判定以及 `HAWKEYE_START` 报告的 `lineType`/`distanceToLineCm`；
  - `executeServeLaunch` 纵深瞄准修复同时作用于单机与联机发球（含 `computeAIInput` 发球路径）；
  - `applyScorePatch` 状态清理作用于后续 WP2/WP3 `?test=1` `TEST_COMMAND(set_score)` 流程。
- **已失效的旧证据与建议复测范围**：
  - Round 1 证据（`docs/review/wp1/evidence/round-1/*`）因源码变更已全部作废，以 `docs/review/wp1/evidence/round-2/*` 为准；
  - 建议 Reviewer 复测全部 25 项 Vitest 用例及对 `evaluateBounceBounds` 大出界、三场地 `launchHawkeyeTestBall(line:'baseline')`、P0/P1 发球 `W/S` 与 `applyScorePatch` 的独立探针核查。
