# 《Court 2K：大满贯时代》V2 完整规划（PLAN · Round 2 对齐副本）

- **单一事实源（SSOT）归属**：Obsidian 为主本（`G:\我的云端硬盘\Barry's obsidian\99_System\Data\Quick_Notes\Notes\Court 2K：大满贯时代 · V2 规划与版本页.md`），仓库执行副本见 [`docs/SPEC.md`](./SPEC.md) 与 [`docs/CONTRACT.md`](./CONTRACT.md)，本文件为与 Obsidian 主本严格对齐的规划副本。
- **当前状态**：**已获用户批准开工（`2026-11-27`「可以开始」，决策 1A / 2A 与 C-01~C-03 生效）**，已完成契约评审 Round 2 修订对齐。
- **版本号**：`V2` · 修订日期：2026-11-27
- **代码基点**：`feat/tennis-2k-v2 @ ee66efd5f59e8cd6e248c78ad9507be6e52bf576`（V1 全量整合 `PASS`，50/50 Vitest，前端 163.88 KB gzip）
- **本机工具实测验证**：`Blender 5.2.3 LTS`（`GLTF_READY: True`）。
- **边界红线**：本阶段仅本地开发与独立验收；**绝不修改 `main` / `gold-miner`，绝不执行 `git push`，绝不触碰上海服务器**。

> 本规划与 Obsidian SSOT 主本、`docs/SPEC.md` 及 `docs/CONTRACT.md` 保持 100% 同步（含 21 骨 `Armature`、单角色 Draw Calls `≤ 18`、6 个独立可切换节点、glTF `-Z` 朝向与 `+X` 右手持拍、8 条无 `scale` 轨道 NLA 动画、`ShotStanceState.lockedAimX`、网前防同帧/防隔网触球、`serve_ready` 边沿触发、`STRETCH` 放小球 `[2.0, 3.8] m` 钳位、发球质量/统计口径、`ClientInputController` 4 条边沿规则、`CLEAN` `±0.03 m` 散布与 `@court2k/shared` 唯一导出 `TestStateSnapshot`/`InputDiagnostics`/`cloneMatchState`）。完整实现与验收细则请直接查阅 [`docs/SPEC.md`](./SPEC.md) 与 [`docs/CONTRACT.md`](./CONTRACT.md)。
