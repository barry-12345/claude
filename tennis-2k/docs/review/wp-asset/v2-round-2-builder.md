# WP-Asset Builder 自测与返工报告（V2 Round 2）

## 0. 快速索引

| 字段 | 值 |
| --- | --- |
| **工作包 / 轮次** | `WP-Asset` · `V2 Round 2`（针对 [v2-round-1.md](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/v2-round-1.md) `FAIL` 返工） |
| **分支 / 基点** | `feat/v2-wpasset`（基点 `2f6c96fae70e9b6040c54ef7a23221513a3f8c23`，Round 1 提交 `534ac17f44e072d64e75bba5c08df1e070f6d94b`） |
| **独占写入边界** | `tennis-2k/assets/**`、`tennis-2k/client/public/assets/models/**`、`tennis-2k/docs/review/wp-asset/**` |
| **契约校验脚本** | `python verify_glb.py` → `VERIFY_GLB: ALL CONTRACT CHECKS PASSED`（见 [verify_glb.json](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/verify_glb.json)） |
| **视觉证据目录** | [v2-round-2](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2)（8 张 PNG 已逐张 `read_file` 肉眼核查） |
| **已失效旧证据** | Round 1 的 `tennis_player.glb` 与 [v2-round-1](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-1) 渲染图全部作废 |

---

## 1. Round 1 返工项逐条修复与验证

### 问题 1：头发严重穿透 `Headgear_CapBackwards`、`Headgear_Visor` 与 `Headgear_Headband`（已修复）
- **根因**：头饰半径与位置未完全包住蓬松刘海/后脑勺发片，且遮阳帽檐纵向弧长偏大。
- **修复措施（[generate_player_avatar.py](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/generate_player_avatar.py)）**：
  - 重新校准头顶发盖与额前刘海层级高度（额角/后脑发片在头带带身高度内收敛曲率，避免顶破帽冠与头带外缘）。
  - 为 `Headgear_CapBackwards` 扩大反戴球帽内腔半径并重塑帽冠球面罩壳，帽檐严格朝 `+Z` 后方延展，无发丝穿模。
  - 将 `Headgear_Visor` 帽檐收窄为精炼弧形运动遮阳檐（`visor_min_z = -0.2055 m`），并将 `Headgear_Visor`（`0.1125 / 0.1195`）与 `Headgear_Headband`（`0.112 / 0.119`）内环紧贴太阳穴发际线，消除颞部缝隙与头发穿出。
- **验证**：[05_headgear_34_closeups.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/05_headgear_34_closeups.png) 与 [08_archetypes_lineup.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/08_archetypes_lineup.png) 显示三款头饰与发片贴合紧密、零头发穿模。

### 问题 2：五官凸出感、微笑嘴型、颈部粗细与发型融合（已修复）
- **根因**：Round 1 眼球半嵌入脸面造成凸出感，微笑嘴线过薄且缺少立体鼻子呼应，鬓角与后脑发丝存在断层。
- **修复措施**：
  - 将眼白/虹膜/高光改用贴合面部曲率的弧面贴片嵌合技术，消除半球突兀感。
  - 增强阳光微笑弧线（`Mat_FaceDetail`）与立体鼻尖轮廓，搭配柔和眉毛，提升亲和运动感。
  - 增粗颈部运动肌肉柱体并与衣领平顺过渡；重构后脑勺整片圆润发帽、弧形刘海层以及向后融入颞部发际线的鬓角贴片（`side_sign * 1.24`, `u_half = 0.15`），彻底清除生硬香蕉管状发束与太阳穴缺口。
- **验证**：[03_closeup_face_upper.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/03_closeup_face_upper.png) 与 [01_front_full.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/01_front_full.png) 确认五官贴面自然、微笑清晰、鬓角与发帽连贯无断层。

### 问题 3：腋窝举臂尖刺、白色短裤透底与运动鞋细节（已修复）
- **根因**：腋下环圈蒙皮权重跳变导致高举手臂时三角形撕裂；衣身下摆延伸入短裤内部在浅色 `serve_volley` 白裤下透出暗色；鞋面与鞋舌层次偏平。
- **修复措施**：
  - 重构 `torso_profile` 肩峰与腋下过渡截面，收窄过方肩角（`(1.310, 0.010, 0.160, 0.108)`、`(1.360, 0.006, 0.116, 0.088)`），并在肩袖过渡环上施加基于距离的平滑混合权重，消除高举动作时的腋下尖刺。
  - 将衣摆严格截断于腰线外侧上方并加厚短裤包裹，彻底消除白色短裤（`serve_volley`）裆部/大腿根部的暗色透底。
  - 强化流线型多层次网球鞋：鞋底（`Mat_ShoeSole`）、鞋身（`Mat_ShoeUpper`）与鞋舌/装饰条（`Mat_JerseyAccent`）分层清晰，搭配中筒运动袜装饰圈。
- **验证**：[04_closeup_shoes_shorts.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/04_closeup_shoes_shorts.png)、[06_action_serve_and_forehand.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/06_action_serve_and_forehand.png) 与 [08_archetypes_lineup.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/08_archetypes_lineup.png) 确认白色短裤洁净无透底、双臂高举腋下光滑无尖刺、球鞋层次分明。

### 问题 4：动作穿模（`forehand`/`serve_toss`/`celebrate`）与全动作覆盖渲染（已修复）
- **根因**：Round 1 动作关键帧手腕与上臂内收角度过大，导致拍框穿入面部或头顶；且 Round 1 缺少 `run`/`slide`/`backhand`/`celebrate` 渲染。
- **修复措施**：
  - 调整 `forehand`、`serve_toss` 与 `celebrate`（`UpperArm_R=(18, -50, 8)`, `Forearm_R=(12, -38, -4)`, `Hand_R=(-8, -32, -16)`）的肩/肘/腕欧拉角，确保持拍挥舞与高举庆祝全程避开头部与面部。
  - 扩展 [render_previews.py](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/render_previews.py)，全覆盖渲染 `idle`、`serve_toss`、`forehand`、`backhand`、`run`、`slide`、`celebrate` 及三款头饰 3/4 特写与 4 流派合影（共 8 张）。
- **验证**：[06_action_serve_and_forehand.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/06_action_serve_and_forehand.png) 与 [07_action_celebrate_backhand_run_slide.png](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/07_action_celebrate_backhand_run_slide.png) 确认各动作自然舒展、球拍零穿头穿脸。

---

## 2. 实测指标与自测验证汇总

| 校验项目 | 契约要求 | Round 2 实测结果 | 状态 |
| --- | --- | --- | --- |
| 文件体积（`tennis_player.glb`） | `≤ 350 KB` | **`333.55 KB`** | PASS |
| 默认 & 自定义 `-- --output` CLI | 均需成功导出 | 两条命令退出码均为 `0`，输出大小一致（`333.55 KB`） | PASS |
| 三角面数（文件总计 / 单角色可见） | 可见 `3,500–7,500`（总 `≤ 9,000`） | 文件总计 **`5,112`**（主体 `3,556`）；四流派可见 **`4,252–4,580`** | PASS |
| 最坏单角色可见 Draw Calls | `≤ 18` | **`17`**（`power`: `Avatar_Body` 11 + `Headgear_Headband` 1 + `Wristband_L/R` 2 + `Racquet` 3） | PASS |
| 骨骼数量与层级（`Armature`） | `21` 骨精确父子树 | **`21`** 骨 100% 匹配 | PASS |
| 6 个独立可切换场景节点 | 精确命名 + 正确父骨骼 | `Headgear_Headband` / `Headgear_Visor` / `Headgear_CapBackwards` / `Wristband_L` / `Wristband_R` / `Racquet` | PASS |
| 材质清单 | 10 个必需换色 + 允许静态细节 | `14` 个材质（含全部 `10` 个必需换色材质） | PASS |
| 嵌入式动画与 `scale` 轨道 | 8 条指定名，`0` 条 `scale` 轨道 | `idle` `1.20s`、`run` `0.56s`、`slide` `0.50s`、`serve_toss` `0.35s`、`forehand` `0.36s`、`backhand` `0.36s`、`lob` `0.40s`、`celebrate` `1.00s`；`scale` 轨道 **`0`** | PASS |
| 身高、接地与朝向 | 高 `1.75–1.80 m`、`\|minY\| ≤ 0.01 m`、正面 `-Z`、右手 `+X` | 身高 **`1.7604 m`**、`min_y_m = 0.0`、`visor_min_z = -0.2055`、`cap_max_z = 0.2263`、`racquet_center_x = 0.6846` | PASS |
| Blender 渲染预览（8 张） | 覆盖正/背/特写/头饰/全部关键动作/4流派 | [01](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/01_front_full.png)–[08](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2/08_archetypes_lineup.png) 全部已生成并逐张 `read_file` 审查 | PASS |

---

## 3. 修改影响面与旧证据失效声明

- **改动文件清单**：
  - [generate_player_avatar.py](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/generate_player_avatar.py)：重构人物面部、发型、颈肩腋下拓扑权重、短裤防透底、球鞋分层、三款头饰尺寸贴合及全套 8 条动画防穿模姿态。
  - [render_previews.py](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/render_previews.py)：升级为 8 视角渲染套件，新增头饰 3/4 特写与 `run`/`slide`/`backhand`/`celebrate` 动作帧渲染。
  - [verify_glb.py](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/verify_glb.py)：收紧身高校验区间下限至 `1.75 m`（兼容 `SPEC.md`、`CONTRACT.md` 与任务要求交集 `1.75–1.80 m`）并扩展 JSON 指标输出。
  - [README.md](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/assets/source/README.md)：同步更新校验与 `v2-round-2` 渲染命令。
  - [tennis_player.glb](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/client/public/assets/models/tennis_player.glb)：重新导出的 Round 2 正式二进制资产。
  - [v2-round-2-builder.md](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/v2-round-2-builder.md) 与 [v2-round-2](file:///C:/Users/Barry/.gemini/antigravity/brain/fdfcab71-4559-4883-b470-ad124349528d/scratch/wt-wpasset/tennis-2k/docs/review/wp-asset/evidence/v2-round-2)：Round 2 报告与实测渲染/JSON 证据。
- **对上游/下游契约与状态的影响**：
  - 未修改 `docs/SPEC.md`、`docs/CONTRACT.md`、`shared/**`、`client/src/**`、`server/**`、`package.json`。
  - 21 根骨骼名与父子层级、6 个独立节点名、10 个必需换色材质名、8 个动画 Clip 名与时长、`0` 条 `scale` 轨道及朝向坐标均保持与 `CONTRACT.md` §4.2 100% 一致，**对 WP2 客户端加载器零破坏性变更**。
- **作废的旧证据说明**：
  - Round 1 提交 `534ac17f44e072d64e75bba5c08df1e070f6d94b` 所导出的 `tennis_player.glb`、旧渲染图目录 `tennis-2k/docs/review/wp-asset/evidence/v2-round-1/` 以及旧报告 `v2-round-1-builder.md` 中的体积/面数/外观结论均已由本轮 Round 2 覆盖并**失效**。
