结论：PASS
候选版本：`feat/v2-wp1 @ ed48c530d8e1184c651bc288603176067b94f1aa`（基点 `2f6c96fae70e9b6040c54ef7a23221513a3f8c23`）
本轮核验方式：独立代码与测试断言深审 + 静态纯度与 V1 残留扫描 + 在 `wt-wp1/tennis-2k` 独立复跑 `build / typecheck / test` + 项目外独立边界反例探针脚本（`wp1_probe.mjs`）核验（纯 TypeScript 内核，脚本确定性闭环，无需派 Tester）

达标项：
- [版本、写边界与纯度 / AC-04, AC-17] `git rev-parse HEAD === ed48c530d8e1184c651bc288603176067b94f1aa`，改动严格限定于 `tennis-2k/shared/**` 与 `tennis-2k/docs/review/wp1/**`，未修改根或包 `package.json` / `package-lock.json`；独立正则扫描 `shared/src` 与 `shared/tests` 确认 V1 废弃项（`meter.ts`/`MeterState`/`InputPhase`/`takeover*`/`TAKEOVER_*`/`set_takeover`/`.timing`/`perfectShots`/`totalMeterShots`/`SHOT_METER_MULT`/`METER_*`）**0 命中**，且 `shared/src` 零 DOM/`three`/`ws`/`fs`/`node:`/`process`/`Math.random()` 运行时依赖。
- [契约与导出完整度 / CONTRACT §2] 核对 `types.ts`、`constants.ts`、`ratings.ts`、`mirror.ts`、`rules.ts`、`pause.ts`、`engine.ts`、`ai.ts` 与 `shared/dist/index.js` 运行时导出：全部 36 项核心常量与纯函数、全部 V2 协议与诊断类型（含 `ShotStanceState`、`PlayerInputFrame`、`KeyPointLabel` 新增 `'SUPER_TIEBREAK'`、`SpawnIncomingBallOptions`、`InputDiagnostics`、`TestStateSnapshot`）与 `CONTRACT.md` §2 逐字一致；纯函数不可变性探针验证 8 个核心纯函数对输入 `MatchState` 零原地修改；`cloneMatchState` 完整深拷贝 `players[0/1].stance`。
- [独立构建与测试全绿 / AC-02, AC-03, AC-05~AC-10] 独立复跑 `npm run build -w @court2k/shared && npm run typecheck -w @court2k/shared && npm run test -w @court2k/shared` 全部退出码 `0`，5/5 测试文件、25/25 用例全绿（详见 `wt-wp1/tennis-2k/shared/tests/`）。
- [自动最佳触球与“不按必落空” / AC-05] 代码审 + 探针验证：`stance.armedAction === 'none'` 严格跳过击球检测（含移动状态下 P0/P1 近身来球均 0 次挥拍允许落空）；短按（`<0.20 s`）松手进入 `0.35 s` 预输入缓冲并准确挥中，长按（`≥0.20 s`）松手立即取消武装并允许落空，按住期间切换球种重置 `holdDurationSec = dt`；网前双人站位严格执行 `ball.hitTick < next.tick`、`ball.pos.z * p.side >= -0.05` 与 `ball.vel.z * p.side > 0`，P0/P1 双向均无同帧连击或隔网触球。
- [球路、3 档质量与四流派 400 分 / AC-03, AC-06] 四流派（`power`/`allcourt`/`serve_volley`/`defender`）五维含 `CTL` 且总分严格均为 `400`；独立探针全组合遍历 4 流派 × 2 站位深度 × 3 左右瞄准 × `J`/`K`/`W+K`/`S+K`/`L` × `CLEAN`/`SOLID`/`STRETCH`：`CLEAN`（21 组单测误差 `≤ 0.12 m`）与 `SOLID` 地面球 `100%` 过网；`STRETCH` 放小球（48/48）不缩减 `-1.1 m` 改为 `+0.35 m` 钳位 `[2.0, 3.8] m`（实测落点 `2.000–3.801 m`，0 挂网）；`STRETCH` 中深球最小实测 `4.365 m`（`≥ 2.2 m`）；`L` 挑高球全档最低顶点 `7.438 m`（`≥ 5.0 m`）；`CLEAN` 速度 > `SOLID` > `STRETCH`；高 `CTL` 极限压线出界率显著低于低 `CTL`。
- [决策 1A 一键分级发球与 NET_LET 回滚 / AC-07] `serve_ready → serve_toss` 严格边沿触发 `actionPressed && (J || K)`（`L` 与非边沿持续按住均静默忽略）；进入 `0.32 s` 抛球后松手不取消、`lockedAimX` 仅在 `|aimX| > 0.05` 时更新；探针全组合遍历 `K` 二发 288 次（4 流派 × 3 场地 × P0/P1 × deuce/ad × aimX/aimZ）**288/288（100%）进区、0 失误**；`J` 一发初速高于 `K` `≥ 22%`，极边角自然失误率位于 `3%–16%` 且受 `CTL` 降低；一发与二发 `NET_LET` 均精确回滚 `totalShots`、`cleanShots`（仅 `CLEAN`）与 `firstServesTotal`（仅一发）。
- [规则、镜像、暂停与 3 档 V2 AI / AC-08, AC-09, AC-10] `launchHawkeyeTestBall` 与三场地 `8 cm IN / 10 cm OUT / 25 cm` 达标；Fast4 金球/抢七与超级抢十（初始与 `9-9` 为 `'SUPER_TIEBREAK'`，`10-9` 为 `'MATCH_POINT'`，`11-9` 完赛）无死锁；`toLocalView` 正确镜像 `stance.lockedAimX` 与全部空间量，`K/W+K/S+K` 及发球深浅 P0/P1 100% 对称；在线暂停 3 次/60s 超时/双断线重连重置 `lastAckSeq`/15s 弃权均通过；`AC-10` 30 局基准 `Pro vs Rookie 100.0% (30/30)`、`Legend vs Pro 100.0% (30/30)`、UE 递减（`3.32% > 0.29% > 0.08%`）、`CLEAN` 递增（`59.15% < 73.92% < 78.14%`），探针换边在红土/草地实测 `Pro(P1) vs Rookie(P0) 10/10`、`Legend(P1) vs Pro(P0) 10/10` 无位置偏置。

返工项（无必须级问题；仅记录 1 条轻微建议供后续按需优化）：
【建议 1（建议）：`updatePlayerStanceBuffer` 浮点累加边界可加微小容差 `1e-6`】
- 现象与证据：独立探针在 `dt = 1/60` 下累加 12 tick 得到 `holdDurationSec = 0.19999999999999998 < 0.20`（导致第 12 tick 仍走短按缓冲、第 13 tick `0.2167 s` 才长按取消），同理 `0.35 - 21 * (1/60) = 4.86e-17 > 0` 使缓冲多留 1 tick（`16.6 ms`）。
- 影响：仅 ±1 帧（`16.6 ms`）浮点尾数差异，不影响玩家手感与任何验收指标，不构成阻塞。
- 修改方向：如后续触及 `engine.ts`，可在 `TAP_MAX_HOLD_SEC` 比较与 `bufferRemainingSec` 归零处增加 `1e-6` 容差。
- 下轮验收标准：非必改项，无需为此返工。

未验证项（非门槛 / 范围边界）：
- WP1 仅覆盖 `@court2k/shared` 共享内核与无头模拟测试；客户端 3D 渲染、输入采样边沿（`e.repeat`/快按锁存）、Blender `.glb` 角色与服务端 WS 联机同步（`AC-01`、`AC-02` 视觉亮度、`AC-11`~`AC-17` 实机部分）归属 WP-Asset / WP2 / WP3 / integration 阶段验证。

给用户的摘要：WP1（`@court2k/shared`）独立代码审、静态纯度扫描、25/25 单元测试复跑与边界反例探针全部通过，裁决 `PASS`。V1 进度条与火热槽已彻底清零，V2 自动最佳触球、“不按必落空”、短按缓冲/长按取消、一键分级发球、四流派 400 分 `CTL` 与 3 档 AI 行为均严格符合 `SPEC.md` 与 `CONTRACT.md` §2 契约。仅存在 1 处 ±16.6ms 浮点尾数边界的轻微优化建议，不影响合入与下游 WP2/WP3 开工。
Obsidian 一行摘要：PASS / WP1 `@court2k/shared`（`ed48c53`）代码审、纯度扫描、25/25 单测与独立边界探针全通过，零 V1 残留 / 可合入 V2 基点并解锁 WP2 与 WP3
