# WP-Asset Builder 自测与返工报告（V2 Round 3）

## 0. 快速索引

| 字段 | 值 |
| --- | --- |
| **工作包 / 轮次** | `WP-Asset` · `V2 Round 3`（针对 [v2-round-2.md](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/v2-round-2.md) 2 项必须 + 1 项建议精修） |
| **分支 / 基点** | `feat/v2-wpasset`（基点 `2f6c96fae70e9b6040c54ef7a23221513a3f8c23`，Round 2 提交 `f7c0f05077ee54b078a32064ae87851e9b0f6bae`） |
| **二进制资产 SHA256** | `1CFA12ACDC7E13A5B63A5313CC5A3289050155290C79E6C28839BDF31C3F3A03`（`tennis_player.glb`，`344.17 KB`） |
| **独占写入边界** | `tennis-2k/assets/**`、`tennis-2k/client/public/assets/models/**`、`tennis-2k/docs/review/wp-asset/**` |
| **契约校验脚本** | `python verify_glb.py` → `VERIFY_GLB: ALL CONTRACT CHECKS PASSED`（见 [verify_glb.json](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/verify_glb.json)） |
| **视觉证据目录** | [v2-round-3](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3)（8 张 PNG 已生成并逐张 `read_file` 肉眼核查） |
| **已失效旧证据** | Round 1 与 Round 2 所导出的旧 `tennis_player.glb` 及 `evidence/v2-round-1/`、`evidence/v2-round-2/` 渲染图与体积/面数数据全部作废 |

---

## 1. Round 2 返工项逐条修复与验证

### 问题 1（必须）：修平肩袖衔接，消除“方块护肩/直角台阶断层”
- **根因**：Round 2 中 `torso_profile` 收窄肩线（`z=1.310, rx=0.160`、`z=1.360, rx=0.116`）后，双臂袖管起点 `p_sh_root=(±0.146, 0.006, 1.304)` / `p_sh_cap=(±0.175, 0.005, 1.308)` 仍以较粗半径（`ru=0.056 → 0.063`）平切外伸，致使袖管上缘悬高于斜方肌斜面，在正面、背面（主游戏视角）及近景出现台阶感。
- **修复措施（[generate_player_avatar.py](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/generate_player_avatar.py)）**：
  - 将上胸与肩部轮廓重组为平滑连续肩坡：`z=1.288 (rx=0.173, ry=0.112)` → `z=1.330 (rx=0.146, ry=0.098)` → `z=1.362 (rx=0.104, ry=0.080)`。
  - 将袖管根部收拢并沿三角肌自然斜率下沉嵌套：`p_sh_root=(±0.128, 0.008, 1.278, ru=0.044)` → 新增内过渡环 `p_sh_in=(±0.160, 0.008, 1.268, ru=0.051)` → `p_sh_cap=(±0.194, 0.009, 1.250, ru=0.051)`，使袖管顶部与躯干肩坡相切衔接、平滑自然下垂。
- **验证**：[01_front_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/01_front_full.png)、[02_back_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/02_back_full.png)、[03_closeup_face_upper.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/03_closeup_face_upper.png) 与 [05_headgear_34_closeups.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/05_headgear_34_closeups.png) 显示肩袖过渡圆润流畅，直角台阶彻底消除；同时 [06_action_serve_and_forehand.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/06_action_serve_and_forehand.png) 与 [07_action_celebrate_backhand_run_slide.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/07_action_celebrate_backhand_run_slide.png) 确认 `serve_toss` 与 `celebrate` 举臂仍保持零腋窝尖刺。

### 问题 2（必须）：圆润发顶轮廓，消除“低模尖顶多边形圆锥/橡果头”
- **根因**：Round 2 发帽采用 `create_icosphere(subdivisions=2)` 并在 `p.z > 0.35` 处将 `rz` 阶跃抬高至 `0.132`，导致发顶出现五边形尖锥棱角。
- **修复措施**：
  - 将发帽基础几何体更换为均匀纬线环的 `bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0)`，删除 `p.z > 0.35` 的阶跃突变，改为连续光滑穹顶曲线 `crown_round = 1.0 + 0.028 * math.sin(max(0.0, p.z) * math.pi)`（`rz = 0.128`），在保持身高 `1.7573 m` 与 `Headgear_CapBackwards` 内腔充裕余量（顶部间距 `> 4 cm`）的同时呈现饱满圆润的运动短发弧线。
  - 将鼻尖细分调整为 `subdiv=1`（平滑着色外观不变）以抵消发帽增面开销，确保体积稳守 `≤ 350 KB`（实测 `344.17 KB`）。
- **验证**：[01_front_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/01_front_full.png)、[02_back_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/02_back_full.png)、[05_headgear_34_closeups.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/05_headgear_34_closeups.png) 与 [08_archetypes_lineup.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/08_archetypes_lineup.png) 确认发顶圆润饱满，且 `Headband`、`Visor`、`CapBackwards` 下均保持 100% 零头发穿出。

### 问题 3（建议）：收紧发带/遮阳帽两侧贴合度并优化 `05_headgear_34_closeups.png` 构图
- **修复措施**：
  - 将 `Headgear_Headband`（`major_rx=0.1112, major_ry=0.1195`）与 `Headgear_Visor`（`major_rx=0.1120, major_ry=0.1198`）带身两侧横向内收贴合太阳穴弧度，消除外浮缝隙。
  - 在 [render_previews.py](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/render_previews.py) 中同步支持 `-- <glb_path> <out_dir>` 命令行参数与默认 `v2-round-3/` 输出，并调整 Pass 2 机位（`y=2.40, lens=50.0`）且仅在该头饰特写镜头隐藏 `Racquet`，使三位头饰角色完整入画、面部零球拍遮挡。
- **验证**：[05_headgear_34_closeups.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/05_headgear_34_closeups.png) 三位角色头饰、面部与肩线均完整清晰无遮挡。

---

## 2. 契约硬指标与视觉证据核查表

| 校验项目 | 契约要求 | Round 3 实测结果 | 状态 |
| --- | --- | --- | --- |
| 文件体积（`tennis_player.glb`） | `≤ 350 KB` | **`344.17 KB`** | PASS |
| 默认 & `-- --output` CLI | 均需成功导出 | 两条命令退出码均为 `0`，体积一致（`344.17 KB`） | PASS |
| 三角面数（文件总计 / 单角色可见） | 可见 `3,500–7,500`（总 `≤ 9,000`） | 文件总计 **`5,500`**（主体 `3,944`）；四流派可见 **`4,640–4,968`** | PASS |
| 最坏单角色可见 Draw Calls | `≤ 18` | **`17`**（`power`: `Avatar_Body` 11 + `Headgear_Headband` 1 + `Wristband_L/R` 2 + `Racquet` 3） | PASS |
| 骨骼数量与层级（`Armature`） | `21` 骨精确父子树 | **`21`** 骨 100% 匹配 | PASS |
| 6 个独立可切换场景节点 | 精确命名 + 正确父骨骼 | `Headgear_Headband` / `Headgear_Visor` / `Headgear_CapBackwards` / `Wristband_L` / `Wristband_R` / `Racquet` | PASS |
| 材质清单 | 10 个必需换色 + 允许静态细节 | `14` 个材质（含全部 `10` 个必需换色材质） | PASS |
| 嵌入式动画与 `scale` 轨道 | 8 条指定名，`0` 条 `scale` 轨道 | `idle` `1.20s`、`run` `0.56s`、`slide` `0.50s`、`serve_toss` `0.35s`、`forehand` `0.36s`、`backhand` `0.36s`、`lob` `0.40s`、`celebrate` `1.00s`；`scale` 轨道 **`0`** | PASS |
| 身高、接地与朝向 | 高 `1.75–1.80 m`、`\|minY\| ≤ 0.01 m`、正面 `-Z`、右手 `+X` | 身高 **`1.7573 m`**、`min_y_m = 0.0`、`visor_min_z = -0.2055`、`cap_max_z = 0.2263`、`racquet_center_x = 0.6846` | PASS |
| Blender 渲染预览（8 张） | 正/背/特写/头饰/全部动作/4流派 | [01](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/01_front_full.png)–[08](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3/08_archetypes_lineup.png) 全部生成并逐张 `read_file` 审查 | PASS |

---

## 3. 修改影响面与旧证据失效声明

- **改动文件清单**：
  - [generate_player_avatar.py](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/generate_player_avatar.py)：重塑肩袖过渡环与圆润 `uvsphere` 发帽轮廓，收紧发带/遮阳帽两侧半径并平衡细分数。
  - [render_previews.py](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/render_previews.py)：新增 CLI 路径参数解析、默认输出切换至 `v2-round-3/`，并优化 `05_headgear_34_closeups.png` 无遮挡取景。
  - [README.md](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/README.md)：同步更新校验与 `v2-round-3` 渲染命令。
  - [tennis_player.glb](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/client/public/assets/models/tennis_player.glb)：Round 3 正式导出 `.glb`（`344.17 KB`，SHA256 `1CFA12ACDC7E13A5B63A5313CC5A3289050155290C79E6C28839BDF31C3F3A03`）。
  - [v2-round-3-builder.md](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/v2-round-3-builder.md) 与 [v2-round-3](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-3)：本轮报告与实测证据。
- **对上游/下游契约与状态的影响**：
  - 未修改 `docs/SPEC.md`、`docs/CONTRACT.md`、`shared/**`、`client/src/**`、`server/**`、`package.json`。
  - 21 根骨骼树、6 个独立可切换节点名、10 个必需换色材质名、8 条动画 Clip 名与时长、`0` 条 `scale` 轨道及朝向坐标 100% 不变，对 WP2 客户端集成零破坏性变更。
- **作废的旧证据说明**：
  - Round 1（`534ac17f44e072d64e75bba5c08df1e070f6d94b`）及 Round 2（`f7c0f05077ee54b078a32064ae87851e9b0f6bae`）所产出的旧 `tennis_player.glb`、旧渲染图目录 `evidence/v2-round-1/` 与 `evidence/v2-round-2/` 中的模型体积、面数与肩部/发帽外观结论均已由本轮 Round 3 替代并**失效**。
