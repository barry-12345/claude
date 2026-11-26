# 《Court 2K：大满贯时代》V2 契约评审报告 — Round 1

结论：FAIL
候选版本：基点 `feat/tennis-2k-v2 @ ee66efd5f59e8cd6e248c78ad9507be6e52bf576`（工作区未提交 V2 规格与契约稿）
- `tennis-2k/docs/SPEC.md` SHA-256: `EAAE3ABC4196449B5FB0BE34B8FDB5F3BC7E384E67E5488A243E26D38E0BBB29`
- `tennis-2k/docs/CONTRACT.md` SHA-256: `86760B436F780FE2AD134CB524525D27943CDB79BE357AB8FB21519963270DE6`
- Obsidian SSOT 主本：`G:\我的云端硬盘\Barry's obsidian\99_System\Data\Quick_Notes\Notes\Court 2K：大满贯时代 · V2 规划与版本页.md`
本轮核验方式：独立静态契约审查（通读 `SPEC.md`、`CONTRACT.md`、Obsidian SSOT 主本，并对照 V1 基点源码 `shared/src/*`、`client/src/*`、`server/src/*`、`*/package.json` 及 `docs/review/contract/round-2.md` 逐项验算数学公式、状态机时序、双端镜像、WS 60Hz 边沿帧与 Blender 5.2 `.glb` 资产契约；预分配端口 `4900–4999` 本次标为不适用）

---

## 达标项

- **[V1 废弃字段零残留（SPEC / CONTRACT 维度）]** `CONTRACT.md` §1 明确封禁 `MeterState`、`InputPhase`、`takeover*`、`TAKEOVER_ON`、`TAKEOVER_OFF`、`set_takeover`、`ArchetypeConfig.timing`、`perfectShots`、`totalMeterShots`、`SHOT_METER_MULT`、`METER_*`；§2–§3 所有核心类型与协议已彻底移除上述字段，`computeStatsSummary` 返回 `{ firstServePct, cleanPct }`，`KeyPointLabel` 新增 `'SUPER_TIEBREAK'`。
- **[核心数值公式与部分 AC 数学自洽]** 四流派五维属性总分经核验严格均为 `400`（`power`: `94+72+82+76+76=400`、`allcourt`: `80+80+82+86+72=400`、`serve_volley`: `84+84+74+74+84=400`、`defender`: `70+94+86+82+68=400`）；`defender` 跑速较 `power` 高 `+17.67%`（满足 `AC-03 ≥ 15%`）；`allcourt` 舒适圈 `R_sweet = 1.138 m` 较 `serve_volley` `1.042 m` 高 `+9.21%`（满足 `AC-03 ≥ 8%`）；`J` 一发与 `K` 二发理论初速与过网后速度差约 `+25.7%`（满足 `AC-07 ≥ 22%`）；`A/D` 左右落点差 `7.23–7.95 m`（满足 `AC-06 ≥ 4.4 m`）；`p_fault`（`6.7%–10.3%`）与 `p_err`（`9.6%–14.4%`）随 `CTL` 严格单调递减且落入区间内。
- **[WS 服务端边沿帧保护与 `waiting` 重连修复]** `CONTRACT.md` §3.3 明确了服务端 `validation.ts` 强校验 `actionPressed: boolean`、输入队列满 `8` 帧优先丢弃首个 `actionPressed === false` 的旧帧、空队列复用 `lastInputs[idx]` 必须强制清空 `actionPressed: false`、`RECONNECT`/`MATCH_START` 序号与缓冲复位，以及 `FULL_SYNC` 在 `waiting` 阶段保持大厅视图。
- **[工作包独占写边界、依赖拓扑、端口隔离与零新增依赖红线]** `CONTRACT.md` §6 的 `(WP1 ∥ WP-Asset) → (WP2 ∥ WP3) → integration/v2` 四工作包写目录零重叠，端口段（`3100/4100`、`3200/4200/4510`、`3300/4300`、`4900/4520`）符合 `parallel.md` 规范；经核对 `tennis-2k/package.json` 及三子包 `package.json`，`three@^0.174.0`、`ws@^8.18.1`、`vitest@^3.1.1`、`playwright-core@^1.51.1` 均已就位，零新增第三方依赖可行。
- **[`E2E-01`~`E2E-05` 与 `?test=1` 生产隔离]** 跨包端到端联调场景覆盖全部核心 V2 机制、`waiting` 房重连、鹰眼镜像、`/tennis/` 子路径 `.glb` 加载及 16 并发房压测；`window.__COURT2K_TEST__` 与 `ENABLE_TEST_HOOKS=1` 隔离清晰。

---

## 返工项（均须修复后复验）

### 【问题 1（必须）：Blender `.glb` 单角色 Draw Calls 门槛与材质/节点契约存在数学矛盾，且 WP-Asset ↔ WP2 四项导出绑定细节未锁定】
- **现象与证据**：
  1. **数学不可行矛盾**：`SPEC.md` §3.5（L148）与 Obsidian SSOT（L213）要求**单角色 Draw Calls `≤ 12`**；但 `CONTRACT.md` §4.2（L424–L425）同时锁定 10 个命名材质槽（躯干/四肢/服饰/鞋袜占 8 个、球拍框+球线占 2 个）与 5 个独立可切换节点（`Headgear_*`、`Wristband_L`、`Wristband_R`）+ `Racquet`。以 `power` 流派（`Headgear_Headband` + 双护腕 + 球拍，见 `SPEC.md` L94）实算，glTF 2.0 / Three.js 中每个材质 Primitive 或独立 Mesh 节点至少产生 1 次 Draw Call：主体 `8` + 头带 `1` + 左护腕 `1` + 右护腕 `1` + 球拍 `2` = **至少 `13` 次 Draw Calls**；若简约五官（眼白/虹膜/微笑嘴，`SPEC.md` L146）使用不参与换色的静态材质，则达 **`15–16` 次**，**数学上必然突破 `≤ 12/角色`**。
  2. **独立节点与挂载层级未强制**：`CONTRACT.md` §4.2（L425）仅注明 `Racquet` 挂于 `RacquetSocket`，未强制规定 `Headgear_Headband` / `Headgear_Visor` / `Headgear_CapBackwards`（挂于 `HeadgearSocket`）与 `Wristband_L` / `Wristband_R`（挂于 `Forearm_L`/`Forearm_R` 或 `Hand_L`/`Hand_R`）必须为**独立命名的 glTF 场景节点**（可经 `root.getObjectByName(name)` 检索并切换 `.visible`），而非合并进主体 `SkinnedMesh` 的顶点组；亦未给出 21 根骨骼的明确父子层级树。
  3. **Blender 坐标系与右手持拍侧未警示**：Blender 默认建模正面朝 `-Y`，使用 `export_yup=True` 导出后 `-Y` 会变成 glTF `+Z`（与契约要求的正面朝 `-Z` 恰好 **180° 反向**）；且未锁定右手持拍在 glTF `+X` 侧（面向 `-Z` 时右侧为 `+X`），`WP-Asset` 与 `WP2` 并行/先后衔接极易出现角色背对球网或左右镜像反手错误。
  4. **五官/配饰材质归属与 `shoulderScale` 动画覆写未锁定**：未明确五官静态材质是否允许超出 10 个换色材质名、头饰/护腕复用 `Mat_JerseyPrimary`/`Mat_JerseyAccent` 的映射；也未约束 8 条 NLA 动画禁止导出骨骼 `scale` 关键帧（否则 `AnimationMixer` 每帧会覆写 `setArchetype` 设置的 `shoulderScale` 骨骼缩放）。
- **影响**：`WP-Asset` 要么无法同时满足 `≤ 12 Draw Calls` 与 `10 材质 + 6 节点` 契约，要么导出的 `.glb` 在 `WP2` 中出现节点 `getObjectByName` 返回 `undefined`、人物面朝反向、眼球随球衣/球袜变色或 `shoulderScale` 被动画覆盖而返工。
- **修改方向**：
  1. 在 `SPEC.md`、`CONTRACT.md` 与 Obsidian SSOT 中将单角色 Draw Calls 上限调整为可实现的 **`≤ 18 / 角色`**（双人合计 `≤ 36`，完全兼容全场景 `≤ 150` 预算）；
  2. 在 `CONTRACT.md` §4.2 补齐：① 21 骨父子层级清单；② 明确 5 个可切换节点 + `Racquet` 均须为独立命名节点（并指明挂载骨骼）；③ 明确 glTF 导出后验朝向约定（Blender `+Y → glTF -Z` 正面，鼻尖/帽檐朝 `-Z`，右手持拍 `RacquetSocket` 位于 `+X`，脚底 `minY ≈ 0`）；④ 明确 10 个材质为“必须包含的换色材质名”（允许额外静态五官材质如 `Mat_EyeWhite`/`Mat_EyeIris`），并指明头饰/护腕所用换色材质；⑤ 约定 NLA 动画仅写骨骼旋转与 `Hips` 位移、不写 `Chest`/骨架 `scale` 轨道（或约定 `WP2` 施加 `shoulderScale` 的安全方式）。
- **下轮验收标准**：`SPEC.md`、`CONTRACT.md`、Obsidian SSOT 的单角色 Draw Calls 门槛与材质/节点数量算术自洽，且 `CONTRACT.md` §4.2 对骨骼树、节点挂载、glTF 朝向/持拍侧、五官材质与 `shoulderScale` 均零猜测。

---

### 【问题 2（必须）：V2 核心状态机与球路物理存在 4 处闭环缺口（网前同帧互打、发球边沿触发、STRETCH 放小球物理不可行、发球质量统计未定义）】
- **现象与证据**：
  1. **网前同帧连击与隔网触球漏洞（`SPEC.md` §3.3 L117）**：自动触球条件写为 `ball.lastHitter !== idx` 且 `ball.pos.z * p.side > -0.4`。当双方均站网前（`RUN_LIMIT_Z_MIN = 0.65 m`）并按住球种键时，若 P0 在 `z = +0.30 m` 截击（设置 `ball.lastHitter = 0`、`ball.hitTick = state.tick`），同一 `stepMatch` tick 内紧接着轮询 P1（`side = -1`），此时 `ball.pos.z * p1.side = -0.30 > -0.4` 且 `d_now = 0.95 m <= 1.48 m`，**P1 会在球尚未过网的同一帧内隔网直接回击**，触发同帧乒乓/穿网死循环。
  2. **`serve_ready` 边沿触发与 `serve_toss` 锁存规则歧义（`SPEC.md` §3.4 L138、`CONTRACT.md` §2.4 L370）**：未明确 `serve_ready → serve_toss` 是否要求 **`input.actionPressed === true`**。若为电平触发（仅判 `action === 'J'|'K'`），玩家上一分按住 `J` 未松手会在下一分 `serve_ready` 第 1 帧误触自动发球；若 WP1 按边沿触发实现而契约未写明，WP3 测试或 AI 发送 `actionPressed: false` 将无法发球。另未明确 `serve_toss`（`0.32 s`）期间：① 松开 `J`/`K` 绝不取消已锁存的发球类型；② `lockedAimX` 仅在 `Math.abs(input.aimX) > 0.05` 时更新（防止抛球中途松开 `A`/`D` 导致落点重置回中路 `0`）。
  3. **`STRETCH` 落点浅缩 `-1.1 m` 导致 `dropshot` 物理不可行且违反 `AC-06`（`SPEC.md` §3.4 L130 & L135、`AC-06` L183）**：`W+K` 目标 `|Z| = 2.15–2.65 m`（单按 `K` `2.85 m`），叠加 `STRETCH` 规则“落点浅缩 `1.1 m` + 散布 `±0.68 m`”后，目标 `|Z|` 最低跌至 `2.15 - 1.1 - 0.68 = 0.37 m`（贴网 37 cm），从底线物理上无法正常过 `0.914 m` 球网，且单按 `K` 最低落至 `1.07 m`，直接突破 `AC-06` 要求的 `K` 落点 `1.8–3.9 m`。
  4. **发球 `ShotQuality` 与 `cleanShots`/`totalShots` 统计口径未定义（`SPEC.md` §3.4 L141、`AC-09`、`AC-10`）**：`SPEC.md` L141 要求发球 `NET_LET` 时“回滚本次发球的 `totalShots`/`cleanShots`/`firstServesTotal` 统计”，但全文未定义 `serve_flat`（正常进区 vs 极边角失误）与 `serve_kick` 在 `SHOT_HIT` 与 `PlayerMatchStats` 中对应的 `ShotQuality` 档位及是否计入 `cleanShots`/`totalShots`。
- **影响**：WP1、WP2、WP3 各自猜测发球触发条件与统计规则，导致单元测试/联机测试互相不兼容，且实测 `AC-05`/`AC-06`/`AC-07`/`AC-09` 极易失败或出现网前穿网互打。
- **修改方向**：
  1. 在 `SPEC.md` §3.3 与 `CONTRACT.md` §2.4 为自动触球增加防同帧与防隔网约束：`ball.hitTick < state.tick`（单 tick 至多一次有效击球）且 `ball.pos.z * p.side >= -0.05`（或要求 `ball.vel.z * p.side > 0`，球正飞向接球方半场）；
  2. 明确 `serve_ready → serve_toss` 严格要求 `input.actionPressed && (input.action === 'J' || input.action === 'K')`（AI 发球帧同步置 `actionPressed: true`），并锁定 `serve_toss` 期间松开 `J`/`K` 不取消、`lockedAimX` 仅在 `Math.abs(input.aimX) > 0.05` 时更新；
  3. 明确 `STRETCH` 的“落点浅缩 `1.1 m`”仅适用于中深球（`topspin`/`slice`/`lob`，并钳位 `|Z| >= 2.2 m`）；对 `dropshot` 改为不浅缩或反向上浮变浅质量（钳位目标 `|Z| ∈ [2.0, 3.8] m`），保证物理过网且符合 `AC-06`；
  4. 在 `SPEC.md` §3.4 与 `CONTRACT.md` §2.4 明确发球 `ShotQuality` 与统计口径（如：正常 `serve_flat`/`serve_kick` 判 `'CLEAN'`、极边角自然失误的 `serve_flat` 判 `'SOLID'` 或 `'STRETCH'`；每次发球与回合击球均计 `totalShots += 1`，仅 `quality === 'CLEAN'` 计 `cleanShots += 1`；`NET_LET` 依 `lastShotQuality === 'CLEAN'` 精确回滚）。
- **下轮验收标准**：上述 4 项规则在 `SPEC.md` 与 `CONTRACT.md` §2.4 全部以无歧义公式/不变量写明，经验算网前对拉、发球、极限救球放小球与统计回滚均闭环无死角。

---

### 【问题 3（必须）：客户端 `ClientInputController.sampleFrame()` 缺失 V2 边沿触发行为规范，直接威胁 `AC-05` 长按取消与快速短按】
- **现象与证据**：
  - `CONTRACT.md` §3.3 严密锁定了服务端 `room.ts` 的 `actionPressed` 队列防丢与空队列清边沿规则，但 §5 `ClientInputController`（L455–L461）仅给出方法签名，未规定客户端 `sampleFrame(seq)` 生成 `action` 与 `actionPressed` 的 4 条关键行为规则。
  - 对照 V1 基点 `client/src/input/InputController.ts`（L84–L108、L207–L222）：① V1 在 `this.currentAction === 'none'` 时才受理新按键，直接阻塞了 V2 `SPEC.md` 要求的“按住期间随时切换 `J`/`K`/`L`”；② 若未显式忽略键盘自动连发 `e.repeat === true`，玩家长按 `J` 超过系统重复延迟（~300–500 ms）后会持续产生 `actionPressed = true`，反复将 `stepMatch` 中的 `holdDurationSec` 重置为 `dt`，导致永远无法达到 `>= 0.20 s` 而彻底破坏“长按松手取消（`AC-05` ④）”；③ 同一 16.6 ms 帧内完成 `keydown + keyup` 的极快短按若不锁存 1 帧合成边沿（当帧发 `{ action: key, actionPressed: true }`、下一帧发 `{ action: 'none', actionPressed: false }`），会被直接丢弃。
- **影响**：WP2 即使严格满足 TypeScript 签名，也可能在实机或 `E2E-02` 中出现快点漏触发、按住切换球种失效或长按后松手反而误进入 `0.35 s` 缓冲的严重手感缺陷。
- **修改方向**：在 `CONTRACT.md` §5 补充 `ClientInputController` 4 条硬性行为契约：① 忽略 `e.repeat === true` 对 `actionPressed` 的触发；② 单帧内 `keydown+keyup` 快按必须锁存 1 帧 `{ action: key, actionPressed: true }`（下帧恢复 `'none'`/`false`）；③ 按住 `J`/`K`/`L` 期间按下另一球种键立即切换为新键并发出 `actionPressed: true`，松开旧键不得清空当前新键；④ `resetAndRebind(reason)` 必须同时清空 `pressedKeys`、当前激活球种、待发 `actionPressed` 边沿与快按锁存。
- **下轮验收标准**：`CONTRACT.md` §5 完整锁定上述 4 条输入采样不变量，与 §3.3 服务端消费规则及 §2.4 `stepMatch` 形成端到端无损边沿闭环。

---

### 【问题 4（必须）：`TestStateSnapshot`/`InputDiagnostics` 跨包归属冲突，`cloneMatchState` 与 `spawn_incoming_ball` 服务端校验缺失】
- **现象与证据**：
  1. **跨包类型归属冲突**：V1 基点中 `InputDiagnostics` 与 `TestStateSnapshot` 定义并导出于 **`@court2k/shared`**（`shared/src/types.ts` L381–L405），并由 `client/src/contracts.ts`（L4, L8）与 `client/src/game/GameApp.ts`（L28）导入。V2 `CONTRACT.md` §2（`@court2k/shared` 导出清单）未列出这两个类型，却在 §5（WP2 客户端契约，L448–L483）重新定义了新增 `avatarLoaded`/`avatarSource`/`avatarTriangles` 的 `TestStateSnapshot`。若 WP1 保留旧版 `TestStateSnapshot` 或将其删除，而 WP2 沿用旧导入路径或反之，将在 WP1→WP2 衔接时直接触发 TypeScript 编译冲突。
  2. **`cloneMatchState` 缺失**：V1 `client/src/game/GameApp.ts`（L3）与 `server/src/room.ts`（L7）均直接从 `@court2k/shared` 导入 `cloneMatchState`，但 `CONTRACT.md` §2.4 未列出该函数（V2 须继续导出并深拷贝 `players[i].stance` 替代 `meter`）。
  3. **`spawn_incoming_ball` 服务端校验与执行规则缺失**：`CONTRACT.md` §3.2 新增了 `TEST_COMMAND(spawn_incoming_ball)`，但 §3.3 未锁定 `server/src/validation.ts` 的参数校验范围（`targetX`/`targetZ` 为有限数值、可选 `speedXZ > 0` 有限数值、可选 `forPlayerIndex ∈ {0, 1}`）以及 `room.ts` 收到该指令后的行为（调用 `spawnIncomingTestBall`、强制进入 `rally` 态、广播快照及是否清空输入队列）。
- **影响**：WP1 与 WP2/WP3 在并行或合入后出现类型导入/字段不匹配，`E2E-02` 联机测试指令因服务端校验边界不明产生歧义。
- **修改方向**：
  1. 在 `CONTRACT.md` §2.2 或 §5 明确 `InputDiagnostics` 与 `TestStateSnapshot` 的**唯一导出归属包**（推荐：统一保留并更新在 `@court2k/shared` 以保持与 V1 导入路径一致，或明确迁至 `client/src/contracts.ts` 并注明 WP1 从 `shared/src/types.ts` 移除）；
  2. 在 `CONTRACT.md` §2.4 补入 `cloneMatchState(state: MatchState): MatchState`（要求深拷贝 `stance`）；
  3. 在 `CONTRACT.md` §3.3 补齐 `validation.ts` 对 `spawn_incoming_ball` 的强校验规则及 `room.ts` 处理约定（同时明确 `spawnIncomingTestBall` 在 `shared` 中必须置 `phase = 'rally'`、`ball.active = true`、`ball.lastHitter = 1 - receiverIdx`、`ball.lastShotType = 'topspin'`、`ball.hitTick = next.tick`）。
- **下轮验收标准**：`TestStateSnapshot`/`InputDiagnostics` 唯一归属包无歧义、`cloneMatchState` 明确入表、`spawn_incoming_ball` 在 WP1/WP2/WP3 三端字段/校验/状态转换完全闭环。

---

### 【问题 5（必须）：Obsidian SSOT 主本与仓库 `SPEC.md` / `CONTRACT.md` 存在 4 处事实漂移】
- **现象与证据**：
  1. **骨骼数量矛盾**：Obsidian SSOT §3.5（L207）写为“**17 骨**人形 `Armature`”（尽管其后括号内实际列出了 21 根骨骼），而 `SPEC.md`（L145）与 `CONTRACT.md`（L423）为 **21 骨**。
  2. **`ShotStanceState` 字段缺失**：Obsidian SSOT §3.1.3（L125–L131）缺少 `lockedAimX: number`，与 `CONTRACT.md`（L210、L377）及 `SPEC.md`（L138）不一致。
  3. **`AC-06` 用例列表漂移**：`SPEC.md`（L183）包含 `W+K`，Obsidian SSOT（L236）遗漏了 `W+K`。
  4. **若干球路微参数文字不完全一致**：`W+K` 目标（Obsidian L184 `2.05–2.65 m` vs `SPEC.md` L135 `2.15–2.65 m`）、`S+K`（Obsidian L185 `5.8–6.8 m` vs `SPEC.md` L134 `6.0 m`）、`lob` 顶点（Obsidian L186 `≥ 5.4 m` vs `SPEC.md` L136 `peakHeightMinM = 5.60 m`）。
- **影响**：Obsidian 作为声明的 SSOT 若与仓库副本存在数字和结构定义漂移，将导致后续评审与版本追踪依据混乱。
- **修改方向**：在修复问题 1–4 同步更新 `SPEC.md` 与 `CONTRACT.md` 后，将全部修订同步回写至 Obsidian V2 SSOT 主本，确保三份文档在骨骼数、接口字段、球路参数、Draw Calls 上限与 `AC-01`~`AC-17` 上 100% 一致。
- **下轮验收标准**：逐项核对 Obsidian 主本与 `SPEC.md` / `CONTRACT.md`，0 处字段、数量或门槛差异。

---

### 建议项（非阻断，建议顺手补齐）

1. **【建议】`AC-06` `CLEAN` 落点精度 `≤ 0.12 m` 余量偏紧**：`SPEC.md` §3.4 定义 `CLEAN` 随机散布为 `±0.05 m`（二维斜向偏移可达 `0.071 m`），叠加 3 次迭代 `solveBallisticShot` 残差（尤其高弧 `lob` 易达 `0.04–0.08 m`）可能擦边超出 `0.12 m`。建议将 `CLEAN` 散布微调至 `±0.03 m`（或将 `solveBallisticShot` 迭代增至 4 次 / 明确 `≤ 0.12 m` 相对目标落点或仅测平击/切削/短球）。
2. **【建议】`generate_player_avatar.py` 支持默认输出路径**：同时兼容无参运行（默认输出到 `tennis-2k/client/public/assets/models/tennis_player.glb`，对齐 Obsidian L204）与 `-- --output <path>`（对齐 `CONTRACT.md` §4.1）。

---

## 规格层面问题（如有）

无须退回用户重新拍板产品方向——**问题 1 中的单角色 Draw Calls 上限（`12 → 18`）与问题 2 中的 `STRETCH` 放小球深度钳位均为工程/物理实现口径对齐**，不改变用户已批准的 `1A / 2A / 2026-11-27` 产品体验与全场景 `≤ 150 Draw Calls` 性能预算。

---

## 未验证项（非门槛 / 环境限制）

- 本轮为并行开工前静态契约评审，尚未进入代码构建或 Blender 导出执行；物理弹道、Blender `.glb` 导出与渲染、双端 60Hz 联机及 16 房压测均按计划在 WP1、WP-Asset、WP2、WP3 与整合阶段逐项实测。

---

## 给用户的摘要

V2 契约评审 Round 1 裁决为 **`FAIL`**，共拦截 **5 项必须修复项**（零产品方向变更，均为工程契约闭环问题）：① Blender `.glb` 单角色 `≤ 12 Draw Calls` 与 `10 材质 + 6 节点` 存在数学矛盾（`power` 流派最低 13 次），且缺少节点挂载、Blender→glTF `-Z` 朝向校验、五官材质与 `shoulderScale` 防动画覆写约束；② 自动触球网前存在同帧隔网连击漏洞，`serve_ready` 边沿触发、`STRETCH` 放小球 `-1.1 m` 导致贴网 37 cm 物理不可行，以及发球 `ShotQuality`/统计口径未锁定；③ 客户端 `InputController.sampleFrame()` 缺失 `e.repeat` 忽略、帧内快按锁存与按住切换球种规则；④ `TestStateSnapshot`/`InputDiagnostics` 跨包归属、`cloneMatchState` 与 `spawn_incoming_ball` 校验缺失；⑤ Obsidian 主本与仓库文档存在 4 处漂移（17 骨 vs 21 骨、缺 `lockedAimX` 等）。请 Planner 补齐这 5 项后进入契约 Round 2 全量复验，通过即可提交基点并并行开工。

---

## Obsidian 一行摘要

`FAIL` / V2 契约 Round 1 拦截 5 项必须修复项（.glb 单角色 Draw Calls 矛盾与绑定细节、网前同帧连击/发球边沿/STRETCH放小球/统计口径、客户端输入边沿规则、TestStateSnapshot 归属与 SSOT 漂移） / Planner 修订 SPEC/CONTRACT 与 Obsidian 主本后提交契约 Round 2 复验
