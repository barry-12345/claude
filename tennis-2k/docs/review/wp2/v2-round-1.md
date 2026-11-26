# WP2（`@court2k/client`）独立评审报告 — V2 Round 1

结论：PASS
候选版本：`feat/v2-wp2` @ `0a7bfd4e32afb745d589c8285a5906ff65970a15`（基点 `167edbabf6fe386bcd10a2272498f5b8b32d763c`）
本轮核验方式：独立代码与断言审查 + 静态残留扫描 + `@court2k/shared` / `@court2k/client` 构建、类型检查、Vitest（20/20）与 `VITE_BASE_PATH=/tennis/` 包体核算 + 委派独立 Tester `tester-wp2`（`Gemini 4 Hydrogen (High)`，Edge Headless 1280×720，报告 `docs/review/wp2/v2-round-1-tester.md`）实机取证 + Reviewer 逐张亲审全部 17 张关键帧截图。

## 达标项

- **[写边界与隔离 / AC-17]**：`git rev-parse HEAD` 精确为 `0a7bfd4e32afb745d589c8285a5906ff65970a15`；代码改动严格限定于 `tennis-2k/client/src/**`、`tennis-2k/client/tests/**` 与 `tennis-2k/docs/review/wp2/**`，零触碰 `package.json`/`shared`/`server`/`assets`；零 `shared/src` 深路径 import；正常入口 `window.__COURT2K_TEST__ === undefined` 且 `.netdebug-panel` 隐藏（`docs/review/wp2/v2-round-1-tester.md` T-01）。
- **[零 V1 废弃残留 / AC-04]**：静态扫描与代码深审确认 `client/src/**`、`client/index.html`、`client/vite.config.ts` 零 `MeterState`、`InputPhase`、`takeover*`、`TAKEOVER_ON/OFF`、`set_takeover`、`playTakeover`、`TIM`、`Perfect 绿条率`、`#09111f` 残留；实机截图核实大厅、实战、预选环、鹰眼、赛后均彻底无进度条与无火热槽（`docs/review/wp2/evidence/v2-round-1-tester/t01-rally.png`, `t03-ring-j.png`, `t06-post-match.png`）。
- **[正常入口主流程与 Esc 暂停自愈 / AC-01]**：不带 `?test=1` 从大厅选「单人 → 硬地 → 全能节奏 → 新手 AI → Fast4 → 开始」，纯键盘 `WASD` + `J/K/L` 完整打完 1 局 Fast4（局分推进至 `0-1`，用时 `35.92s`）；赛中 `Esc` 暂停再按 `Esc` 恢复后立即移动即时响应；全程 0 console error / 0 pageerror / 0 HTTP 404（`docs/review/wp2/evidence/v2-round-1-tester/t01-rally.png`, `t01-pause.png`, `t01-game-finished.png`）。
- **[Blender 5.2 `.glb` 角色接入与 4 流派差异 / AC-03, AC-11]**：
  - 代码审核实 `GlbPlayerAvatar` 通过 `${normalizeBaseUrl(import.meta.env.BASE_URL)}assets/models/tennis_player.glb` 单例加载、`SkeletonUtils.clone()` 独立克隆骨架与 10 个换色材质（保持 4 静态五官/握把材质不变）、精准切换 5 个头饰/护腕节点 + `Racquet`、驱动全部 8 段 NLA 动画（已核对 `.glb` 8 条动画均含 `Spine.rotation`/`Chest.rotation` 轨道，叠加引拍 `coilYaw` 不会累积漂移）、每帧施加 `Chest` `shoulderScale`、且严禁静默回退（失败时 `loaded=false, source='fallback'` 并 `console.error`）。
  - 实机与截图亲审确认：`avatarLoaded=true`、`avatarSource='glb'`、`avatarTriangles=4640`（`∈ [3500, 7500]`）、赛中 `DrawCalls=78–81`（`≤ 150`）；大厅 4 流派（头带+宽肩 / 双护腕 / 遮阳帽全白 / 反戴鸭舌帽修长）外观、体型、五官与五维 `POW/SPD/SPN/CTL/NET`（总分 400）清晰可辨、无黑缝穿模（`t01-lobby-power.png` ~ `t01-lobby-defender.png`）。
  - 独立复跑生产构建：JS+CSS gzip `188.76 KiB`（Vite 报 `193.26 kB`，远低于 `≤ 600 KB`）、`.glb` 原始 `344.17 KiB`（`≤ 350 KB`）、含 `.glb` 总 gzip `345.07 KiB`（远低于 `≤ 800 KB`）。
- **[三场地明亮日场光照与红土扬尘 / AC-02]**：代码与 3 场地截图亲审均确认移除暗箱背景，1-Draw-Call 渐变晴空穹顶与三场地主题精准对齐 SPEC；实测上空 35% 均亮度 `153.87 / 156.59 / 157.94`（门槛 `≥ 120`）、全帧均亮度 `144.36 / 146.23 / 131.99`（门槛 `≥ 95`）；红土急跑/滑步扬尘可见（`t02-hard.png`, `t02-clay.png`, `t02-grass.png`）。
- **[V2 操控 4 条边沿规则与预选环 / AC-05, AC-06]**：
  - `InputController` 严格实现 CONTRACT §5.1 全部 4 条规则（忽略 `e.repeat`、帧内快按 1 帧锁存、按住切换球种不互清且松开新键回落旧键不重发边沿、`resetAndRebind` 覆盖全部 6 类时机），`input.test.ts` 6/6 真实断言通过。
  - `?test=1` 实测确认：近身不按键 0 次自动挥拍允许落空；按 `J` 显示琥珀色 `#f59e0b` 地面预选环并自动击出深球 `topspin`（`z=-9.928`）；按 `K` 显示青色 `#06b6d4` 地面预选环并自动击出前场 `dropshot`（`z=-2.953`）；长按 `0.30s` 入圈前松手立即取消（`armedAction='none'`）允许落空（`t03-no-key-miss.png`, `t03-ring-j.png`, `t03-ring-k.png`）。
- **[无进度条一键分级发球 / AC-07]**：`?test=1` 实测 `L` 键静默忽略；`A+J` / `D+J` 均触发 `serve_flat`（`197 / 195 km/h`，落点 `x=-3.903 / -0.220`）；`A+K` / `D+K` 均触发 `serve_kick`（`146 / 148 km/h`，落点 `x=-3.914 / -0.178`），抛球中松手不取消，零进度条（`docs/review/wp2/v2-round-1-tester.md` T-04）。
- **[轻量 3D 鹰眼与按键恢复 / AC-08]**：`8cm` 判 `IN · 界内`（`7.3 cm`）、`10cm` 判 `OUT · 出界`（`7.2 cm`，`durationSec=1.8`）、`25cm` 不触发；结束后 `lastResetReason='HAWKEYE_END'` 且按 `D/A` 角色位移即时响应（`t05-hawkeye-in.png`, `t05-hawkeye-out.png`）。
- **[超级抢十横幅、赛后 `CLEAN` 甜点率与静音 / AC-09, AC-15]**：`HudView` 与实机截图核实顶部准确显示 `SUPER TIEBREAK · 超级抢十`；赛后 6 项统计第 6 项为 `CLEAN 甜点率` 且 `hud.test.ts` 3/3 通过；`AudioManager` 纯 Web Audio 合成无外部音频、无 Takeover 音效，静音按钮切换即时生效且 0 AudioContext 报错（`t06-super-tiebreak.png`, `t06-post-match.png`）。
- **[`waiting` 房 `FULL_SYNC` 保持大厅 / AC-13 客户端部分]**：`resolveFullSyncTransition` 与 `GameApp.ts` 核实 `snapshot.phase === 'waiting'` 时清空 `SnapshotBuffer`、保持 `mode='lobby'` 与大厅界面可见，不误切空比赛画布，`net.test.ts` 6/6 全部通过。
- **[DPR / 高刷限帧与 `?netdebug=1` / AC-14]**：`perf.test.ts` 5/5 通过；实机 `simulateRefreshRate(90/100/120/144)` 对应 `fpsCapEnabled = false/false/true/true`，`simulatePerfSpike(30, 2600)` 正确降档（`HIGH → MEDIUM → LOW`），`activeDpr <= 2.0`、`upgradeCount <= 1`（`t07-netdebug.png`）。
- **[`/tennis/` 子路径兼容 / AC-16 客户端部分]**：`VITE_BASE_PATH=/tennis/` 构建并在独立端口 `4512` 实机挂载验证，HTML/JS/CSS 与 `/tennis/assets/models/tennis_player.glb` 全部 HTTP `200`（0 个 404），`avatarLoaded=true, avatarSource='glb'`（`docs/review/wp2/v2-round-1-tester.md` T-08）。

## 返工项

无必须级返工项。

（轻微非阻断建议，可留作后续润色，不影响本轮 PASS）：
1. `client/src/styles/main.css` 与 `client/src/ui/HudView.ts` 中绿色提示徽章的内部 CSS 类名仍叫 `.shot-badge.perfect`（纯内部样式名，用户界面无任何 `Perfect` 文案），后续顺手可改为 `.shot-badge.clean`。
2. `client/src/render/PlayerAvatar.ts:158` `bodyPivot.rotation.y` 当前使用线性 `damp`，后续可改为最短角差插值以防潜在 `±π` 跨界旋转。
3. 联机模式下 `allowArrowKeys` 为 `false`，底部 `.controls-mini` 提示仍写 `WASD/方向键`，后续可按模式区分显示。

## 阻塞项

无。

## 规格层面问题

无。

## 未验证项（非门槛 / 环境限制）

- Headless Edge 环境使用 SwiftShader 软件 WebGL（约 `8–16.6 FPS`），硬件 GPU 真机平均 FPS（`≥ 55`）、Mac Retina 2x 物理屏及真 120Hz/144Hz 物理屏实机观感需待真机环境确认。
- 双独立浏览器 Context 1v1 联机实操（含双端近端镜像、`waiting` 房真实刷新重连、4s 断线重连防按键失灵与 15s 弃权）按分工留待 `integration/v2` 整合阶段连同 `WP3 (@court2k/server)` 全链路联调验收。

## 给用户的摘要

WP2（`@court2k/client` 前端）V2 Round 1 独立评审通过（`PASS`）。经代码审查、构建单测（20/20 通过，JS+CSS gzip 188.8 KiB、含 `.glb` 总 gzip 345.1 KiB）以及独立 Tester 实机 Edge 浏览器 8 大用例全绿验证与全部关键帧截图核验，V1 进度条与火热槽已彻底清零，Blender 5.2 `.glb` 风格化角色与 4 流派外观、三场地明亮日场转播光照、自动触球预选环与不按允许落空、一键发球、3D 鹰眼、超级抢十横幅、`CLEAN` 甜点率及 `/tennis/` 子路径均达标，可合入主线推进整合联调。

## Obsidian 一行摘要

PASS / WP2 客户端 V2 零 V1 残留，GLB 4 流派与三场地明亮日场、自动触球预选环、鹰眼、超抢十、`waiting` 保持大厅及 `/tennis/` 均经实机截图与 20 项单测验证达标 / 可合入 V2 基点并启动 `integration/v2` 联调
