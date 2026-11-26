# Builder 交付报告 — V2 Round 1（WP1 `@court2k/shared`）

## 0. 快速索引
- **候选版本**：`feat/v2-wp1 @ <pending-commit>`（基点 `2f6c96fae70e9b6040c54ef7a23221513a3f8c23`）
- **本轮相对上轮变化**：首次 V2 交付。彻底删除 `shared/src/meter.ts` 与全部 V1 进度条/火热槽残留，按 `CONTRACT.md` §2 完整实现 V2 类型契约、`ARCHETYPES`/`COURTS`、`ShotStanceState` 自动最佳触球与“不按允许落空”状态机、决策 1A 无进度条一键分级发球、决策 2A 前后左右球路与 `CLEAN/SOLID/STRETCH` 质量模型、`spawnIncomingTestBall`、`cloneMatchState` 及 3 档 V2 AI 校准。
- **启动方式与 Tester 前置条件**：
  - 构建与验证命令（在 `tennis-2k/` 目录）：`npm run build -w @court2k/shared`、`npm run typecheck -w @court2k/shared`、`npm run test -w @court2k/shared`
  - 测试种子：固定种子（`42`、`55`、`66`、`77`、`91`、`99`、`100`、`101`、`1000–1029`、`2000–2029`）
  - 受控测试钩子用法：`spawnIncomingTestBall(state, { targetX, targetZ, speedXZ?, forPlayerIndex? }, rng)` 与 `launchHawkeyeTestBall(state, { inBounds, distCm, line? }, rng)`、`applyScorePatch(state, patch)`、`fastForwardPauseState(state, seconds)`（均为纯函数，不影响正常对局流程）
  - 清理方式：纯 TypeScript 单元测试，无常驻服务或临时测试数据
- **自测命令与证据索引**：
  - 一键测试命令：`npm run build -w @court2k/shared && npm run typecheck -w @court2k/shared && npm run test -w @court2k/shared`（结果：5/5 测试文件、25/25 用例全部通过）
  - 关键证据路径：
    - [build.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/build.log)
    - [typecheck.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/typecheck.log)
    - [test.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/test.log)
    - [static_purity_scan.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/static_purity_scan.log)
- **环境未验证缺口**：WP1 仅包含 `@court2k/shared` 共享内核与无头模拟测试；客户端渲染/输入、Blender `.glb` 与服务端 WS 联调（`AC-01`、`AC-11`~`AC-17`）待 WP2 / WP3 / integration 阶段验证。

---

## 1. 实现概述与接口说明
- **移除与清零**：删除 `shared/src/meter.ts` 及 `shared/tests/ac05_ac06_ac07_meter_takeover_hawkeye.test.ts`；在 `shared/src/` 全面清除 `MeterState`、`InputPhase`、`takeover*`、`TAKEOVER_ON`、`TAKEOVER_OFF`、`set_takeover`、`ArchetypeConfig.timing`、`perfectShots`、`totalMeterShots`、`SHOT_METER_MULT`、`METER_*`。
- **类型与常量（`types.ts`、`constants.ts`、`ratings.ts`、`index.ts`）**：
  - 实现 `ArchetypeConfig.control`（四流派总分均严格 `= 400`）与外观字段 `shortsColor`/`hairColor`/`skinTone`、`shoulderScale`（`1.10 / 1.00 / 1.03 / 0.94`），同步更新 `COURTS` 日场配色。
  - 实现 `ShotQuality = 'CLEAN' | 'SOLID' | 'STRETCH'`、`ShotStanceState`、`PlayerInputFrame`（`action` + `actionPressed`）、`KeyPointLabel`（新增 `'SUPER_TIEBREAK'`）、`SpawnIncomingBallOptions`、`InputDiagnostics`、`TestStateSnapshot`（含 `avatarLoaded`/`avatarSource`/`avatarTriangles`），全部由 `shared/src/index.ts` 唯一导出。
  - 在 `shared/src/ratings.ts` 实现 `computeComfortRadius`、`computeControlScatterM`、`computeStretchSidelineErrorProb`、`computeFirstServeCornerFaultProb`、`computePositionShotQuality` 等纯函数。
- **V2 状态机与规则（`engine.ts`、`rules.ts`、`mirror.ts`、`ai.ts`）**：
  - `stepMatch` 严格执行“不按允许落空”、短按（`<0.20 s`）给 `0.35 s` 缓冲、长按（`≥0.20 s`）松手立即取消、网前防同帧与隔网连击（`ball.hitTick < next.tick`、`ball.pos.z * p.side >= -0.05`、`ball.vel.z * p.side > 0`）。
  - 决策 1A：`serve_ready` 严格检查 `actionPressed && (J || K)`（`L` 静默忽略），`0.32 s` 抛球不因松手取消、`lockedAimX` 仅 `|aimX| > 0.05` 更新，`J` 满压极边角 3%–16% 自然失误受 `CTL` 降幅、`K` 100% 进区，`NET_LET` 精确回滚 `totalShots`/`cleanShots`/`firstServesTotal`。
  - 决策 2A：`K` 默认前场放小球、`W+K` 贴网小球、`S+K` 中场防守切削；`STRETCH` 对 `dropshot` 执行 `+0.35 m` 钳位 `[2.0, 3.8] m`，对中深球执行 `-1.1 m` 钳位 `>= 2.2 m`。
  - `toLocalView` 镜像 `players[i].stance.lockedAimX`；`cloneMatchState` 深拷贝 `stance`；`spawnIncomingTestBall` 按契约实现；重构 3 档 AI（`rookie`/`pro`/`legend`）统一走 V2 自动触球输入协议。

---

## 2. 验收项逐条自测结果（对应 SPEC 编号）
| SPEC 编号 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **AC-02**（物理） | `vitest` 单测 | 4/4 通过：三场地参数与弹跳/弹后水平速差异及 3 次迭代解算器精度达标 | [test.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/test.log) |
| **AC-03** | `vitest` 单测 | 4 流派总分均 `= 400`、`defender` 跑速 `7.032 m/s`（> `power` `≥ 15%`）、`allcourt` 舒适圈 `1.138 m` > `serve_volley` `1.042 m`（`+9.2%`）、`power` 一发初速最高 | [test.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/test.log) |
| **AC-04**（shared） | 静态扫描 | 全部 V1 废弃标识符与 DOM/`three`/`ws`/`fs`/`node:`/`process` 引用在 `shared/src` 均为 **0 命中** | [static_purity_scan.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/static_purity_scan.log) |
| **AC-05** | `vitest` 单测 | 不按键 `0` 次自动挥拍允许落空；短按 `0.35s` 缓冲命中；长按 `≥0.20s` 松手立即取消；网前无同帧/隔网连击；粘土滑步触球半径延展至 `1.90 m` | [test.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/test.log) |
| **AC-06** | `vitest` 单测 | `J`/`K`/`W+K`/`S+K`/`L` 落点与 `A`/`D` 差（`≥ 4.4 m`）达标；`CLEAN` 速度 > `SOLID` > `STRETCH`；21 组 `CLEAN` 地面球 `100%` 过网且误差 `≤ 0.12 m`；`STRETCH` 放小球严格钳位 `[2.0, 3.8] m`；高 `CTL` 极限压线失误率低于低 `CTL` | [test.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/test.log) |
| **AC-07** | `vitest` 单测 | 一键 `0.32s` 抛球发球（松手不取消、`lockedAimX` 锁存、`L` 与非边沿输入忽略）；`J` 初速 > `K` `≥ 22%`；`K` `25/25`（`100%`）进区；`J` 极边角失误率位于 `3%–16%` 且高 `CTL` 更低；`NET_LET` 精确回滚统计 | [test.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/test.log) |
| **AC-08 / AC-09 / 镜像暂停** | `vitest` 单测 | 三场地 `8 cm IN`/`10 cm OUT` 触发鹰眼、`25 cm` 跳过；Fast4 金球/抢七与超级抢十（初始 `SUPER_TIEBREAK`、`9-9 → 11-9`）及 `applyScorePatch` 通过；`P0/P1` 镜像对称、暂停 3 次/60s 超时/双断线重连/15s 弃权通过 | [test.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/test.log) |
| **AC-10** | `vitest` 30 局基准 | `Pro vs Rookie: 100.0% (30/30)`、`Legend vs Pro: 100.0% (30/30)`；UE 率严格递减 `rookie=3.32% > pro=0.29% > legend=0.08%`；`CLEAN` 率严格递增 `legend=78.14% > pro=73.92% > rookie=59.15%` | [test.log](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wp1/tennis-2k/docs/review/wp1/evidence/v2-round-1/test.log) |
