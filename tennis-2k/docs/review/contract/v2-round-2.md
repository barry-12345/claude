# 《Court 2K：大满贯时代》V2 契约评审报告 — Round 2

结论：PASS
候选版本：基点 `feat/tennis-2k-v2 @ ee66efd5f59e8cd6e248c78ad9507be6e52bf576`（工作区未提交 V2 定稿文件）
- `tennis-2k/docs/SPEC.md` SHA-256: `F21221A957114FC6494FA8C4C24DBF73578F9A7E4A54F61B963CC90CB6EDEB51`
- `tennis-2k/docs/CONTRACT.md` SHA-256: `D094CCF53537F38F29ABCC1FB2FD3CC036A38C618CDEF7FAF16AB2F7570BCC35`
- `tennis-2k/docs/PLAN.md` SHA-256: `EC5DFF5C62F158AFAE24B40AC8716CCAAB046231A81B15D8188AA9276462076A`
- Obsidian SSOT 主本：`G:\我的云端硬盘\Barry's obsidian\99_System\Data\Quick_Notes\Notes\Court 2K：大满贯时代 · V2 规划与版本页.md`
本轮核验方式：全量回归静态契约复验（逐条核验 Round 1 全部 5 项必须修复项与 2 项建议项，完整通读 `SPEC.md`、`CONTRACT.md`、`PLAN.md` 与 Obsidian SSOT 主本，交叉验算数学与物理边界并核对 SHA-256 指纹与 `git status`；预分配端口 `4900–4999` 本次标为不适用）

---

## 复测范围与理由

因本轮改动涉及跨工作包核心契约（`@court2k/shared` 导出类型与状态机不变量、WS `TEST_COMMAND` 校验、Blender 5.2 `.glb` 资产规格及客户端输入采样规则），按 `evaluator.md` §6 执行**全量回归复验**，覆盖全部 5 大审查维度及 4 份文档一致性。

---

## 达标项

- **[Round 1 问题 1 已闭环 · Blender 5.2 `.glb` 资产与 WP2 绑定契约]** `SPEC.md`、`CONTRACT.md` §4.2、`PLAN.md` 与 Obsidian SSOT 已统一将单角色 Draw Calls 门槛调整为可实现的 **`≤ 18 / 角色`**（双人 `≤ 36`，兼容全场景 `≤ 150`）；明确锁定 21 骨精确父子层级树、6 个独立命名场景节点及挂载骨骼（`Headgear_Headband`/`Headgear_Visor`/`Headgear_CapBackwards` 挂 `HeadgearSocket`，`Wristband_L/R` 挂 `Forearm_L/R`，`Racquet` 挂 `RacquetSocket`，严禁并入主体 `SkinnedMesh`）、Blender `+Y → glTF -Z` 朝向与右手 `+X` 持拍侧及 `|minY| ≤ 0.01 m` 校验、10 个必需换色材质 + 允许额外静态五官/握把材质、8 条 NLA 动画禁止导出任何骨骼 `scale` 轨道（保护 `Chest` 骨骼 `shoulderScale`），并同时支持无参默认导出与 `-- --output <path>`（建议 2 闭环）。
- **[Round 1 问题 2 已闭环 · V2 自动触球状态机与球路/发球物理闭环]** ① 网前自动触球已锁定 `ball.hitTick < next.tick`、`ball.pos.z * p.side >= -0.05` 且 `ball.vel.z * p.side > 0`（经验算在当前阻力/Magnus 物理参数下所有合法来球包括红土高下旋小球均满足 `vel.z * p.side > 0`，彻底消除同帧隔网乒乓且不误伤合法来球）；② `serve_ready → serve_toss` 严格要求边沿触发 `input.actionPressed && (input.action === 'J' || input.action === 'K')`（AI 同步置 `true`），抛球 `0.32 s` 期间松开 `J`/`K` 不取消且 `lockedAimX` 仅在 `|input.aimX| > 0.05` 时更新；③ `STRETCH` `-1.1 m` 浅缩仅作用于 `topspin`/`slice`/`lob`（钳位 `|Z| >= 2.2 m`），`dropshot` 改为 `+0.35 m` 并钳位 `|Z| ∈ [2.0, 3.8] m`（完全落入 `AC-06` `1.8–3.9 m` 且物理可过网）；④ 发球 `ShotQuality` 与统计口径明确锁定（正常 `serve_flat` 与全部 `serve_kick` 判 `CLEAN`，极边角自然失误 `serve_flat` 判 `SOLID`，全击球计 `totalShots += 1`、仅 `CLEAN` 计 `cleanShots += 1`，`NET_LET` 按 `lastShotQuality === 'CLEAN'` 与 `serveNumber === 1` 精确回滚）。
- **[Round 1 问题 3 已闭环 · 客户端 `ClientInputController.sampleFrame()` 边沿闭环]** `CONTRACT.md` §5.1、`SPEC.md` §3.3 与 Obsidian SSOT 完整锁定 4 条硬规则：忽略 `e.repeat === true`、单帧内 `keydown+keyup` 快按锁存 1 帧合成边沿、按住期间无缝切换球种且松开旧键不清空新键（松开激活键回落至其余已按球种键且不重发 `actionPressed`，经核与 `stepMatch` 切换判定自洽）、`resetAndRebind()` 覆盖全部 6 类时机并全量清空按键/激活键/待发边沿，与服务端 §3.3 队列防丢与空队列清边沿形成端到端无损闭环。
- **[Round 1 问题 4 已闭环 · 跨包类型唯一归属、`cloneMatchState` 与 `spawn_incoming_ball`]** `InputDiagnostics` 与含 `avatarLoaded`/`avatarSource`/`avatarTriangles` 的 V2 `TestStateSnapshot` 唯一归属并导出于 **`@court2k/shared`**（`CONTRACT.md` §1、§2.2、§5）；`cloneMatchState`（深拷贝 `stance`）补齐入 §2.4 纯函数表；`spawn_incoming_ball` 的 `shared` 状态不变量（强制 `phase = 'rally'`、`ball.active = true`、`lastHitter = 1 - receiverIdx`、`lastShotType = 'topspin'`、`hitTick = next.tick`、重置接球方 `stance`）及服务端 `validation.ts` 参数强校验（`targetX ∈ [-8,8]`、`targetZ ∈ [-16,16]`、`speedXZ ∈ (0,50]`、`forPlayerIndex ∈ {0,1}`）与 `room.ts` `clearInputs()` + 广播规则均已完整闭环。
- **[Round 1 问题 5 与建议 1 已闭环 · 四方 SSOT 100% 一致与 `CLEAN` 精度余量]** 逐项比对 Obsidian SSOT、`SPEC.md`、`CONTRACT.md` 与 `PLAN.md`：21 骨、Draw Calls `≤ 18/角色`、`ShotStanceState.lockedAimX`、`AC-06`（含 `W+K`、地面球 `≤ 0.12 m` 与 `STRETCH` 钳位）、全部球路深度/顶点参数均 100% 一致；`CLEAN` 随机散布收紧至 **`±0.03 m`**（建议 1 闭环，二维偏移 `≤ 0.042 m`，叠加求解残差仍远低于 `0.12 m` 门槛）；Obsidian 顶部版本追踪表保留完好；零 V1 废弃字段残留；`git status` 仅含文档变更，零触碰代码或 `package.json`。

---

## 返工项

无（0 项必须修复项，0 项新增矛盾）。

---

## 规格层面问题（如有）

无。

---

## 未验证项（非门槛 / 环境限制）

- 本轮为并行开工前契约复验，尚未进入业务代码编写与 Blender 资产生成阶段；物理引擎、Blender `.glb` 导出与渲染、双端 60Hz 联机、断线重连及 16 并发房压测均按计划在 WP1、WP-Asset、WP2、WP3 与整合阶段逐项实测。

---

## 给用户的摘要

V2 契约评审 Round 2 全量复验 **`PASS`**。Round 1 拦截的全部 5 项必须修复项与 2 项建议项（Blender `.glb` `≤ 18` Draw Calls 与 21 骨/6 节点/朝向/无 `scale` 轨道绑定、网前防同帧隔网触球/发球边沿与统计口径/`STRETCH` 放小球钳位、客户端 `InputController` 4 条边沿规则、`@court2k/shared` 唯一导出 `TestStateSnapshot`/`InputDiagnostics`/`cloneMatchState` 及 `spawn_incoming_ball` 校验、Obsidian 主本与仓库文档 100% 同步）已全部闭环，未引入新矛盾。当前规格与契约已具备提交 V2 代码基点、完成 6 项 Preflight 并启动 `(WP1 shared ∥ WP-Asset Blender)` 并行开发的条件。

---

## Obsidian 一行摘要

`PASS` / V2 契约 Round 2 全量复验通过（Round 1 全部 5 项必须项与 2 项建议项均已闭环，四方 SSOT 零漂移零矛盾） / 提交 V2 规格基点并完成 6 项 Preflight 汇报后启动 WP1 与 WP-Asset 并行构建
