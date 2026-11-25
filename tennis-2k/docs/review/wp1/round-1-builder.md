# Builder 交付报告 — Round 1（Court 2K：大满贯时代 / WP1 `@court2k/shared` 与 npm workspaces 脚手架）

## 0. 快速索引
- **候选版本**：`feat/tennis-2k @ ff251cd5ec5c6e9568bcf9c510020767d745d800`（本交付报告随下一提交落盘；基点 `b2a9b92f1e4c103959e46e0a5c4f26c0e775409b`）
- **本轮相对上轮变化**：首次交付；完成 npm workspaces 根脚手架（`package.json`、`package-lock.json`、`tsconfig.base.json`、`.gitignore`、`client/package.json`、`server/package.json`）与 `@court2k/shared` 全部 11 个 TypeScript 源码模块及 5 组 Vitest 验收测试。
- **启动方式与 Tester 前置条件**：
  - 启动命令 / 入口：在 `D:\court2k-work\claude\tennis-2k` 执行 `npm run build && npm run typecheck && npm test`（Node ESM 可直接 `import '@court2k/shared'`）
  - 测试账号 / 种子 / 样本：无外部账号依赖；单元测试内固定种子 `seed = 42`、`100`、`77`、`55`、`11`、`99`、`1234`、`1000..1029`、`2000..2029`
  - 受控测试钩子用法：纯函数导出 `applyScorePatch(state, patch)`、`launchHawkeyeTestBall(state, { inBounds, distCm, line }, rng)`（强制经 `solveBallisticShot` 与 `stepMatch` 真实物理落点判定 `<= 15 cm` 阈值）、`fastForwardPauseState(state, seconds)`；均需显式调用，无任何全局副作用或隐藏开关
  - 清理方式：纯内存/无常驻进程，无需停止服务或清理测试数据
- **自测命令与证据索引**：
  - 一键测试命令：`npm run build && npm run typecheck && npm test`（结果：5/5 测试文件、22/22 用例通过）
  - 关键截图/日志路径：
    - `docs/review/wp1/evidence/round-1/build-typecheck-test.txt`
    - `docs/review/wp1/evidence/round-1/workspace-and-purity-check.txt`
- **环境未验证缺口**：
  - WP1 为纯 TypeScript 内核与 Vitest 单元测试，不包含前端 3D 渲染/浏览器实机交互（`AC-01`、`AC-12`~`AC-16` 属 WP2/WP3/整合范围）；
  - 另记录：原始 `G:\我的云端硬盘` 非本地 NTFS 无法建立 npm workspaces junction，已按调度员指令切换至本地 NTFS 目录 `D:\court2k-work\claude\tennis-2k` 完成 `npm install`（74 packages）与全部验证。

---

## 1. 实现概述与接口说明

### 1.1 Workspace 脚手架与依赖预锁
- `tennis-2k/package.json`：声明 `workspaces: ["shared", "client", "server"]` 及统一 `build` / `typecheck` / `test` 脚本；根 `devDependencies` 预装 `typescript@5.9.3`、`vitest@3.2.7`、`playwright-core@1.65.1`。
- `tennis-2k/client/package.json` 与 `tennis-2k/server/package.json`：零源码最小占位包，按 `CONTRACT.md` 预声明 `three@0.174.0`、`@types/three@0.174.0`、`vite@6.4.6`、`ws@8.23.0`、`@types/ws@8.18.2`、`tsx@4.23.15` 并生成唯一 `tennis-2k/package-lock.json`。
- `tennis-2k/tsconfig.base.json`：严格 TypeScript（`target: "ES2022"`、`module: "ESNext"`、`moduleResolution: "Bundler"`、`strict: true`、`declaration: true`）。

### 1.2 `@court2k/shared` 模块结构（零运行时外部依赖，46 个导出）
- `shared/src/types.ts`：完整导出 `CONTRACT.md` §2–§3 全部接口与联合类型（含 `ClientMessage`、`ServerMessage`、`GameEvent`、`ErrorCode`、`TestCommandPayload`、`ScorePatch`、`PRNG`、`BallisticSolveParams`/`Result`、`MatchState`、`PauseState` 等）。
- `shared/src/constants.ts`：`COURT_DIM`、`PHYSICS_CONSTANTS`、`SHOT_METER_MULT`、`COURTS`（`hard`/`clay`/`grass`）、`ARCHETYPES`（`power`/`allcourt`/`serve_volley`/`defender`，总分严格 `400`）、`ROOM_CODE_ALPHABET`（32 字符无歧义字母数字）。
- `shared/src/rng.ts`：`createRng(seed)`（Mulberry32，零 `Math.random()`）与 `generateRoomCode(rng)`。
- `shared/src/mirror.ts`：`cloneVec3`、`cloneMatchState`、`toLocalVec3`、`toLocalView`、`toLocalEvent`、`toWorldInput`。
- `shared/src/physics.ts`：`netHeightAt`、`computeBallAcceleration`（重力 + 二次空气阻力 $k_d=0.022$ + Magnus 升/压旋 $k_m=0.00055$）、`stepBallSubstep`（2× 子步进防穿网/穿地、擦网减幅、地面切向旋转加速）、`evaluateBounceBounds`（ITF `R_mark=0.0335m` 压线界内与最近线距计算）、`solveBallisticShot`（3 次迭代球道解算器）。
- `shared/src/meter.ts`：`computeShotQuality`（优先处理 `progress >= 1.18 -> VERY_LATE`）、`computeBaseGreenHalfWidth`、`computePlayerMaxSpeed`、`computePowerMultiplier`、`computeSpinMultiplier`、`computeNetAccuracyMultiplier`。
- `shared/src/rules.ts`：`createInitialScoreState`、`awardPointToScore`（Fast4 金球与 `3-3` 7 分抢七、超级抢十先 10 赢 2）、`computeKeyPointLabel`、`computeServeSetupPositions`、`applyScorePatch`、`computeStatsSummary`。
- `shared/src/pause.ts`：`requestManualPause`、`requestManualResume`、`applyDisconnect`、`applyReconnect`、`fastForwardPauseState`（单机豁免次数/计时；联机 3 次/60s/3s `resuming` 幂等、断线保留原 `pausedFromPhase`、双断线独立 15s 计时）。
- `shared/src/ai.ts`：`computeAIInput`（`rookie`/`pro`/`legend` 三档反应延迟 `240/140/70 ms`、跑速 `0.78×/0.92×/1.00×`、品质分布与战术选择，确定性纯函数）。
- `shared/src/engine.ts`：`createMatchState`、`stepMatch`（不修改入参、单点推进全部计时器、Takeover 2 分 + 1 分冷却、鹰眼 `<= 15 cm` 判定、`W+K` `forwardAimZ >= 0.5` 放小球）、`launchHawkeyeTestBall`。
- `shared/src/index.ts`：统一导出全部类型、常量与纯函数。

---

## 2. 验收项逐条自测结果（对应 SPEC 编号）

| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **AC-02** | Vitest 脚本 (`ac02_courts_physics.test.ts`) | 4/4 通过：红土弹高 > 硬地 ≥8%、草地弹高 < 硬地 ≥10%、草地弹后水平速 > 红土 ≥20%；`50 m/s`（`48 m/s` 跨网）2× 子步进 0 穿网；3 次迭代解算落点误差 ≤ `0.15 m` | `docs/review/wp1/evidence/round-1/build-typecheck-test.txt` |
| **AC-03** | Vitest 脚本 (`ac03_ac04_archetypes_controls.test.ts`) | 4 流派五维和严格 `400`；`defender` 满速 `7.032 m/s` 较 `power` 高 ≥15%；`allcourt` 绿条半宽较 `serve_volley` 宽 ≥12%；`power` 一发初速最高；服饰头饰体型可区分 | `docs/review/wp1/evidence/round-1/build-typecheck-test.txt` |
| **AC-04** | Vitest 脚本 (`ac03_ac04_archetypes_controls.test.ts`) | `J` topspin、`K` slice、`W+K` dropshot 落点 `\|Z\| ∈ [1.8, 3.6] m`、`L` lob 顶点 ≥ `5.0 m`；`serve_ready` 静默忽略 `L`；极限滑步延伸触球半径至 `1.80 m` | `docs/review/wp1/evidence/round-1/build-typecheck-test.txt` |
| **AC-05** | Vitest 脚本 (`ac05_ac06_ac07_meter_takeover_hawkeye.test.ts`) | `progress >= 1.18` 无条件优先判 `VERY_LATE`；20 次 `PERFECT` 过网率 `100%` 且误差 ≤ `0.15 m`；一发比二发快 ≥25%；一发红区 `20/20`（100%）失误；二发绿/白区 ≥95% 进界 | `docs/review/wp1/evidence/round-1/build-typecheck-test.txt` |
| **AC-06** | Vitest 脚本 (`ac05_ac06_ac07_meter_takeover_hawkeye.test.ts`) | 满 `100` 触发 `TAKEOVER_ON`，绿条半宽实测变为 `1.25×`；精确持续 2 分后触发 `TAKEOVER_OFF` 清零并进入 1 分冷却期（不累计） | `docs/review/wp1/evidence/round-1/build-typecheck-test.txt` |
| **AC-07** | Vitest 脚本 (`ac05_ac06_ac07_meter_takeover_hawkeye.test.ts`) | `launchHawkeyeTestBall` 真实物理：`8 cm` 界内触发 `HAWKEYE_START(isIn=true, <=15cm)`；`10 cm` 界外触发 `HAWKEYE_START(isIn=false, <=15cm)`；`25 cm` 界内/外均不触发鹰眼 | `docs/review/wp1/evidence/round-1/build-typecheck-test.txt` |
| **AC-08** | Vitest 脚本 (`ac08_ac09_rules_ai.test.ts`) | Fast4 `40-40` 金球、`4-2` 完赛、`3-3` 7 分抢七（`4-3`）与换发、超级抢十 `9-9 → 11-9`、6 项统计与 `computeStatsSummary` 零分母保护全部通过 | `docs/review/wp1/evidence/round-1/build-typecheck-test.txt` |
| **AC-09** | Vitest 脚本 (`ac08_ac09_rules_ai.test.ts`) | 相同种子 100% 确定性；30 局基准：`Pro vs Rookie` 胜率 `83.3% (25/30)`，`Legend vs Pro` 胜率 `80.0% (24/30)`；UE 率 `rookie=2.05% (43/2094) > pro=1.08% (41/3812) > legend=0.24% (4/1669)` | `docs/review/wp1/evidence/round-1/build-typecheck-test.txt` |
| **镜像与 FSM** | Vitest 脚本 (`mirror_and_pause_fsm.test.ts`) | `P0(+1)` / `P1(-1)` `W+K` 对称落点 `[1.8, 3.6] m`、`toLocalView`/`toLocalEvent`/`toWorldInput` 全向量镜像；3 次暂停/60s 超时/3s 恢复幂等/断线保留 `pausedFromPhase`/双断线独立计时/15s 弃权全通过 | `docs/review/wp1/evidence/round-1/build-typecheck-test.txt` |
| **构建与纯度** | `npm run build` + `typecheck` + `npm ls` + Node ESM + grep | 0 TS 错误；Node ESM 正常导入 46 个导出；`shared/src/*.ts` 零 `window`/`document`/`three`/`ws`/`fs`/`process`/`Math.random()` 引用 | `docs/review/wp1/evidence/round-1/workspace-and-purity-check.txt` |
