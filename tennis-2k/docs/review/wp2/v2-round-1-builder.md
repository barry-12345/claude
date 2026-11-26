# Builder 交付报告 — V2 Round 1（WP2 `@court2k/client`）

## 0. 快速索引
- **候选版本**：`feat/v2-wp2`（基点 `167edbabf6fe386bcd10a2272498f5b8b32d763c`，最终提交哈希见交付消息与 `git -C <wt-wp2> rev-parse HEAD`）
- **本轮相对上轮变化**：首次 V2 交付，完成 `WP2 (@court2k/client)` 全量 V2 改造（彻底移除 V1 绿条/Takeover/暗箱背景，接入 Blender 5.2 `.glb` 角色与 8 条骨骼动画、明亮大满贯三场地日场穹顶光照、脚下球种预选环、`InputController` 4 条边沿规则、V2 大厅/HUD 文案、`SUPER_TIEBREAK` 横幅与 `waiting` 房 `FULL_SYNC` 保持大厅修复）。
- **改动模块**：
  - `client/src/contracts.ts`
  - `client/src/input/InputController.ts`
  - `client/src/audio/AudioManager.ts`
  - `client/src/net/onlineSync.ts`
  - `client/src/render/PlayerAvatar.ts`
  - `client/src/render/CourtScene.ts`
  - `client/src/ui/LobbyView.ts`
  - `client/src/ui/HudView.ts`
  - `client/src/game/GameApp.ts`
  - `client/src/styles/main.css`
  - `client/tests/input.test.ts`、`client/tests/hud.test.ts`、`client/tests/net.test.ts`
- **启动方式与 Tester 前置条件**：
  - 构建与单测命令：
    ```powershell
    npm run build -w @court2k/shared
    npm run typecheck -w @court2k/client
    npm run test -w @court2k/client
    npm run build -w @court2k/client
    ```
  - 启动预览（端口 `3201`）：
    ```powershell
    npm run preview -w @court2k/client -- --host 127.0.0.1 --port 3201 --strictPort
    ```
  - `/tennis/` 子路径构建验证：
    ```powershell
    $env:VITE_BASE_PATH="/tennis/"; npm run build -w @court2k/client
    ```
  - **测试种子 / 样本**：默认种子 `42`（单机）。
  - **受控测试钩子用法**：
    - 正常入口 `http://127.0.0.1:3201/`：`window.__COURT2K_TEST__ === undefined`（零暴露）。
    - 测试入口 `http://127.0.0.1:3201/?test=1&netdebug=1`：挂载 `window.__COURT2K_TEST__`，支持：
      - `getState()`：返回 `TestStateSnapshot`（含 `avatarLoaded`、`avatarSource`、`avatarTriangles`、`drawCalls`、`matchState`、`inputDiagnostics`）。
      - `spawnIncomingBall({ targetX, targetZ, speedXZ?, forPlayerIndex? })`：接收当前客户端本地视图坐标（`targetZ > 0` 指向己方近端），自动按 `yourSide` 镜像为规范世界坐标注入来球。
      - `triggerHawkeyeShot({ inBounds, distCm, line? })`、`setScore(patch)`、`setSeed(seed)`、`fastForwardPause(seconds)`、`simulatePerfSpike(frameMs, durationMs)`、`simulateRefreshRate(hz)`、`simulateDisconnect(reconnectAfterMs)`。
  - **清理方式**：停止对应前端静态/预览进程即可（仅终止自有 PID，严禁 `pkill`/`killall`）。
- **自测命令与证据索引**：
  - `npm run typecheck -w @court2k/client`：0 error
  - `npm run test -w @court2k/client`：4 files / 20 tests 全部通过
  - `npm run build -w @court2k/client`：JS+CSS gzip `188.73 KB`（含 `.glb` gzip `345.04 KB`）
  - 实机截图目录：`docs/review/wp2/evidence/v2-round-1/`（共 11 张 PNG，已逐张 `read_file` 检查）
- **环境未验证缺口**：
  - 实机 Headless Edge 使用 SwiftShader 软件 WebGL 渲染（约 `7–8 FPS`），硬件 WebGL 真机帧率（`≥ 55 FPS`）与 Retina / `120Hz+` 显示器高刷真实观感需待真机/硬件 GPU 环境复核；
  - 本包仅覆盖 `@court2k/client` 单机与协议单测/界面实测，双独立浏览器 Context 联机实操由 `WP3` 整合阶段统一联调。

---

## 1. 实现概述与接口说明

1. **彻底清零 V1 废弃元素**：
   - 移除 `CourtScene` 脚下 2K 弧形进度条与指针、`PlayerAvatar` 胶囊模型与 Takeover 金色光环、`HudView` 底部双 Takeover 槽、`AudioManager.playTakeover`、`GameApp` 中的 `setTakeover`/`TAKEOVER_ON`/`TAKEOVER_OFF`、`LobbyView` 中的 `TIM` 与绿条描述，以及 `InputController` 中的 `InputPhase`。
2. **Blender 5.2 `.glb` 角色接入（`GlbPlayerAvatar`）**：
   - 通过 `${normalizeBaseUrl(import.meta.env.BASE_URL)}assets/models/tennis_player.glb` 单例缓存加载 `.glb`，使用 `SkeletonUtils.clone()` 为双人独立创建骨架与 10 个可换色材质实例（保持 `Mat_EyeWhite`/`Mat_EyeIris`/`Mat_FaceDetail`/`Mat_RacquetGrip` 静态细节不变）。
   - 按 `ArchetypeConfig.headgear` 切换 `Headgear_Headband` / `Headgear_Visor` / `Headgear_CapBackwards` / `Wristband_L` / `Wristband_R` / `Racquet` 可见性，对 `Chest` 骨骼施加 `shoulderScale`。
   - 使用 `THREE.AnimationMixer` 驱动全部 8 条 NLA Clip（`idle`/`run`/`slide`/`serve_toss`/`forehand`/`backhand`/`lob`/`celebrate`）与 `crossFadeTo` 平滑过渡；在 `armedAction !== 'none'` 时叠加柔和上半身引拍蓄势转向。
   - 加载失败时严禁静默回退胶囊模型，保留 `getStatus()` 返回 `{ loaded: false, source: 'fallback', triangles: 0, clipNames: [] }` 并打印 `console.error`。
3. **明亮大满贯日场转播球场（`CourtScene.ts`）**：
   - 移除 `#09111f` 暗箱背景与黑雾，新增 1-Draw-Call 渐变晴空穹顶（Sky Dome）与三场地专属日场主题（硬地 `#60a5fa → #dbeafe` / 红土 `#5b9ee8 → #fde8d0` / 草地 `#67a9f0 → #e5f3ff`）、暖阳方向光（`2.30–2.45`）+ 半球补光（`1.28`）+ 浅石灰岩看台 + 大厅正面 3/4 透亮预览机位。
   - 仅在 `phase === 'rally' && armedAction !== 'none'` 时在本地玩家脚下渲染柔和球种预选环（`J` `#f59e0b` / `K` `#06b6d4` / `L` `#a855f7`），`CLEAN` 击球触发 `0.32 s` 翡翠绿光波与甜点音效。
4. **操控边沿与两项 V1 遗留修复**：
   - `InputController.sampleFrame()` 严格满足 `CONTRACT.md` §5.1 的 4 条硬规则（忽略 `e.repeat`、帧内快按锁存 1 帧、按住切换球种不互清、全量 `resetAndRebind`）。
   - `HudView` 补齐 `SUPER_TIEBREAK: 'SUPER TIEBREAK · 超级抢十'`、V2 底部操作提示与赛后第 6 项 `CLEAN 甜点率`。
   - `resolveFullSyncTransition()` 确保 `FULL_SYNC` 在 `snapshot.phase === 'waiting'` 时保持在大厅界面。

---

## 2. 验收项逐条自测结果（WP2 覆盖范围）

| SPEC / 要求项 | 验证方式 | 实测结果与关键数字 | 原始证据路径 |
| --- | --- | --- | --- |
| **V1 残留清零 (`AC-04`)** | `rg` 静态扫描 + Vitest + 实机截图检查 | `client/src` 与 `client/index.html` 0 处 `takeover`/`MeterState`/`InputPhase`/`TIM`/`Perfect 绿条率` 残留 | `docs/review/wp2/evidence/v2-round-1/06-post-match-stats.png` |
| **`.glb` 加载与四流派 (`AC-03`, `AC-11`)** | Headless Edge `?test=1` + 大厅 4 流派截图逐张检查 | `avatarLoaded=true`, `avatarSource='glb'`, `avatarTriangles=4640`, 大厅 `59` / 赛中 `81` Draw Calls（`≤ 150`），4 流派头饰/护腕/体型/球衣清晰可分 | `01-lobby-power.png` ~ `01-lobby-defender.png` |
| **三场地日场光照与亮度 (`AC-02`)** | Headless Edge 3 场地实机截图 + RGB 亮度测算 | 硬地 `full=148.02, upper=154.17`；红土 `full=142.04, upper=154.90`；草地 `full=135.58, upper=157.62`（均远超 `≥95` / `≥120` 门槛） | `02-court-hard.png`, `02-court-clay.png`, `02-court-grass.png` |
| **V2 操控边沿与预选环 (`AC-05`)** | Vitest 6 条 `InputController` 单测 + Edge `?test=1` 实操 | 不按放球 `noKeyMissed=true`；按 `K` 显现青色脚下光环 `armedKWasK=true` 并自动击出 `dropshot`（`autoHitKCount=1`）；长按 `≥0.22s` 松手取消 `armedAction='none'` | `03-stance-ring-k.png`, `03b-no-key-miss.png` |
| **鹰眼 / 超级抢十 / 赛后统计 (`AC-08`, `AC-09`)** | Vitest `hud.test.ts` + Edge `?test=1` 实机截图 | 鹰眼 `IN · 界内`（`7.3 cm`）；横幅准确显示 `SUPER TIEBREAK · 超级抢十`；赛后第 6 项 `CLEAN 甜点率` 正常 | `04-hawkeye-in.png`, `05-super-tiebreak-banner.png`, `06-post-match-stats.png` |
| **`waiting` 房 `FULL_SYNC` + 网络 (`AC-13`)** | Vitest `net.test.ts`（6/6 通过） | `snapshot.phase === 'waiting'` 保持 `mode='lobby'` 并清空 `SnapshotBuffer` | `client/tests/net.test.ts` |
| **子路径构建与轻量化 (`AC-11`, `AC-16`, `AC-17`)** | `vite build`（`/` 与 `VITE_BASE_PATH=/tennis/`）+ 实机 Edge | JS+CSS gzip `188.73 KB`（`≤ 600`），含 `.glb` 总 gzip `345.04 KB`（`≤ 800`）；`/tennis/` 加载 `.glb` 0 个 404；正常入口 `window.__COURT2K_TEST__ === undefined`；0 console/page/HTTP error | — |
